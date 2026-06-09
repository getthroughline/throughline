// Thin client for the local throughlined API. The adapter owns no logic — it only translates
// between Claude Code and the daemon.

const BASE = process.env.THROUGHLINE_URL ?? "http://127.0.0.1:8787";

// Which self this session maps to. Configurable per project/user; defaults for first-run.
export const SELF = process.env.THROUGHLINE_SELF ?? "default/self";

function selfPath(sub) {
  return `${BASE}/selves/${encodeURIComponent(SELF)}${sub}`;
}

export async function get(sub) {
  const res = await fetch(selfPath(sub));
  if (!res.ok) throw new Error(`${sub} -> ${res.status}`);
  return res.json();
}

export async function getText(sub) {
  const res = await fetch(selfPath(sub));
  if (!res.ok) throw new Error(`${sub} -> ${res.status}`);
  return res.text();
}

export async function post(sub, body) {
  const res = await fetch(selfPath(sub), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${sub} -> ${res.status}`);
  return res.json();
}

// Best-effort: if the daemon is down, the adapter must never break the host session.
export async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
