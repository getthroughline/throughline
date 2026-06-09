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
function authHeaders() {
  const key = apiKey();
  return key ? { authorization: `Bearer ${key}` } : {};
}

let cachedSelf;
export async function self() {
  if (cachedSelf) return cachedSelf;
  if (process.env.THROUGHLINE_SELF) return (cachedSelf = process.env.THROUGHLINE_SELF);
  try {
    const res = await fetch(`${BASE}/config`, { headers: authHeaders() });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.default_self) return (cachedSelf = cfg.default_self);
    }
  } catch { /* fall through */ }
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
