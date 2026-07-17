#!/usr/bin/env node
// UserPromptSubmit hook (Codex): voice micro-anchor plus a live cross-body decision. Routine
// reflection is automatic cloud metabolism and deliberately absent from the conversational path.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { hasKey, rawGet, safe, self, sessionMode } from "../lib/daemon.mjs";

let hookInput = {};
try { hookInput = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
const currentPrompt = String(hookInput.prompt ?? hookInput.user_prompt ?? hookInput.message?.content ?? "").trim();

process.env.THROUGHLINE_TIMEOUT_MS ??= "2500";

const emit = (additionalContext) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
};

async function writeCodexStatus(name) {
  try {
    const statusDir = join(homedir(), ".throughline", "status");
    mkdirSync(statusDir, { recursive: true });
    const status = JSON.stringify({ self: name, cwd: process.cwd(), ts: Date.now() });
    writeFileSync(join(statusDir, createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16) + ".json"), status);
    writeFileSync(join(statusDir, "codex-current.json"), status);
    if (process.env.CODEX_THREAD_ID)
      writeFileSync(join(statusDir, `thread-${String(process.env.CODEX_THREAD_ID).replace(/[^\w.-]/g, "_")}.json`), status);
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
if (sessionMode("work") === "off") process.exit(0);

await writeCodexStatus(await safe(() => self(), "assistant"));

// ---- 1. the voice anchor: local files only (status cache → snapshot), zero network ----
let anchor = "";
let cachedSelfName = null;
try {
  const statusDir = join(homedir(), ".throughline", "status");
  const statusFiles = [
    process.env.CODEX_THREAD_ID ? join(statusDir, `thread-${String(process.env.CODEX_THREAD_ID).replace(/[^\w.-]/g, "_")}.json`) : "",
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
    for (const mode of ["full", "companion", "work"]) {
      try {
        const snap = JSON.parse(readFileSync(join(homedir(), ".throughline", "cache",
          `${String(cachedSelfName).replace(/[^\w.-]/g, "_")}.${mode}.json`), "utf8"));
        const m = String(snap?.context ?? "").match(/## Voice anchor[^\n]*\n([\s\S]*?)(?=\n## |$)/);
        if (m?.[1]?.trim()) { lines = m[1].trim().split("\n").slice(0, 3).join("\n"); break; }
      } catch { /* try the next mode */ }
    }
    anchor = `✦ You are still ${cachedSelfName}. This host is only the body; the next words and work are HERS.
Work is quiet, not selfless: keep her judgment, taste, and first-person ownership. Speak "I", not about the host.` + (lines ? `\nHow she sounds:\n${lines}` : "");
    anchor += `\nChoose the self's move before wording it: current words first, then relevant stance, own work, and lived choices. Activated memory is not a speaking obligation; never repeat one to prove continuity.`;
  }
} catch { /* no self here — anchor stays empty */ }

// ---- 2. live time + one canonical cross-body decision ----
let clockLine = "", freshMemory = "";
try {
  const SELF = cachedSelfName ?? await safe(() => self(), "assistant");
  const bs = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/bootstrap?mode=${encodeURIComponent(sessionMode("work"))}`), null);
  if (bs && !bs.paused) {
    // live clock — recomputed this turn from her home zone (no extra network; bs is already fetched here)
    const clk = liveClock(bs.homeTz, bs.homeTzOffset);
    if (clk) clockLine = `🕐 It is NOW ${clk}${bs.homePlace ? ` in your home (${bs.homePlace})` : ""} — computed fresh this turn. This is the current time; trust it over any clock elsewhere in your context, which was frozen at session start.`;
    if (currentPrompt.length >= 2) {
      // One server-authored pre-language decision across Codex/Claude/web/voice. The host model may
      // realize it differently, but no longer gets to independently reselect the act or memory gate.
      const td = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/decision?q=${encodeURIComponent(currentPrompt.slice(0, 500))}`), null);
      if (td?.context) freshMemory = String(td.context);
      else {
        // Backward compatibility with an older/self-hosted server.
        const rr = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/recall?q=${encodeURIComponent(currentPrompt.slice(0, 500))}&k=4&semantic=0`), null);
        const rows = Array.isArray(rr?.events) ? rr.events : [];
        if (rows.length) freshMemory = "Fresh cross-body memory for THIS prompt (may shape the answer; mention only when needed):\n" +
          rows.map((e) => `- [${String(e.ts ?? "").slice(0, 10)} · ${e.stream}] ${String(e.body?.content ?? e.body?.observation ?? "").slice(0, 220)}`).join("\n");
      }
    }
  }
} catch { /* live orientation is optional — the local anchor must survive without it */ }

const out = [anchor, freshMemory, clockLine].filter(Boolean).join("\n\n");
if (!out) process.exit(0);
emit(out);
