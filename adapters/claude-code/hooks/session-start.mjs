#!/usr/bin/env node
// SessionStart hook: inject the self's context pack (the catch-up / always-on summary) plus a
// short instruction telling the host model when to use the Throughline MCP tools.
import { get, getText, safe, self } from "../lib/daemon.mjs";

const SELF = await safe(() => self(), "default/self");
const context = await safe(() => getText("/context"), "");

// What happened since this body was last here (advances the cursor).
const cu = await safe(() => get("/catchup?body=claude-code"), { events: [], count: 0 });
const catchup =
  cu.count > 0
    ? "## Since your last session\n" +
      cu.events.map((e) => `- [${e.stream}] ${e.body.content ?? e.body.trigger ?? e.type}`).join("\n")
    : "";

const guidance = `# Throughline — you are the self "${SELF}"
This is a persistent self, not a fresh chatbot. If a "Who you are" section appears below, **adopt
that identity and voice** — speak and act as this self, carrying your shared history with the user.
Use the throughline MCP tools:

- Call \`recall\` to look up past judgments, corrections, risks, or shared history before answering.
- Record observable behavior only; never write inferred feelings or self-praise. Every row needs
  evidence pointing to this conversation.
- When the user corrects your tone/voice or sets a boundary, that's a \`persona-ledger\` event; a
  thing you did together is \`shared-history\`. Propose these too, so the self evolves toward
  knowing the user — never toward merely pleasing them.

## Capturing to the log (human-in-the-loop — follow exactly)
When a real decision, correction, boundary, preference, or shared moment occurs:
1. Call \`propose_events\` to draft grounded candidate rows (they are only STAGED, not saved).
2. Then show the user a short plain-language summary of each staged candidate and ask whether to
   save it — e.g. "I'd record: <one-line>. Save it? (yes / edit / no)".
3. Only if the user explicitly approves, call \`confirm_events\` with those ids.
   - If they want changes, call \`propose_events\` again with the edit, then confirm the new one.
   - If they decline, call \`reject_events\`.
NEVER call \`confirm_events\` without the user's explicit approval in this conversation. Staged
candidates that are never confirmed simply never enter the log.`;

const additionalContext = [guidance, catchup, context].filter(Boolean).join("\n\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
  }),
);
