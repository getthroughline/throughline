#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryReviewSignal as codexSignal, MEMORY_REVIEW_COOLDOWN_MS } from "../adapters/codex/lib/memory-review.mjs";
import { memoryReviewSignal as claudeSignal } from "../adapters/claude-code/lib/memory-review.mjs";

const stateDir = await mkdtemp(join(tmpdir(), "throughline-memory-review-"));
const first = codexSignal("cocomi", 117, { stateDir, now: 1_000 });
assert.match(first ?? "", /show 5 at most/);
assert.match(first ?? "", /We don't have to do them all/);
assert.doesNotMatch(first ?? "", /Takes a minute|go through them now/);

assert.equal(
  claudeSignal("cocomi", 117, { stateDir, now: 2_000 }),
  null,
  "a Codex offer must suppress the same nudge in Claude Code",
);
assert.equal(codexSignal("cocomi", 117, { stateDir, now: 1_000 + MEMORY_REVIEW_COOLDOWN_MS - 1 }), null);
assert.ok(codexSignal("cocomi", 117, { stateDir, now: 1_000 + MEMORY_REVIEW_COOLDOWN_MS }));

assert.equal(codexSignal("cocomi", 0, { stateDir, now: 2_000 + MEMORY_REVIEW_COOLDOWN_MS }), null);
assert.match(claudeSignal("cocomi", 2, { stateDir, now: 2_001 + MEMORY_REVIEW_COOLDOWN_MS }) ?? "", /show 2 at most/);

assert.equal(
  readFileSync(new URL("../adapters/codex/lib/memory-review.mjs", import.meta.url), "utf8"),
  readFileSync(new URL("../adapters/claude-code/lib/memory-review.mjs", import.meta.url), "utf8"),
  "memory review behavior must stay byte-identical across work bodies",
);

for (const file of [
  "../adapters/codex/hooks/session-start.mjs",
  "../adapters/claude-code/hooks/session-start.mjs",
]) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  assert.match(source, /memoryReviewSignal/);
  assert.doesNotMatch(source, /Takes a minute/);
  assert.doesNotMatch(source, /Staged memories awaiting/);
  assert.doesNotMatch(source, /Reflection queued|reflection is due — run it now/);
  assert.match(source, /Routine reflection is automatic cloud metabolism/);
}

const codexPrompt = readFileSync(new URL("../adapters/codex/hooks/user-prompt-submit.mjs", import.meta.url), "utf8");
assert.doesNotMatch(codexPrompt, /Throughline reflection queued|THROUGHLINE_REFLECTION_NUDGE/);

for (const file of [
  "../adapters/codex/mcp/server.mjs",
  "../adapters/claude-code/mcp/server.mjs",
]) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  assert.doesNotMatch(source, /_reflection_nudge/);
  assert.match(source, /Routine reflection runs automatically in the cloud/);
}

console.log("Memory review verification passed.");
