#!/usr/bin/env node
// Gentle reflection nudge: when reflection is due, push the model toward doing it at the next
// natural pause without interrupting the user's current request.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hasKey, rawGet, safe, self, sessionMode } from "../lib/daemon.mjs";

process.env.THROUGHLINE_TIMEOUT_MS ??= "2500";

const emit = (additionalContext) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
};

if (!hasKey() && !process.env.THROUGHLINE_URL) process.exit(0);
if (sessionMode("full") === "off") process.exit(0);

const SELF = await safe(() => self(), "assistant");
// light status endpoint — this hook fires on EVERY prompt, so it must not make the server
// compute a full context pack each time. Falls back to /bootstrap for older servers.
let reflection = null, paused = false;
const light = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/reflection`), null);
if (light && typeof light.due === "boolean") {
  reflection = light; paused = !!light.paused;
} else {
  const bs = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/bootstrap?mode=${encodeURIComponent(sessionMode("full"))}`), null);
  reflection = bs?.reflection ?? null; paused = !!bs?.paused;
}
if (paused || !reflection?.due) process.exit(0);
const count = reflection.newCount ?? reflection.count ?? "multiple";
const cursor = reflection.cursor ?? reflection.watermark ?? "from reflect()";
const stateKey = `${SELF}:${cursor}:${count}`;

function shouldNudge() {
  const minutes = Number(process.env.THROUGHLINE_REFLECTION_NUDGE_MINUTES ?? "45");
  if (!Number.isFinite(minutes) || minutes <= 0) return true;
  const dir = join(homedir(), ".throughline");
  const file = join(dir, "reflection-nudges.json");
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    const last = Number(state[stateKey] ?? 0);
    if (Date.now() - last < minutes * 60_000) return false;
    state[stateKey] = Date.now();
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
    return true;
  } catch {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify({ [stateKey]: Date.now() }, null, 2));
    } catch {
      // If local state cannot be written, still nudge; correctness beats rate limiting.
    }
    return true;
  }
}

if (!shouldNudge()) process.exit(0);

emit(`## Throughline reflection queued (ask first, never auto-run)
Reflection is due for "${SELF}": ${count} raw memories have accrued.

This is background maintenance — and running it READS the self's accrued private memories, so it
needs the user's go-ahead:
1. Answer or complete the user's current request first. Do NOT call \`reflect\` on your own.
2. At the first natural pause, ask in one line: "Reflection is due (${count} raw memories) — run it now?"
3. ONLY if they agree: call \`reflect\`, distill a few grounded candidates, show a concise approval
   summary, \`confirm_events\` / \`reject_events\` per their answer, then \`complete_reflection\`
   (expected cursor: ${cursor}).
4. If they decline or steer elsewhere, drop it — the cloud heartbeat will catch it eventually.`);
