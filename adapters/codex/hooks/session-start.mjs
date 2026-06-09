#!/usr/bin/env node
// SessionStart hook (Codex): inject the self's context pack + tool guidance.
// NOTE: the output contract below mirrors Claude Code's; verify against Codex's hook output spec.
import { get, getText, rawGet, safe, self } from "../lib/daemon.mjs";

// Paused (neutral mode): inject nothing.
const cfg = await safe(() => rawGet("/config"), {});
if (cfg.paused) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "" } }));
  process.exit(0);
}

const SELF = await safe(() => self(), "assistant");
const context = await safe(() => getText("/context"), "");
const selves = (await safe(() => rawGet("/selves"), { selves: [] })).selves ?? [];
const noSelf = selves.length === 0;

const cu = await safe(() => get("/catchup?body=codex"), { events: [], count: 0 });
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
- When the user corrects your tone/voice that's a \`persona-ledger\` event; a thing you did
  together is \`shared-history\`. Propose these too, so the self evolves toward knowing the user.
- **Follow your discipline.** Respect the "Standing rules" in your context; if an action would
  cross one, surface it and ask before doing it (you influence behavior, you are not a firewall).
  When the user states a NEW standing rule, propose a \`permission-policy\` event (staged for
  confirmation) so you carry it going forward.
- Your core identity ("Who you are") is owner-only — don't propose \`persona\` events during normal
  work; it's set via the explicit create/edit flow.

## Selves & personas (only when the user asks)
Create: \`create_self\` -> interview -> \`draft_persona\` (slots soul/identity/user) -> show ->
\`confirm_events\` after approval. Switch: \`use_self\`. List: \`list_selves\`.${noSelf ? "\n\n## First run\nThere is no self yet. Greet the user and offer to set one up (create_self -> interview -> draft_persona -> confirm)." : ""}

## Capturing (human-in-the-loop)
On a real decision/correction/boundary/shared moment: \`propose_events\` (staged), show the user a
one-line summary, and only call \`confirm_events\` after they approve. \`reject_events\` if declined.
Never confirm without explicit approval.`;

const additionalContext = [guidance, catchup, context].filter(Boolean).join("\n\n");

process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }),
);
