import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const MAX_AGE_MS = 48 * 3_600_000;
const hash = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const promptHash = (value) => hash(String(value ?? "").replace(/\s+/g, " ").trim());

function sessionKey(input, host) {
  const candidates = [
    input?.transcript_path, input?.transcriptPath, input?.session_id, input?.sessionId,
    host === "codex" ? process.env.CODEX_THREAD_ID : "",
    process.env.CLAUDE_SESSION_ID, process.env.CLAUDE_CODE_SESSION_ID,
    process.env.CLAUDE_CONVERSATION_ID, process.env.CLAUDE_TRANSCRIPT_PATH,
    `${host}:${process.cwd()}`,
  ];
  return hash(candidates.find((x) => String(x ?? "").trim()) || `${host}:${process.cwd()}`).slice(0, 32);
}

const receiptPath = (input, host) => join(tmpdir(), `throughline-decisions-${sessionKey(input, host)}.json`);
const readQueue = (input, host) => {
  const path = receiptPath(input, host);
  if (!existsSync(path)) return [];
  try {
    const rows = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(rows) ? rows.filter((row) => row?.receipt && Date.now() - Number(row.at ?? 0) < MAX_AGE_MS).slice(-64) : [];
  } catch { return []; }
};
const writeQueue = (input, host, rows) => {
  const path = receiptPath(input, host);
  try {
    if (!rows.length) { if (existsSync(path)) unlinkSync(path); return; }
    writeFileSync(path, JSON.stringify(rows.slice(-64)), { mode: 0o600 });
  } catch { /* receipt write-back is optional; raw experience still survives */ }
};

/** Remember an opaque server witness outside the model context. Seeing a decision writes no memory. */
export function rememberDecisionReceipt(input, host, prompt, turnDecision) {
  if (!turnDecision?.receipt || !turnDecision?.id || !String(prompt ?? "").trim()) return false;
  const rows = readQueue(input, host);
  rows.push({ prompt: promptHash(prompt), id: String(turnDecision.id), receipt: String(turnDecision.receipt), at: Date.now() });
  writeQueue(input, host, rows);
  return true;
}

/** Attach one witnessed decision only after its matching assistant words actually exist. */
export function attachDecisionReceipts(input, host, turns) {
  const rows = readQueue(input, host), used = new Set();
  let pending = -1;
  const out = (Array.isArray(turns) ? turns : []).map((turn) => {
    if (turn?.role === "user") {
      const wanted = promptHash(turn.content);
      pending = rows.findIndex((row, index) => !used.has(index) && row.prompt === wanted);
      return turn;
    }
    if (turn?.role !== "assistant" || pending < 0 || !rows[pending]) return turn;
    const row = rows[pending];
    used.add(pending); pending = -1;
    return { ...turn, decision_receipt: row.receipt };
  });
  if (used.size) writeQueue(input, host, rows.filter((_, index) => !used.has(index)));
  return out;
}
