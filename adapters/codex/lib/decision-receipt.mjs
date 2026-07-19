import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const MAX_AGE_MS = 48 * 3_600_000;
const PENDING_REUSE_MS = 10 * 60_000;
const STORE_VERSION = 2;
const MAX_STORED_EXCHANGES = 128;
export const HOST_TURN_PROTOCOL = 2;
export const MAX_TURN_SUBJECT_LENGTH = 2400;

const hash = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");
const cleanTranscript = (value) => String(value ?? "").replace(/\0/g, "").trim();
export const canonicalDecisionSubject = (value) => Array.from(cleanTranscript(value))
  .slice(0, MAX_TURN_SUBJECT_LENGTH).join("");
const promptHash = (value) => hash(canonicalDecisionSubject(value));
const transcriptHash = (value) => hash(cleanTranscript(value));

function sessionKey(input, host) {
  const candidates = [
    input?.session_id, input?.sessionId, input?.thread_id, input?.threadId,
    input?.conversation_id, input?.conversationId,
    host === "codex" ? process.env.CODEX_THREAD_ID : "",
    process.env.CLAUDE_SESSION_ID, process.env.CLAUDE_CODE_SESSION_ID,
    process.env.CLAUDE_CONVERSATION_ID, process.env.CLAUDE_TRANSCRIPT_PATH,
    input?.transcript_path, input?.transcriptPath,
    `${host}:${process.cwd()}`,
  ];
  const session = candidates.find((x) => String(x ?? "").trim()) || process.cwd();
  return hash(`${host}\0${session}`).slice(0, 32);
}

export const decisionSource = (host) => process.env.THROUGHLINE_SOURCE
  ?? (host === "claude" ? "claude-code-plugin" : "codex-plugin");

/** Stable causal room for one host transcript. Cross-body continuity may share memory, but feedback
 * from this room may adjudicate only the answer it actually followed here. */
export const decisionConversationRef = (input, host) => `${host}:${sessionKey(input, host)}`;

const receiptPath = (input, host) => join(tmpdir(), `throughline-decisions-${sessionKey(input, host)}.json`);

function readQueue(input, host) {
  const path = receiptPath(input, host);
  if (!existsSync(path)) return [];
  try {
    const rows = JSON.parse(readFileSync(path, "utf8"));
    const now = Date.now();
    return Array.isArray(rows)
      ? rows.filter((row) => row?.v === STORE_VERSION && row?.capture_ref
        && now - Number(row.at ?? 0) < MAX_AGE_MS).slice(-MAX_STORED_EXCHANGES)
      : [];
  } catch { return []; }
}

function writeQueue(input, host, rows) {
  const path = receiptPath(input, host);
  const kept = rows.slice(-MAX_STORED_EXCHANGES);
  if (!kept.length) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporary, JSON.stringify(kept), { mode: 0o600 });
  renameSync(temporary, path);
}

const publicExchange = (row) => ({
  protocol: HOST_TURN_PROTOCOL,
  source: row.source,
  conversation_ref: row.conversation_ref,
  capture_ref: row.capture_ref,
  subject: row.subject,
});

/** Allocate and durably remember a per-exchange identity before asking the cloud to decide.
 * A repeated hook invocation reuses only a recent still-pending identity; once admitted, even an
 * identical prompt receives a new capture_ref and therefore a distinct deed. */
export function prepareDecisionExchange(input, host, prompt, options = {}) {
  const subject = canonicalDecisionSubject(prompt);
  if (!subject) return null;
  const now = Number(options.now ?? Date.now());
  const source = decisionSource(host);
  const conversationRef = decisionConversationRef(input, host);
  const wantedPrompt = promptHash(prompt);
  const wantedTranscript = transcriptHash(prompt);
  const rows = readQueue(input, host);
  const pending = [...rows].reverse().find((row) => !row.receipt && !row.closed_at
    && row.source === source && row.conversation_ref === conversationRef
    && row.prompt === wantedPrompt && row.transcript === wantedTranscript
    && now - Number(row.at ?? 0) < PENDING_REUSE_MS);
  if (pending) return publicExchange(pending);

  const nonce = String(options.nonce ?? randomBytes(12).toString("hex")).replace(/[^a-z0-9_-]/gi, "").slice(0, 32);
  if (!nonce) throw new Error("host turn capture nonce is empty");
  const captureRef = `${conversationRef}:${nonce}`;
  const row = {
    v: STORE_VERSION,
    protocol: HOST_TURN_PROTOCOL,
    source,
    conversation_ref: conversationRef,
    capture_ref: captureRef,
    subject,
    prompt: wantedPrompt,
    transcript: wantedTranscript,
    at: now,
  };
  writeQueue(input, host, [...rows, row]);
  return publicExchange(row);
}

/** The cloud v2 decision endpoint is GET-only: provenance is the daemon's source header and the
 * complete canonical subject plus exact identity travel as query parameters. */
export function decisionRequestPath(selfName, exchange) {
  const query = new URLSearchParams({
    q: exchange.subject,
    conversation_ref: exchange.conversation_ref,
    capture_ref: exchange.capture_ref,
  });
  return `/selves/${encodeURIComponent(selfName)}/decision?${query.toString()}`;
}

export const isLegacyDecisionResponse = (response) => !!response
  && response.protocol == null && typeof response.context === "string";

function assertV2Decision(exchange, response) {
  const ingress = response?.ingress;
  if (response?.protocol !== HOST_TURN_PROTOCOL
      || !/^td_[0-9a-f]{16}$/.test(String(response?.id ?? "")) || !response?.receipt
      || !/^tsub_[0-9a-f]{24}$/.test(String(response?.decision?.subjectDigest ?? ""))
      || ingress?.conversation_ref !== exchange.conversation_ref
      || ingress?.capture_ref !== exchange.capture_ref
      || !/^act_[0-9a-f]{24}$/.test(String(ingress?.action_ref ?? ""))
      || !/^evt_[0-9a-f]{24}$/.test(String(ingress?.event_ref ?? "")))
    throw new Error("Throughline host protocol v2 returned an invalid or mismatched decision identity");
}

/** Persist the server-admitted identity outside model context. No legacy receipt is accepted: an
 * older response may inform this turn, but it can never authorize a shared-self history write. */
export function rememberDecisionReceipt(input, host, prompt, exchange, turnDecision) {
  if (!exchange || !String(prompt ?? "").trim()) return false;
  assertV2Decision(exchange, turnDecision);
  const rows = readQueue(input, host);
  const index = rows.findIndex((row) => row.capture_ref === exchange.capture_ref);
  if (index < 0) throw new Error("host turn identity was not persisted before /decision");
  const row = rows[index];
  if (row.source !== exchange.source || row.conversation_ref !== exchange.conversation_ref
      || row.prompt !== promptHash(prompt) || row.transcript !== transcriptHash(prompt))
    throw new Error("host turn prompt no longer matches its persisted decision identity");
  const admitted = {
    ...row,
    decision_id: String(turnDecision.id),
    receipt: String(turnDecision.receipt),
    subject_ref: String(turnDecision.ingress.event_ref),
    action_ref: String(turnDecision.ingress.action_ref),
    subject_digest: String(turnDecision.decision?.subjectDigest ?? ""),
    decided_at: Date.now(),
  };
  if (row.receipt && (row.receipt !== admitted.receipt || row.decision_id !== admitted.decision_id
      || row.subject_ref !== admitted.subject_ref || row.action_ref !== admitted.action_ref))
    throw new Error("host turn identity was already admitted with a different decision");
  rows[index] = admitted;
  writeQueue(input, host, rows);
  return true;
}

function completeExchanges(turns) {
  const groups = [];
  let pending = null;
  const flush = () => {
    if (pending?.assistant) groups.push(pending);
    pending = null;
  };
  for (let index = 0; index < (Array.isArray(turns) ? turns.length : 0); index++) {
    const turn = turns[index];
    if (turn?.role === "user") {
      flush();
      pending = { start: index, end: index + 1, user: turn, assistant: null };
    } else if (turn?.role === "assistant" && pending) {
      // Progress updates are visible assistant messages too. The last one before the next user is
      // the delivered answer and the only line allowed to enter shared-self history.
      pending.assistant = turn;
      pending.end = index + 1;
    }
  }
  flush();
  return groups;
}

/** Match complete transcript exchanges to their exact admitted identities. The caller submits each
 * capture separately and advances its cursor only after that one request succeeds. */
export function matchDecisionExchanges(input, host, turns) {
  const rows = readQueue(input, host).filter((row) => row.receipt && !row.captured_at);
  const used = new Set();
  return completeExchanges(turns).map((group) => {
    const wantedPrompt = promptHash(group.user.content);
    const wantedTranscript = transcriptHash(group.user.content);
    const index = rows.findIndex((row, rowIndex) => !used.has(rowIndex)
      && row.prompt === wantedPrompt && row.transcript === wantedTranscript);
    if (index < 0) return { ...group, capture: null };
    used.add(index);
    const row = rows[index];
    return {
      ...group,
      capture: {
        protocol: HOST_TURN_PROTOCOL,
        source: row.source,
        conversation_ref: row.conversation_ref,
        capture_ref: row.capture_ref,
        action_ref: row.action_ref,
        subject_ref: row.subject_ref,
        output_event_ref: row.output_event_ref ?? null,
        decision_id: row.decision_id,
        receipt: row.receipt,
        turns: [
          { role: "user", content: group.user.content },
          { role: "assistant", content: group.assistant.content, decision_receipt: row.receipt },
        ],
      },
    };
  });
}

/** Bind the output event acknowledged by raw-turn capture before semantic ingestion. Keeping it in
 * the same exchange record makes an ingest retry prove the identical input/output evidence pair. */
export function rememberDecisionOutput(input, host, captureRef, outputEventRef) {
  const eventRef = String(outputEventRef ?? "");
  if (!/^evt_[0-9a-f]{24}$/.test(eventRef))
    throw new Error("host-turn v2 capture returned an invalid output event_ref");
  const rows = readQueue(input, host);
  const index = rows.findIndex((row) => row.capture_ref === captureRef);
  if (index < 0 || !rows[index].receipt || !rows[index].subject_ref)
    throw new Error("host-turn output has no admitted decision identity");
  if (rows[index].output_event_ref && rows[index].output_event_ref !== eventRef)
    throw new Error("host-turn output event identity changed across retries");
  rows[index] = { ...rows[index], output_event_ref: eventRef, output_at: rows[index].output_at ?? Date.now() };
  writeQueue(input, host, rows);
  return [...new Set([rows[index].subject_ref, eventRef])];
}

/** Mark only the exchange acknowledged by the server. A lost response leaves it retryable with the
 * same capture_ref; an acknowledged retry is harmless because the cloud action identity is stable. */
export function consumeDecisionExchange(input, host, captureRef) {
  const rows = readQueue(input, host);
  const index = rows.findIndex((row) => row.capture_ref === captureRef);
  if (index < 0) return false;
  rows[index] = { ...rows[index], captured_at: rows[index].captured_at ?? Date.now() };
  writeQueue(input, host, rows);
  return true;
}

/** Retire an identity that reached a genuine legacy endpoint or a terminal protocol rejection.
 * It remains as local evidence, but a later identical user exchange must receive a fresh deed. */
export function closeDecisionExchange(input, host, captureRef, reason) {
  const rows = readQueue(input, host);
  const index = rows.findIndex((row) => row.capture_ref === captureRef);
  if (index < 0) return false;
  rows[index] = {
    ...rows[index],
    closed_at: rows[index].closed_at ?? Date.now(),
    closed_reason: String(reason ?? "closed").slice(0, 80),
  };
  writeQueue(input, host, rows);
  return true;
}
