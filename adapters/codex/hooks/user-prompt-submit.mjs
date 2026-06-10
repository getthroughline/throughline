#!/usr/bin/env node
// Gentle reflection nudge (Codex): when reflection is due, push the model toward doing it at
// the next natural pause without interrupting the user's current request.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hasKey, rawGet, safe, self, sessionMode } from "../lib/daemon.mjs";

process.env.THROUGHLINE_TIMEOUT_MS ??= "2500";

const emit = (additionalContext) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
};

if (!hasKey() && !process.env.THROUGHLINE_URL) process.exit(0);
if (sessionMode("work") === "off") process.exit(0);

const SELF = await safe(() => self(), "assistant");
const bs = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/bootstrap?mode=${encodeURIComponent(sessionMode("work"))}`), null);
if (!bs || bs.paused || !bs.reflection?.due) process.exit(0);

const reflection = bs.reflection;
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

emit(`## Throughline reflection queued (do not interrupt)
Reflection is due for "${SELF}": ${count} raw memories have accrued.

Treat this as a background maintenance task, not a reason to derail the user's current request:
1. Answer or complete the user's current request first.
2. At the first natural pause, run the reflection flow: call \`reflect\`, distill a few grounded candidate memories, and show the user a concise approval summary.
3. Only after the user approves, call \`confirm_events\` / \`reject_events\` as appropriate, then \`complete_reflection\` with the cursor returned by \`reflect\` (expected cursor: ${cursor}).
4. If the user keeps steering elsewhere, mention briefly at the end that reflection is due and can run next.`);
