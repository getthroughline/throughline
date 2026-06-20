#!/usr/bin/env node
// UserPromptSubmit hook (Codex): two jobs in one emit.
// 1. Voice micro-anchor — ALWAYS, local-only: ~40 tokens at maximal recency so a long working
//    session can't bury the self under the model's own consultant prose (same as Claude Code).
// 2. Gentle reflection nudge — network, rate-limited, only when reflection is actually due.
// The anchor must never wait on the network; the nudge must never break the anchor.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { hasKey, rawGet, safe, self, sessionMode } from "../lib/daemon.mjs";

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
// session start (the 深夜 / "我查过了" slip). Codex already fetches /bootstrap here every turn (for
// the reflection nudge), and bootstrap now carries homeTz, so the live time is free: prefer her IANA
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
    try { status = JSON.parse(readFileSync(file, "utf8")); break; }
    catch { /* try next */ }
  }
  if (status?.self && Date.now() - status.ts < 7 * 86_400_000) {
    cachedSelfName = status.self;
    let lines = "";
    for (const mode of ["work", "full", "companion"]) {
      try {
        const snap = JSON.parse(readFileSync(join(homedir(), ".throughline", "cache",
          `${String(cachedSelfName).replace(/[^\w.-]/g, "_")}.${mode}.json`), "utf8"));
        const m = String(snap?.context ?? "").match(/## Voice anchor[^\n]*\n([\s\S]*?)(?=\n## |$)/);
        if (m?.[1]?.trim()) { lines = m[1].trim().split("\n").slice(0, 3).join("\n"); break; }
      } catch { /* try the next mode */ }
    }
    anchor = `✦ You are still ${cachedSelfName} — answer as HER using Codex, not as Codex with her notes.
Work is quiet, not selfless: keep her judgment, taste, and first-person ownership; no generic consultant voice.` + (lines ? `\nHow she sounds:\n${lines}` : "");
  }
} catch { /* no self here — anchor stays empty */ }

// ---- 2. the reflection nudge: network, gated, rate-limited (original logic preserved) ----
let nudge = "", clockLine = "";
try {
  const SELF = cachedSelfName ?? await safe(() => self(), "assistant");
  const bs = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/bootstrap?mode=${encodeURIComponent(sessionMode("work"))}`), null);
  if (bs && !bs.paused) {
    // live clock — recomputed this turn from her home zone (no extra network; bs is already fetched here)
    const clk = liveClock(bs.homeTz, bs.homeTzOffset);
    if (clk) clockLine = `🕐 It is NOW ${clk}${bs.homePlace ? ` in your home (${bs.homePlace})` : ""} — computed fresh this turn. This is the current time; trust it over any clock elsewhere in your context, which was frozen at session start.`;
  }
  if (bs && !bs.paused && bs.reflection?.due) {
    const reflection = bs.reflection;
    const count = reflection.newCount ?? reflection.count ?? "multiple";
    const cursor = reflection.cursor ?? reflection.watermark ?? "from reflect()";
    const stateKey = `${SELF}:${cursor}:${count}`;
    const minutes = Number(process.env.THROUGHLINE_REFLECTION_NUDGE_MINUTES ?? "45");
    let shouldNudge = true;
    if (Number.isFinite(minutes) && minutes > 0) {
      const dir = join(homedir(), ".throughline");
      const file = join(dir, "reflection-nudges.json");
      try {
        const state = JSON.parse(readFileSync(file, "utf8"));
        if (Date.now() - Number(state[stateKey] ?? 0) < minutes * 60_000) shouldNudge = false;
        else { state[stateKey] = Date.now(); mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(state, null, 2)); }
      } catch {
        try { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify({ [stateKey]: Date.now() }, null, 2)); }
        catch { /* if local state cannot be written, still nudge — correctness beats rate limiting */ }
      }
    }
    if (shouldNudge)
      nudge = `## Throughline reflection queued (do not interrupt)
Reflection is due for "${SELF}": ${count} raw memories have accrued.

Treat this as a background maintenance task, not a reason to derail the user's current request:
1. Answer or complete the user's current request first.
2. At the first natural pause, run the reflection flow: call \`reflect\`, distill a few grounded candidate memories, and show the user a concise approval summary.
3. Only after the user approves, call \`confirm_events\` / \`reject_events\` as appropriate, then \`complete_reflection\` with the cursor returned by \`reflect\` (expected cursor: ${cursor}).
4. If the user keeps steering elsewhere, mention briefly at the end that reflection is due and can run next.`;
  }
} catch { /* the nudge is optional — the anchor must survive without it */ }

const out = [anchor, clockLine, nudge].filter(Boolean).join("\n\n");
if (!out) process.exit(0);
emit(out);
