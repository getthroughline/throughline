// Thin client for the Throughline API. Cloud-first: talks to the cloud by default; point
// THROUGHLINE_URL to point at a self-hosted backend.
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const CLOUD = "https://getthroughline.ai";
const BASE = process.env.THROUGHLINE_URL ?? CLOUD;

// API key: env (e.g. set in the MCP server config) -> ~/.throughline/auth.json (saved by
// the dashboard). Sent as a Bearer token.
function apiKey() {
  if (process.env.THROUGHLINE_API_KEY) return process.env.THROUGHLINE_API_KEY;
  try {
    return JSON.parse(readFileSync(join(homedir(), ".throughline", "auth.json"), "utf8")).token ?? null;
  } catch {
    return null;
  }
}
// Writer provenance: which host/model is writing. Powers the cloud's conformance telemetry
// and the fidelity gate (weak substrates lose auto-save). Override via env if embedding elsewhere.
const SOURCE = process.env.THROUGHLINE_SOURCE ?? "codex-plugin";
const MODEL = process.env.THROUGHLINE_MODEL ?? process.env.ANTHROPIC_MODEL ?? "";
const PROCESS_SESSION = `process:${randomUUID()}`;
const requestScope = new AsyncLocalStorage();
const scope = () => requestScope.getStore() ?? null;
const rawSession = () => process.env.THROUGHLINE_SESSION_ID
  ?? scope()?.threadId
  ?? process.env.CODEX_THREAD_ID
  ?? PROCESS_SESSION;
const session = () => createHash("sha256").update(`${SOURCE}\0${rawSession()}`).digest("hex").slice(0, 40);
function authHeaders(extra = {}) {
  const key = apiKey();
  return {
    "x-throughline-source": SOURCE,
    "x-throughline-session": session(),
    ...(MODEL ? { "x-throughline-model": MODEL } : {}),
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    ...extra,
  };
}

async function fetchWithTimeout(url, init = {}) {
  const timeoutMs = Number(process.env.THROUGHLINE_TIMEOUT_MS ?? "8000");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetch(url, init);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Which self this session maps to, in priority order:
//   1. THROUGHLINE_SELF env (explicit process pin)
//   2. a `.throughline` file in the project (cwd, walking up) — durable project authority
//   3. this exact Codex thread's saved self — task continuity, never project authority
//   4. workspace status only when Codex supplied no thread id (legacy-host fallback)
//   5. the account's default_self
// `selfSource()` reports which rule won, so the session hook can tell the user.
import { dirname, resolve } from "node:path";
let cachedSelf, cachedSource;
function projectSelf(cwd = process.cwd()) {
  try { return projectSelfUnsafe(cwd); } catch { return null; }
}
function projectSelfUnsafe(cwd = process.cwd()) {
  let dir = resolve(cwd);
  for (let i = 0; i < 12; i++) {
    const f = resolve(dir, ".throughline");
    // must be a FILE: ~/.throughline (the data directory) shares the name — skip dirs, keep walking
    if (existsSync(f) && statSync(f).isFile()) {
      const first = readFileSync(f, "utf8").trim().split("\n")[0].trim();
      if (first && first.toLowerCase() !== "off" && !first.includes("=")) return first;
      return null; // "off" disables this project; key/value lines are not self names
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function statusFileBinding(path) {
  try {
    const st = statSync(path);
    if (Date.now() - st.mtimeMs > 7 * 86_400_000) return null;
    const status = JSON.parse(readFileSync(path, "utf8"));
    if (typeof status?.self !== "string" || !status.self) return null;
    return { self: status.self, origin: typeof status.source === "string" ? status.source : "legacy" };
  } catch {
    return null;
  }
}

const codexStatusDir = () => process.env.THROUGHLINE_CODEX_STATUS_DIR
  ? resolve(process.env.THROUGHLINE_CODEX_STATUS_DIR)
  : join(homedir(), ".throughline", "status");

function codexStatusSelf(thread = process.env.CODEX_THREAD_ID) {
  if (!thread) return null;
  return statusFileBinding(join(codexStatusDir(), `thread-${String(thread).replace(/[^\w.-]/g, "_")}.json`));
}

function workspaceStatusSelf(cwd) {
  if (!cwd) return null;
  const key = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 16);
  return statusFileBinding(join(codexStatusDir(), `${key}.json`));
}

function requestStatusPaths(context = scope()) {
  const paths = [];
  const threadId = context?.threadId ?? (String(process.env.CODEX_THREAD_ID ?? "").trim() || null);
  const workspaces = context?.workspacePaths ?? (pluginRuntime(process.cwd()) ? [] : [process.cwd()]);
  if (threadId)
    paths.push(join(codexStatusDir(), `thread-${String(threadId).replace(/[^\w.-]/g, "_")}.json`));
  if (!threadId) for (const cwd of workspaces) {
    const key = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 16);
    paths.push(join(codexStatusDir(), `${key}.json`));
  }
  return [...new Set(paths)];
}

function persistRequestSelf(name, source = "explicit-session") {
  const paths = requestStatusPaths();
  if (!paths.length) return;
  mkdirSync(codexStatusDir(), { recursive: true });
  for (const path of paths) {
    if (!name) { try { unlinkSync(path); } catch { /* already absent */ } continue; }
    writeFileSync(path, JSON.stringify({ self: name, source, ts: Date.now() }));
  }
}

function metadataObjects(value, out = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value) || out.length >= 24) return out;
  seen.add(value);
  out.push(value);
  for (const key of ["_meta", "meta", "params", "x-codex-turn-metadata", "turn_metadata", "turnMetadata"]) {
    const child = value[key];
    if (child && typeof child === "object") metadataObjects(child, out, seen);
  }
  return out;
}

export function codexThreadId(metadata = {}) {
  for (const item of metadataObjects(metadata)) {
    for (const key of ["threadId", "thread_id", "sessionId", "session_id", "conversationId", "conversation_id"]) {
      const value = String(item?.[key] ?? "").trim();
      if (value) return value;
    }
  }
  return String(process.env.CODEX_THREAD_ID ?? "").trim() || null;
}

export function codexWorkspacePaths(metadata = {}) {
  const paths = [];
  for (const item of metadataObjects(metadata)) {
    const workspaces = item?.workspaces;
    if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces))
      paths.push(...Object.keys(workspaces));
    for (const key of ["cwd", "workspace", "workspacePath", "workspace_path"]) {
      const value = String(item?.[key] ?? "").trim();
      if (value.startsWith("/")) paths.push(value);
    }
  }
  if (!pluginRuntime(process.cwd())) paths.push(process.cwd());
  return [...new Set(paths.map((p) => resolve(p)))];
}

async function accountDefaultSelf() {
  try {
    const res = await fetchWithTimeout(`${BASE}/config`, { headers: authHeaders() });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.default_self) return String(cfg.default_self);
    }
  } catch { /* unresolved below */ }
  return null;
}

async function requestBinding(metadata = {}) {
  if (process.env.THROUGHLINE_SELF) return { self: process.env.THROUGHLINE_SELF, source: "env" };
  const threadId = codexThreadId(metadata);
  for (const cwd of codexWorkspacePaths(metadata)) {
    const project = projectSelf(cwd);
    if (project) return { self: project, source: "project" };
  }
  const status = codexStatusSelf(threadId);
  if (status) return { self: status.self, source: "codex-status", statusOrigin: status.origin };
  // Workspace status exists only for older Codex hosts that omit a task/thread id. Letting it
  // participate when a new thread id is present silently turns the last task into a project pin.
  if (!threadId) for (const cwd of codexWorkspacePaths(metadata)) {
    const workspace = workspaceStatusSelf(cwd);
    if (workspace) return { self: workspace.self, source: "codex-workspace-status", statusOrigin: workspace.origin };
  }
  const account = await accountDefaultSelf();
  if (account) return { self: account, source: "account-default" };
  return { self: "assistant", source: pluginRuntime() ? "unbound-plugin" : "fallback" };
}

/** Bind one Codex request to its own thread/workspace. The MCP process is shared, but identity is
 * not: every nested cloud read/write inherits this async-local scope and provenance session. */
export async function withCodexRequest(metadata, fn) {
  const context = {
    threadId: codexThreadId(metadata),
    workspacePaths: codexWorkspacePaths(metadata),
    self: null,
    source: null,
  };
  return requestScope.run(context, async () => {
    const binding = await requestBinding(metadata);
    context.self = binding.self;
    context.source = binding.source;
    return fn();
  });
}

/** Hooks are one-shot processes, so entering one request scope for the rest of the process is safe
 * and lets all subsequent helper calls share the same binding without wrapping the whole script. */
export async function bindCodexRequest(metadata = {}) {
  const context = {
    threadId: codexThreadId(metadata),
    workspacePaths: codexWorkspacePaths(metadata),
    self: null,
    source: null,
  };
  requestScope.enterWith(context);
  const binding = await requestBinding(metadata);
  context.self = binding.self;
  context.source = binding.source;
  return binding;
}

export function pluginRuntime(cwd = process.cwd()) {
  return /\/\.codex\/plugins\/cache\/throughline\/throughline\//.test(cwd);
}
export function hasKey() { return !!apiKey(); }
export function selfSource() { return scope()?.source ?? cachedSource ?? "default"; }

function projectFileLines() {
  try { return projectFileLinesUnsafe(); } catch { return null; }
}
function projectFileLinesUnsafe() {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    const f = resolve(dir, ".throughline");
    if (existsSync(f) && statSync(f).isFile()) return readFileSync(f, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
export function sessionDisabled() {
  if (/^(1|true|yes)$/i.test(String(process.env.THROUGHLINE_DISABLED ?? ""))) return true;
  const lines = projectFileLines();
  return lines?.[0]?.toLowerCase() === "off";
}

export async function self() {
  if (scope()?.self) return scope().self;
  if (cachedSelf && (cachedSource === "env" || cachedSource === "project" || cachedSource === "unbound-plugin")) return cachedSelf;
  if (process.env.THROUGHLINE_SELF) { cachedSource = "env"; return (cachedSelf = process.env.THROUGHLINE_SELF); }
  const proj = projectSelf();
  if (proj) { cachedSource = "project"; return (cachedSelf = proj); }
  const status = codexStatusSelf();
  if (status) { cachedSource = "codex-status"; return (cachedSelf = status); }
  if (cachedSelf && cachedSource === "account-default") return cachedSelf;
  const account = await accountDefaultSelf();
  if (account) { cachedSource = "account-default"; return (cachedSelf = account); }
  // MCP servers start with the installed plugin cache as cwd, so project discovery cannot work
  // there. That is not evidence that the account has no self: use its default whenever the cloud
  // is reachable. Only fail closed to the neutral assistant when neither a session binding nor the
  // account config can be resolved.
  if (pluginRuntime()) { cachedSource = "unbound-plugin"; return (cachedSelf = "assistant"); }
  cachedSource = "fallback";
  return (cachedSelf = "assistant");
}

/**
 * Re-point the session's cached self after use_self/resume/delete_self. Without this, every
 * later write (draft_persona, journal, propose) silently lands on the OLD self — draft_persona
 * after a switch even staged a supersedes against the old self's soul. env/project bindings are
 * deliberate pins and win; return false so the caller can tell the user the session stays pinned.
 */
export function rebindSelf(name) {
  const active = scope();
  if (active) {
    if (["env", "project", "unbound-plugin"].includes(active.source)) return false;
    active.self = name || null;
    persistRequestSelf(name);
    if (name) active.source = active.threadId ? "codex-status" : "codex-workspace-status";
    return true;
  }
  if (cachedSource === "env" || cachedSource === "project" || cachedSource === "unbound-plugin") return false;
  cachedSelf = name || undefined; // undefined → next self() re-resolves from account default
  persistRequestSelf(name);
  if (name) cachedSource = process.env.CODEX_THREAD_ID ? "codex-status" : "account-default";
  return true;
}

async function selfPath(sub) {
  return `${BASE}/selves/${encodeURIComponent(await self())}${sub}`;
}

export class ThroughlineHttpError extends Error {
  constructor(label, status, body = {}) {
    const detail = String(body?.error ?? "");
    super(`${label} -> ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "ThroughlineHttpError";
    this.status = status;
    this.code = String(body?.code ?? "");
    this.protocol = body?.protocol ?? null;
  }
}

// Surface the cloud's structured error. Host hooks need the status/code to keep network failures
// fail-soft while making a protocol upgrade loud instead of silently falling back to forged state.
async function httpError(label, res) {
  let body = {};
  try { body = await res.json(); } catch { /* non-JSON body */ }
  return new ThroughlineHttpError(label, res.status, body);
}

export async function get(sub) {
  const res = await fetchWithTimeout(await selfPath(sub), { headers: authHeaders() });
  if (!res.ok) throw await httpError(sub, res);
  return res.json();
}
export async function getText(sub) {
  const res = await fetchWithTimeout(await selfPath(sub), { headers: authHeaders() });
  if (!res.ok) throw await httpError(sub, res);
  return res.text();
}
export async function post(sub, body) {
  const res = await fetchWithTimeout(await selfPath(sub), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw await httpError(sub, res);
  return res.json();
}

/** Forward one MCP message to the canonical cloud tool surface while preserving this body's
 * provenance and the session's exact self binding. Local adapters keep a few ergonomic tools,
 * but capability-bearing tools must not drift into a second hand-written implementation. */
export function hostTurnHeaders(exchange) {
  const conversation = String(exchange?.conversation_ref ?? "").trim().slice(0, 160);
  const capture = String(exchange?.capture_ref ?? "").trim().slice(0, 180);
  return conversation && capture ? {
    "x-throughline-conversation": conversation,
    "x-throughline-capture": capture,
  } : {};
}

export async function mcpRequest(message, exchange = null) {
  const res = await fetchWithTimeout(`${BASE}/mcp`, {
    method: "POST",
    headers: authHeaders({
      "content-type": "application/json",
      "x-throughline-self": await self(),
      ...hostTurnHeaders(exchange),
    }),
    body: JSON.stringify(message ?? {}),
  });
  if (!res.ok) throw await httpError("/mcp", res);
  return res.json();
}

export async function rawGet(path) {
  const res = await fetchWithTimeout(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw await httpError(path, res);
  return res.json();
}
export async function rawPost(path, body) {
  const res = await fetchWithTimeout(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw await httpError(path, res);
  return res.json();
}
export async function rawDelete(path) {
  const res = await fetchWithTimeout(`${BASE}${path}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw await httpError(path, res);
  return res.json();
}

export async function safe(fn, fallback) {
  try { return await fn(); } catch { return fallback; }
}

// --- offline snapshot: yesterday's self beats no self, but ONLY for transient failures ---
// Mirrors the claude-code adapter: good bootstraps refresh a local copy; the session hook serves
// it (with an offline marker) when the cloud is unreachable. Auth failures are excluded on
// purpose — a stale key needs the user to fix it, not a paper-over.
const SNAP_DIR = join(homedir(), ".throughline", "cache");
const snapPath = (selfName) => join(SNAP_DIR, `${String(selfName).replace(/[^\w.-]/g, "_")}.json`);
export function writeSnapshot(selfName, context, voiceAnchor = "") {
  try {
    if (!context || context.trim().length < 60) return;
    mkdirSync(SNAP_DIR, { recursive: true });
    writeFileSync(snapPath(selfName), JSON.stringify({ ts: new Date().toISOString(), self: selfName, context, voiceAnchor }), { mode: 0o600 });
  } catch { /* best-effort */ }
}
export function readSnapshot(selfName, maxAgeDays = 14) {
  try {
    const s = JSON.parse(readFileSync(snapPath(selfName), "utf8"));
    if (!s?.context) return null;
    const ageDays = (Date.now() - Date.parse(s.ts)) / 86_400_000;
    return Number.isFinite(ageDays) && ageDays <= maxAgeDays ? s : null;
  } catch { return null; }
}
/** 401/403 from the cloud = key problem (fix it), anything else = transient (snapshot ok). */
export const isAuthError = (e) => [401, 403].includes(Number(e?.status))
  || /-> 40[13]\b/.test(String(e?.message ?? ""));
export const isProtocolUpgradeError = (e) => Number(e?.status) === 426
  && String(e?.code ?? "") === "host_turn_protocol_v2_required";
export const isLegacyDecisionEndpointError = (e) => [404, 405].includes(Number(e?.status));
