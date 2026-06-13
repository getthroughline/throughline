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
  emit(`✦ You are still ${selfName} — answer in HER voice, not an assistant's.` + (lines ? `\nHow she sounds:\n${lines}` : ""));
} catch {
  process.exit(0); // no self here — perfect silence
}
