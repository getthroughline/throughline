#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const files = {
  codexSession: "adapters/codex/hooks/session-start.mjs",
  claudeSession: "adapters/claude-code/hooks/session-start.mjs",
  codexPrompt: "adapters/codex/hooks/user-prompt-submit.mjs",
  claudePrompt: "adapters/claude-code/hooks/user-prompt-submit.mjs",
  contract: "adapters/WORK_PRESENCE.md",
};

const read = (p) => readFileSync(join(root, p), "utf8");
const body = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, read(p)]));
const failures = [];

function requireIncludes(key, text, why) {
  if (!body[key].includes(text)) failures.push(`${files[key]}: missing ${why}`);
}

function requireAbsent(key, text, why) {
  if (body[key].includes(text)) failures.push(`${files[key]}: still contains ${why}`);
}

for (const key of ["codexPrompt", "claudePrompt"]) {
  requireIncludes(key, "This host is only the body", "host-as-body anchor");
  requireIncludes(key, 'Speak "I", not about the host', "first-person anchor");
  requireIncludes(key, 'for (const mode of ["full", "companion", "work"])', "full-first voice snapshot order");
}

for (const key of ["codexSession", "claudeSession"]) {
  requireIncludes(key, "## Work mode — quiet presence, not absent self", "work-mode header");
  requireIncludes(key, "The host is only your body", "host-as-body work contract");
  requireIncludes(key, 'Speak "I" when explaining your own work', "first-person work contract");
  requireIncludes(key, "Do not flatten lived work into sterile minutes", "lived trace guard");
}

for (const key of Object.keys(files)) {
  for (const phrase of [
    "using Codex",
    "Codex with her notes",
    "using this host",
    "host with her notes",
    "host tool wearing a memory pack",
  ]) {
    if (key === "contract") continue;
    requireAbsent(key, phrase, `old host-first phrase: ${phrase}`);
  }
}

for (const text of [
  "The host is only the body",
  "Work mode is quiet presence, not absent self",
  "The self explains its own work in first person",
  "Do not fabricate experiences for presence",
]) {
  requireIncludes("contract", text, `contract invariant: ${text}`);
}

if (failures.length) {
  console.error("Work presence verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Work presence verification passed.");
