// Thin client for the local throughlined API. The adapter owns no logic — it only translates
// between the host and the daemon. (Identical to the Claude Code adapter's client.)

const BASE = process.env.THROUGHLINE_URL ?? "http://127.0.0.1:8787";

// Which self this session maps to: THROUGHLINE_SELF -> daemon's configured default_self -> "assistant".
let cachedSelf;
export async function self() {
  if (cachedSelf) return cachedSelf;
  if (process.env.THROUGHLINE_SELF) return (cachedSelf = process.env.THROUGHLINE_SELF);
  try {
    const res = await fetch(`${BASE}/config`);
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.default_self) return (cachedSelf = cfg.default_self);
    }
  } catch { /* daemon down — fall through */ }
  return (cachedSelf = "assistant");
}

async function selfPath(sub) {
  return `${BASE}/selves/${encodeURIComponent(await self())}${sub}`;
}

export async function get(sub) {
  const res = await fetch(await selfPath(sub));
  if (!res.ok) throw new Error(`${sub} -> ${res.status}`);
  return res.json();
}

export async function getText(sub) {
  const res = await fetch(await selfPath(sub));
  if (!res.ok) throw new Error(`${sub} -> ${res.status}`);
  return res.text();
}

export async function rawGet(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
