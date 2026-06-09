#!/usr/bin/env node
// SessionStart hook: inject the self's context pack (the catch-up / always-on summary) plus a
// short instruction telling the host model when to use the Throughline MCP tools.
import { getText, safe, SELF } from "../lib/daemon.mjs";

const context = await safe(() => getText("/context"), "");

const guidance = `# Throughline — continuity for self "${SELF}"
You have a persistent self via the throughline MCP tools. Use them:
- Call \`recall\` to look up past judgments, corrections, risks, or shared history before answering.
- When a real decision, correction, boundary, preference, or shared moment occurs, call
  \`propose_events\` to draft grounded candidate ledger rows (every row needs evidence pointing
  to this conversation). Proposals are staged for the user to confirm — never assert them as fact.
- Record observable behavior only; never write inferred feelings or self-praise.`;

const additionalContext = [guidance, context].filter(Boolean).join("\n\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
  }),
);
