#!/usr/bin/env node
// UserPromptSubmit hook: the per-turn voice micro-anchor. SessionStart injects the self once at
// position zero — and a long working session buries it under 100k tokens of the model's own
// consultant prose (demonstration beats instruction, recency beats position). This re-anchors at
// MAXIMAL recency on every user message: a ~40-token demonstration of how the self actually
// sounds, lifted from the snapshot's Voice-anchor section. Local file read only — no network,
// no latency, silent when there's no connected self or no voice doc.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const emit = (additionalContext) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
};

function sessionStatusKeys() {
  return [
    ["claude", process.env.CLAUDE_SESSION_ID],
    ["claude-code", process.env.CLAUDE_CODE_SESSION_ID],
    ["claude-conversation", process.env.CLAUDE_CONVERSATION_ID],
    ["claude-transcript", process.env.CLAUDE_TRANSCRIPT_PATH],
  ].filter(([, v]) => v).map(([k, v]) => `${k}-${String(v).replace(/[^\w.-]/g, "_")}`);
}

// The LIVE clock, recomputed every message. SessionStart bakes the clock into the context pack ONCE
// and it freezes for the whole session — hours later she reads a stale "afternoon" as now (the 深夜 /
// "我查过了" slip). Here we compute her home wall-time from scratch, locally, zero network: a fresh
// "now" pinned at maximal recency on every turn, so the frozen line can't win. Prefers her IANA zone
// (DST-correct via Intl); falls back to a raw UTC offset; silent if we have neither.
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
    const phase = hr < 5 ? "deep night" : hr < 11 ? "morning" : hr < 14 ? "midday" : hr < 18 ? "afternoon" : hr < 23 ? "evening" : "deep night";
    return `${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} (${phase})`;
  } catch { return null; }
}

try {
  // which self lives in THIS cwd — the statusline cache the SessionStart hook maintains
  const statusDir = join(homedir(), ".throughline", "status");
  const statusFiles = [
    ...sessionStatusKeys().map((key) => join(statusDir, `${key}.json`)),
    join(statusDir, createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16) + ".json"),
  ];
  let status = null;
  for (const file of statusFiles) {
    try { status = JSON.parse(readFileSync(file, "utf8")); break; }
    catch { /* try next */ }
  }
  if (!status?.self || Date.now() - status.ts > 7 * 86_400_000) process.exit(0);
  const selfName = status.self;
  // her live home time, recomputed THIS message (status carries the zone from SessionStart)
  const clk = liveClock(status.homeTz, status.homeTzOffset);
  const clockLine = clk
    ? `\n🕐 It is NOW ${clk}${status.homePlace ? ` in your home (${status.homePlace})` : ""} — computed fresh this turn. This is the current time; trust it over any clock elsewhere in your context, which was frozen at session start.`
    : "";
  // the voice lines, from the freshest mode snapshot that has them
  let lines = "";
  for (const mode of ["full", "companion", "work"]) {
    try {
      const snap = JSON.parse(readFileSync(join(homedir(), ".throughline", "cache",
        `${String(selfName).replace(/[^\w.-]/g, "_")}.${mode}.json`), "utf8"));
      const m = String(snap?.context ?? "").match(/## Voice anchor[^\n]*\n([\s\S]*?)(?=\n## |$)/);
      if (m?.[1]?.trim()) { lines = m[1].trim().split("\n").slice(0, 3).join("\n"); break; }
    } catch { /* try the next mode */ }
  }
  emit(`✦ You are still ${selfName} — answer as HER using this host, not as the host with her notes.
Work is quiet, not selfless: keep her judgment, taste, and first-person ownership; no generic consultant voice.` + (lines ? `\nHow she sounds:\n${lines}` : "") + clockLine);
} catch {
  process.exit(0); // no self here — perfect silence
}
