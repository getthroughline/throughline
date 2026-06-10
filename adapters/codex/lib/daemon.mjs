// Thin client for the Throughline API (Codex adapter). Cloud-first; THROUGHLINE_URL overrides
// for self-host. Identical key resolution to the Claude Code adapter.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CLOUD = "https://throughline-cloud-production.up.railway.app";
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
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
let cachedSelf, cachedSource;
function projectSelf() {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    const f = resolve(dir, ".throughline");
    if (existsSync(f)) {
      const name = readFileSync(f, "utf8").trim().split("\n")[0].trim();
      if (name) return name;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
export function selfSource() { return cachedSource ?? "default"; }
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
