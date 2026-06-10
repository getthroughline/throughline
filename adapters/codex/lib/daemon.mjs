// Thin client for the Throughline API (Codex adapter). Cloud-first; THROUGHLINE_URL overrides
// for self-host. Identical key resolution to the Claude Code adapter.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CLOUD = "https://getthroughline.ai";
const BASE = process.env.THROUGHLINE_URL ?? CLOUD;

function apiKey() {
  if (process.env.THROUGHLINE_API_KEY) return process.env.THROUGHLINE_API_KEY;
  try {
    return JSON.parse(readFileSync(join(homedir(), ".throughline", "auth.json"), "utf8")).token ?? null;
  } catch {
    return null;
  }
}
const SOURCE = process.env.THROUGHLINE_SOURCE ?? "codex-plugin";
const MODEL = process.env.THROUGHLINE_MODEL ?? "";
function authHeaders() {
  const key = apiKey();
  return {
    "x-throughline-source": SOURCE,
    ...(MODEL ? { "x-throughline-model": MODEL } : {}),
    ...(key ? { authorization: `Bearer ${key}` } : {}),
  };
}

// Self resolution: THROUGHLINE_SELF env -> `.throughline` project file (cwd, walking up;
// per-project session isolation) -> account default. selfSource() reports which rule won.
import { existsSync, statSync } from "node:fs";
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
  try {
    const res = await fetch(`${BASE}/config`, { headers: authHeaders() });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.default_self) { cachedSource = "account-default"; return (cachedSelf = cfg.default_self); }
    }
  } catch { /* fall through */ }
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
export async function rawGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}
export async function safe(fn, fallback) {
  try { return await fn(); } catch { return fallback; }
}
