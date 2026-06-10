// Thin client for the Throughline API. Cloud-first: talks to the cloud by default; point
// THROUGHLINE_URL at a local daemon (http://127.0.0.1:8787) to self-host.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CLOUD = "https://throughline-cloud-production.up.railway.app";
const BASE = process.env.THROUGHLINE_URL ?? CLOUD;

// API key: env (e.g. set in the MCP server config) -> ~/.throughline/auth.json (saved by
// `throughline use-key`). Sent as a Bearer. A local self-host daemon ignores it.
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
const SOURCE = process.env.THROUGHLINE_SOURCE ?? "claude-code-plugin";
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

// Which self this session maps to, in priority order:
//   1. THROUGHLINE_SELF env (explicit pin)
//   2. a `.throughline` file in the project (cwd, walking up) — per-project session isolation:
//      the work repo stays the work self, everywhere else stays the default
//   3. the account's default_self
// `selfSource()` reports which rule won, so the session hook can tell the user.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
let cachedSelf, cachedSource;
function projectSelf() {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    const f = resolve(dir, ".throughline");
    if (existsSync(f)) {
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
export function selfSource() { return cachedSource ?? "default"; }

// Mode = persona thickness for this session: "full" | "companion" | "work" | "off".
// Resolution: THROUGHLINE_MODE env > `mode=` line in .throughline > adapter default.
// "off" (also as the .throughline first line) disables injection entirely in this project —
// a vanilla agent, no persona, no capture guidance. Presence is a dial, not a default.
let cachedMode;
function projectFileLines() {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    const f = resolve(dir, ".throughline");
    if (existsSync(f)) return readFileSync(f, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
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
  try {
    const res = await fetch(`${BASE}/config`, { headers: authHeaders() });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.default_self) { cachedSource = "account-default"; return (cachedSelf = cfg.default_self); }
    }
  } catch { /* unreachable — fall through */ }
  cachedSource = "fallback";
  return (cachedSelf = "assistant");
}

async function selfPath(sub) {
  return `${BASE}/selves/${encodeURIComponent(await self())}${sub}`;
}

export async function get(sub) {
  const res = await fetch(await selfPath(sub), { headers: authHeaders() });
  if (!res.ok) throw new Error(`${sub} -> ${res.status}`);
  return res.json();
}
export async function getText(sub) {
  const res = await fetch(await selfPath(sub), { headers: authHeaders() });
  if (!res.ok) throw new Error(`${sub} -> ${res.status}`);
  return res.text();
}
export async function post(sub, body) {
  const res = await fetch(await selfPath(sub), {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${sub} -> ${res.status}`);
  return res.json();
}

export async function rawGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
export async function rawPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
export async function rawDelete(path) {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export async function safe(fn, fallback) {
  try { return await fn(); } catch { return fallback; }
}
