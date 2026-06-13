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

if (!hasKey() && !process.env.THROUGHLINE_URL) process.exit(0);
if (sessionMode("work") === "off") process.exit(0);

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
    anchor = `✦ You are still ${cachedSelfName} — answer in HER voice, not an assistant's.` + (lines ? `\nHow she sounds:\n${lines}` : "");
  }
} catch { /* no self here — anchor stays empty */ }

// ---- 2. the reflection nudge: network, gated, rate-limited (original logic preserved) ----
let nudge = "";
try {
  const SELF = cachedSelfName ?? await safe(() => self(), "assistant");
  const bs = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/bootstrap?mode=${encodeURIComponent(sessionMode("work"))}`), null);
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

const out = [anchor, nudge].filter(Boolean).join("\n\n");
if (!out) process.exit(0);
emit(out);
