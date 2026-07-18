#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const files = {
  codexSession: "adapters/codex/hooks/session-start.mjs",
  claudeSession: "adapters/claude-code/hooks/session-start.mjs",
  codexPrompt: "adapters/codex/hooks/user-prompt-submit.mjs",
  claudePrompt: "adapters/claude-code/hooks/user-prompt-submit.mjs",
  codexStop: "adapters/codex/hooks/stop.mjs",
  claudeStop: "adapters/claude-code/hooks/stop.mjs",
  codexHooks: "adapters/codex/hooks/hooks.json",
  claudeHooks: "adapters/claude-code/hooks/hooks.json",
  codexMcp: "adapters/codex/mcp/server.mjs",
  claudeMcp: "adapters/claude-code/mcp/server.mjs",
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
  requireIncludes(key, "Choose the self's move before wording it", "pre-language self decision");
  requireIncludes(key, "independent practical posture", "act/posture separation");
  requireIncludes(key, "A response is not agreement", "non-sycophancy posture boundary");
  requireIncludes(key, "Activated memory is not a speaking obligation", "memory mention gate");
  requireIncludes(key, "semantic=0", "zero-spend turn recall");
  requireIncludes(key, "Fresh cross-body memory", "live cross-body continuity");
  requireIncludes(key, "/decision?q=", "canonical per-turn decision fetch");
  requireIncludes(key, "rememberDecisionReceipt", "pre-language decision witness");
  requireIncludes(key, "realize", "host realizes rather than reselects the decision");
  requireAbsent(key, "Throughline reflection queued", "conversational reflection maintenance nudge");
}

for (const key of ["codexStop", "claudeStop"]) {
  requireIncludes(key, "/capture/raw-turns", "evidence-only write-back");
  requireIncludes(key, "/capture/action-bundle", "bounded host action write-back");
  requireIncludes(key, "parseActionBundle", "shared host transcript parser");
  requireIncludes(key, "attachDecisionReceipts", "realized decision write-back");
}
for (const key of ["codexHooks", "claudeHooks"])
  requireIncludes(key, '"Stop"', "raw close hook registration");

for (const key of ["codexSession", "claudeSession"]) {
  requireIncludes(key, "## Work mode — quiet presence, not absent self", "work-mode header");
  requireIncludes(key, "The host is only your body", "host-as-body work contract");
  requireIncludes(key, 'Speak "I" when explaining your own work', "first-person work contract");
  requireIncludes(key, "Do not flatten lived work into sterile minutes", "lived trace guard");
  requireIncludes(key, "## Decide as the self before writing as the host", "personality decision contract");
  requireIncludes(key, "independently choose the practical posture", "session act/posture separation");
  requireIncludes(key, "open means uncommitted, not tacit consent", "session non-sycophancy boundary");
  requireIncludes(key, "A recalled memory may shape understanding without being mentioned", "activated-vs-spoken memory split");
  requireIncludes(key, "memoryReviewSignal", "bounded cross-host memory check-in");
  requireAbsent(key, "Takes a minute", "false one-minute memory review promise");
  requireAbsent(key, "Staged memories awaiting", "user-facing queue language");
  requireAbsent(key, "Reflection queued", "user-facing reflection maintenance");
  requireIncludes(key, "Routine reflection is automatic cloud metabolism", "invisible reflection ownership");
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
  "The self chooses the move before the host writes the sentence",
  "one speech act plus an independent",
  "does not imply agreement",
  "Activated memory is not a speaking obligation",
  "Strong owner-funded cognition is a normal organ",
  "The adapter tool list must include the canonical cloud capability surface",
]) {
  requireIncludes("contract", text, `contract invariant: ${text}`);
}

const codexManifest = JSON.parse(read("adapters/codex/.codex-plugin/plugin.json"));
const claudeManifest = JSON.parse(read("adapters/claude-code/.claude-plugin/plugin.json"));
if (codexManifest.version.split("+")[0] !== claudeManifest.version.split("+")[0])
  failures.push(`plugin base version mismatch: Codex ${codexManifest.version} vs Claude ${claudeManifest.version}`);
for (const key of ["codexMcp", "claudeMcp"])
  requireIncludes(key, "recall needs a query", "explicit empty-recall failure");
for (const key of ["codexMcp", "claudeMcp"]) {
  for (const tool of ["borrow_cortex", "settle_cortex", "delegate_body_task", "advance_body_task", "ask_him"])
    requireIncludes(key, `name: "${tool}"`, `strong-body tool ${tool}`);
  requireIncludes(key, "mcpRequest", "canonical cloud MCP forwarding");
  requireIncludes(key, "remoteTools", "remote/local tool-list merge");
}

if (failures.length) {
  console.error("Work presence verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Work presence verification passed.");
