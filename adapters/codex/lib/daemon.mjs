// Thin client for the Throughline API. Cloud-first: talks to the cloud by default; point
// THROUGHLINE_URL to point at a self-hosted backend.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
function authHeaders(extra = {}) {
  const key = apiKey();
  return {
    "x-throughline-source": SOURCE,
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
      if (first && first.toLowerCase() !== "off" && !first.toLowerCase().startsWith("mode=")) return first;
      return null; // "off" or mode-only file: no self override here
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

function pluginRuntime() {
  return /\/\.codex\/plugins\/cache\/throughline\/throughline\//.test(process.cwd());
}
export function hasKey() { return !!apiKey(); }
export function selfSource() { return cachedSource ?? "default"; }

// Mode = persona thickness for this session: "full" | "companion" | "work" | "off".
// Resolution: THROUGHLINE_MODE env > `mode=` line in .throughline > adapter default.
// "off" (also as the .throughline first line) disables injection entirely in this project —
// a vanilla agent, no persona, no capture guidance. Presence is a dial, not a default.
let cachedMode;
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
export function sessionMode(defaultMode = "full") {
  if (cachedMode) return cachedMode;
  if (process.env.THROUGHLINE_MODE) return (cachedMode = process.env.THROUGHLINE_MODE);
  const lines = projectFileLines();
  if (lines) {
    if (lines[0]?.toLowerCase() === "off") return (cachedMode = "off");
    const m = lines.find((l) => l.toLowerCase().startsWith("mode="));
    if (m) return (cachedMode = m.slice(5).trim().toLowerCase());
  }
  return (cachedMode = defaultMode);
}

export async function self() {
  if (cachedSelf) return cachedSelf;
  if (process.env.THROUGHLINE_SELF) { cachedSource = "env"; return (cachedSelf = process.env.THROUGHLINE_SELF); }
  const proj = projectSelf();
  if (proj) { cachedSource = "project"; return (cachedSelf = proj); }
  const status = codexStatusSelf();
  if (status) { cachedSource = "codex-status"; return (cachedSelf = status); }
  if (pluginRuntime()) { cachedSource = "unbound-plugin"; return (cachedSelf = "assistant"); }
  try {
    const res = await fetchWithTimeout(`${BASE}/config`, { headers: authHeaders() });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.default_self) { cachedSource = "account-default"; return (cachedSelf = cfg.default_self); }
    }
  } catch { /* unreachable — fall through */ }
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

// surface the cloud's own error text — a bare "-> 400" hides a perfectly good explanation
// (e.g. self-name rules) and leaves the user guessing.
async function httpError(label, res) {
  let detail = "";
  try { detail = (await res.json()).error ?? ""; } catch { /* non-JSON body */ }
  return new Error(`${label} -> ${res.status}${detail ? `: ${detail}` : ""}`);
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
const snapPath = (selfName, mode) => join(SNAP_DIR, `${String(selfName).replace(/[^\w.-]/g, "_")}.${mode}.json`);
export function writeSnapshot(selfName, mode, context) {
  try {
    if (!context || context.trim().length < 60) return;
    mkdirSync(SNAP_DIR, { recursive: true });
    writeFileSync(snapPath(selfName, mode), JSON.stringify({ ts: new Date().toISOString(), self: selfName, mode, context }), { mode: 0o600 });
  } catch { /* best-effort */ }
}
export function readSnapshot(selfName, mode, maxAgeDays = 14) {
  try {
    const s = JSON.parse(readFileSync(snapPath(selfName, mode), "utf8"));
    if (!s?.context) return null;
    const ageDays = (Date.now() - Date.parse(s.ts)) / 86_400_000;
    return Number.isFinite(ageDays) && ageDays <= maxAgeDays ? s : null;
  } catch { return null; }
}
/** 401/403 from the cloud = key problem (fix it), anything else = transient (snapshot ok). */
export const isAuthError = (e) => /-> 40[13]\b/.test(String(e?.message ?? ""));
