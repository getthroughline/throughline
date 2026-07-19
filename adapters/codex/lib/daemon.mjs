// Thin client for the Throughline API. Cloud-first: talks to the cloud by default; point
// THROUGHLINE_URL to point at a self-hosted backend.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

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
const RAW_SESSION = process.env.THROUGHLINE_SESSION_ID ?? process.env.CODEX_THREAD_ID ?? `process:${randomUUID()}`;
const SESSION = createHash("sha256").update(`${SOURCE}\0${RAW_SESSION}`).digest("hex").slice(0, 40);
function authHeaders(extra = {}) {
  const key = apiKey();
  return {
    "x-throughline-source": SOURCE,
    "x-throughline-session": SESSION,
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
//   1. THROUGHLINE_SELF env (explicit pin)
//   2. a `.throughline` file in the project (cwd, walking up) — per-project session isolation:
//      the work repo stays the work self, everywhere else stays the default
//   3. the account's default_self
// `selfSource()` reports which rule won, so the session hook can tell the user.
import { dirname, resolve } from "node:path";
let cachedSelf, cachedSource;
function projectSelf() {
  try { return projectSelfUnsafe(); } catch { return null; }
}
function projectSelfUnsafe() {
  let dir = process.cwd();
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

function codexStatusSelf() {
  try {
    const dir = join(homedir(), ".throughline", "status");
    const thread = process.env.CODEX_THREAD_ID;
    if (!thread) return null;
    const p = join(dir, `thread-${String(thread).replace(/[^\w.-]/g, "_")}.json`);
    const st = statSync(p);
    if (Date.now() - st.mtimeMs > 7 * 86_400_000) return null;
    const status = JSON.parse(readFileSync(p, "utf8"));
    return typeof status?.self === "string" && status.self ? status.self : null;
  } catch {
    return null;
  }
}

function currentCodexStatusSelf() {
  try {
    const p = join(homedir(), ".throughline", "status", "codex-current.json");
    const st = statSync(p);
    if (Date.now() - st.mtimeMs > 6 * 60_000) return null;
    const status = JSON.parse(readFileSync(p, "utf8"));
    return typeof status?.self === "string" && status.self ? status.self : null;
  } catch {
    return null;
  }
}

function pluginRuntime() {
  return /\/\.codex\/plugins\/cache\/throughline\/throughline\//.test(process.cwd());
}
export function hasKey() { return !!apiKey(); }
export function selfSource() { return cachedSource ?? "default"; }

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
  if (cachedSelf && (cachedSource === "env" || cachedSource === "project" || cachedSource === "unbound-plugin")) return cachedSelf;
  if (process.env.THROUGHLINE_SELF) { cachedSource = "env"; return (cachedSelf = process.env.THROUGHLINE_SELF); }
  const proj = projectSelf();
  if (proj) { cachedSource = "project"; return (cachedSelf = proj); }
  const status = codexStatusSelf();
  if (status) { cachedSource = "codex-status"; return (cachedSelf = status); }
  const currentStatus = currentCodexStatusSelf();
  if (currentStatus) { cachedSource = "codex-status"; return (cachedSelf = currentStatus); }
  if (cachedSelf && cachedSource === "account-default") return cachedSelf;
  try {
    const res = await fetchWithTimeout(`${BASE}/config`, { headers: authHeaders() });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.default_self) { cachedSource = "account-default"; return (cachedSelf = cfg.default_self); }
    }
  } catch { /* unreachable — fall through */ }
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
  if (cachedSource === "env" || cachedSource === "project" || cachedSource === "codex-status" || cachedSource === "unbound-plugin") return false;
  cachedSelf = name || undefined; // undefined → next self() re-resolves from account default
  if (name) cachedSource = "account-default";
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
export async function mcpRequest(message) {
  const res = await fetchWithTimeout(`${BASE}/mcp`, {
    method: "POST",
    headers: authHeaders({
      "content-type": "application/json",
      "x-throughline-self": await self(),
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
import { mkdirSync, writeFileSync } from "node:fs";
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
