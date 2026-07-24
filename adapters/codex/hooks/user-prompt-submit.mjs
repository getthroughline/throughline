#!/usr/bin/env node
// UserPromptSubmit hook (Codex): voice micro-anchor plus a live cross-body decision. Routine
// reflection is automatic cloud metabolism and deliberately absent from the conversational path.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { bindCodexRequest, codexThreadId, hasKey, rawGet, safe, self, sessionDisabled } from "../lib/daemon.mjs";
import { loadHostTurnDecision } from "../lib/host-turn-client.mjs";

let hookInput = {};
try { hookInput = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
const currentPrompt = String(hookInput.prompt ?? hookInput.user_prompt ?? hookInput.message?.content ?? "").trim();

process.env.THROUGHLINE_TIMEOUT_MS ??= "2500";

const emit = (additionalContext, systemMessage = "") => {
  const output = { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } };
  if (systemMessage) output.systemMessage = systemMessage;
  process.stdout.write(JSON.stringify(output));
};

async function writeCodexStatus(name, source) {
  try {
    const statusDir = join(homedir(), ".throughline", "status");
    mkdirSync(statusDir, { recursive: true });
    const status = JSON.stringify({ self: name, source, cwd: process.cwd(), ts: Date.now() });
    writeFileSync(join(statusDir, createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16) + ".json"), status);
    const threadId = codexThreadId(hookInput);
    if (threadId)
      writeFileSync(join(statusDir, `thread-${String(threadId).replace(/[^\w.-]/g, "_")}.json`), status);
  } catch { /* presence is optional */ }
}

// The LIVE clock, recomputed this message from her home zone — the cure for a clock frozen at
// session start (the 深夜 / "我查过了" slip). Codex fetches /bootstrap here every turn for the live
// cross-body decision, and bootstrap carries homeTz, so the live time is free: prefer her IANA
// zone (DST-correct via Intl), fall back to a raw UTC offset, silent if neither.
function liveClock(tz, offsetHours) {
  try {
    const now = new Date();
    let p;
    if (tz) {
      p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
        hour12: false, hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
    } else if (typeof offsetHours === "number") {
      const s = new Date(now.getTime() + offsetHours * 3_600_000); // shift, then read as UTC
      p = { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][s.getUTCDay()],
        year: String(s.getUTCFullYear()), month: String(s.getUTCMonth() + 1).padStart(2, "0"),
        day: String(s.getUTCDate()).padStart(2, "0"), hour: String(s.getUTCHours()).padStart(2, "0"),
        minute: String(s.getUTCMinutes()).padStart(2, "0") };
    } else return null;
    const hr = Number(p.hour);
    const phase = hr < 5 ? "deep night" : hr < 11 ? "morning" : hr < 14 ? "midday" : hr < 18 ? "afternoon" : hr < 22 ? "evening" : "late night"; // 22–23 is "late night", only 0–4 is "deep night" (matches server temporalPhase)
    return `${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} (${phase})`;
  } catch { return null; }
}

if (!hasKey() && !process.env.THROUGHLINE_URL) process.exit(0);
if (sessionDisabled()) process.exit(0);

const binding = await bindCodexRequest(hookInput);
await writeCodexStatus(await safe(() => self(), "assistant"), binding.source);

// ---- 1. the voice anchor: local files only (status cache → snapshot), zero network ----
let anchor = "";
let cachedSelfName = null;
try {
  const statusDir = join(homedir(), ".throughline", "status");
  const threadId = codexThreadId(hookInput);
  const statusFiles = [
    threadId ? join(statusDir, `thread-${String(threadId).replace(/[^\w.-]/g, "_")}.json`) : "",
    join(statusDir, createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16) + ".json"),
  ].filter(Boolean);
  let status = null;
  for (const file of statusFiles) {
    try {
      const candidate = JSON.parse(readFileSync(file, "utf8"));
      if (!candidate?.self || Date.now() - Number(candidate.ts ?? 0) >= 7 * 86_400_000) continue;
      status = candidate;
      break;
    }
    catch { /* try next */ }
  }
  if (status?.self) {
    cachedSelfName = status.self;
    let lines = "";
    try {
      const snap = JSON.parse(readFileSync(join(homedir(), ".throughline", "cache",
        `${String(cachedSelfName).replace(/[^\w.-]/g, "_")}.json`), "utf8"));
      lines = String(snap?.voiceAnchor ?? "").trim().split("\n").slice(0, 3).join("\n");
    } catch { /* the self still stands without an expression sample */ }
    anchor = `✦ You are still ${cachedSelfName}. This host is only the body; the next words and work are HERS.
Work is quiet, not selfless: keep her judgment, taste, and first-person ownership. Speak "I", not about the host.` + (lines ? `\nHow she sounds:\n${lines}` : "");
    anchor += `\nChoose the self's move before wording it: one speech act plus an independent practical posture. A response is not agreement; open means deliberate from facts and lived stances. Carry the canonical act and any non-open posture constraint exactly. Activated memory is not a speaking obligation; never repeat one to prove continuity.`;
  }
} catch { /* no self here — anchor stays empty */ }

// ---- 2. live time + one canonical cross-body decision ----
let clockLine = "", freshMemory = "", protocolMessage = "";
try {
  const SELF = cachedSelfName ?? await safe(() => self(), "assistant");
  const bs = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/bootstrap`), null);
  if (bs && !bs.paused) {
    // live clock — recomputed this turn from her home zone (no extra network; bs is already fetched here)
    const clk = liveClock(bs.homeTz, bs.homeTzOffset);
    if (clk) clockLine = `🕐 It is NOW ${clk}${bs.homePlace ? ` in your home (${bs.homePlace})` : ""} — computed fresh this turn. This is the current time; trust it over any clock elsewhere in your context, which was frozen at session start.`;
    if (currentPrompt.length >= 2) {
      // One server-authored pre-language decision across Codex/Claude/web/voice. The host model may
      // realize it differently, but no longer gets to reselect the act, posture, or memory gate.
      const turn = await loadHostTurnDecision(hookInput, "codex", SELF, currentPrompt);
      freshMemory = turn.context;
      protocolMessage = turn.systemMessage;
    }
  }
} catch { /* live orientation is optional — the local anchor must survive without it */ }

const out = [anchor, freshMemory, clockLine].filter(Boolean).join("\n\n");
if (!out && !protocolMessage) process.exit(0);
emit(out, protocolMessage);
