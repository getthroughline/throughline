import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const MAX_AGE_MS = 48 * 3_600_000;
export const MAX_TURN_SUBJECT_LENGTH = 2400;
const hash = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
export const canonicalDecisionSubject = (value) => Array.from(String(value ?? "").replace(/\0/g, "").trim())
  .slice(0, MAX_TURN_SUBJECT_LENGTH).join("");
const promptHash = (value) => hash(canonicalDecisionSubject(value));
const transcriptHash = (value) => hash(String(value ?? "").replace(/\0/g, "").trim());

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

/** Stable causal room for one host transcript. Cross-body continuity may share memory, but feedback
 * from this room may adjudicate only the answer it actually followed here. */
export const decisionConversationRef = (input, host) => `${host}:${sessionKey(input, host)}`;
export const decisionCaptureRef = (input, host, start, end) =>
  `${decisionConversationRef(input, host)}:${Math.max(0, Number(start) || 0)}-${Math.max(0, Number(end) || 0)}`;

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
  rows.push({
    prompt: promptHash(prompt),
    transcript: transcriptHash(prompt),
    id: String(turnDecision.id),
    receipt: String(turnDecision.receipt),
    at: Date.now(),
  });
  writeQueue(input, host, rows);
  return true;
}

function witnessedExchanges(turns, rows) {
  const used = new Set(), groups = [];
  let pending = null;
  const flush = () => {
    if (!pending?.assistant) { pending = null; return; }
    if (pending.receiptIndex >= 0) used.add(pending.receiptIndex);
    groups.push(pending);
    pending = null;
  };
  for (const turn of Array.isArray(turns) ? turns : []) {
    if (turn?.role === "user") {
      flush();
      const wanted = promptHash(turn.content);
      const exact = transcriptHash(turn.content);
      pending = {
        user: turn,
        assistant: null,
        receiptIndex: rows.findIndex((row, index) =>
          !used.has(index) && row.prompt === wanted && row.transcript === exact),
      };
    } else if (turn?.role === "assistant" && pending) {
      // Host progress updates are visible assistant messages too. The last one before the next user
      // is the completed turn; only it may carry the canonical decision into durable self-history.
      pending.assistant = turn;
    }
  }
  flush();
  return { groups, used };
}

/** Attach receipts without consuming them. One complete exchange becomes two rows, so the server's
 * eight-row inlet always retains the user subject even after a long run of progress updates. */
export function attachDecisionReceipts(input, host, turns) {
  const rows = readQueue(input, host);
  const { groups } = witnessedExchanges(turns, rows);
  return groups.slice(-4).flatMap((group) => {
    const receipt = group.receiptIndex >= 0 ? rows[group.receiptIndex]?.receipt : null;
    return [group.user, receipt ? { ...group.assistant, decision_receipt: receipt } : group.assistant];
  });
}

/** Commit the receipt queue only after raw-turn capture succeeds. Matched exchanges outside the
 * bounded upload window are retired too, because the transcript cursor advances past them. */
export function consumeDecisionReceipts(input, host, turns) {
  const rows = readQueue(input, host);
  const { used } = witnessedExchanges(turns, rows);
  if (used.size) writeQueue(input, host, rows.filter((_, index) => !used.has(index)));
  return used.size;
}
