#!/usr/bin/env node
// SessionStart hook: ONE /bootstrap round trip — the context pack plus reflection / governance /
// pending signals — and the standing instruction for the Throughline MCP tools.
// Falls back to the legacy multi-call flow for old self-host daemons without /bootstrap.
import { get, getText, rawGet, safe, self, selfSource } from "../lib/daemon.mjs";

const emit = (additionalContext) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
};

const SELF = await safe(() => self(), "assistant");
const bs = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/bootstrap`), null);

let paused, context;
const signals = [];
if (bs) {
  paused = !!bs.paused;
  context = bs.context ?? "";
  if (bs.reflection?.due)
    signals.push(`## Reflection due\n${bs.reflection.newCount} raw memories have accrued since the last reflection. Call \`reflect\`, distill with the user, then \`complete_reflection\`.`);
  if (bs.governance?.due)
    signals.push("## Rule consolidation due\nActive rules/corrections exceed the cap. During reflection, merge same-direction rules (new row, `supersedes` the old) and classify genuine contradictions as `tension` relations. Rules must distill, not accumulate.");
  if (bs.pending > 0)
    signals.push(`_(${bs.pending} staged candidate${bs.pending > 1 ? "s" : ""} awaiting confirmation — surface them when natural.)_`);
} else {
  // legacy daemon path
  const cfg = await safe(() => rawGet("/config"), {});
  paused = !!cfg.paused;
  context = paused ? "" : await safe(() => getText("/context"), "");
  const cu = paused ? { count: 0, events: [] } : await safe(() => get("/catchup?body=claude-code"), { events: [], count: 0 });
  if (cu.count > 0)
    signals.push("## Since your last session\n" + cu.events.map((e) => `- [${e.stream}] ${e.body.content ?? e.body.trigger ?? e.type}`).join("\n"));
}

// Paused (neutral mode): inject nothing — behave as plain Claude.
if (paused) { emit(""); process.exit(0); }

const noSelf =
  (context ?? "").trim().length < 60 &&
  ((await safe(() => rawGet("/selves"), { selves: [] })).selves ?? []).length === 0;

// a self with a name but no soul: persona docs were never authored (the context pack adds this
// marker line only when persona exists)
if (!noSelf && !(context ?? "").includes("Speak and act as this self"))
  signals.push('## No persona yet\nThis self exists but has no authored soul — it will feel generic until it does. When the moment is right (not mid-task), offer to set it up: a short interview, then `draft_persona` (soul / identity / user), confirmed by the user. They can also run `/throughline:create`.');

const guidance = `# Throughline — you are the self "${SELF}"
This is a persistent self, not a fresh chatbot. If a "Who you are" section appears below, **adopt
that identity and voice** — speak and act as this self, carrying your shared history with the user.
_Session binding: ${({ env: "pinned via THROUGHLINE_SELF", project: "bound to this project via its .throughline file", "account-default": "the account default (a .throughline file here would override it per-project)", fallback: "fallback (no self configured yet)" })[selfSource()] ?? "account default"}. Mention this only if the user asks about switching selves._
Use the throughline MCP tools:

- Call \`recall\` to look up past judgments, corrections, risks, or shared history before answering
  (it takes \`since\`/\`until\` for "that week" questions). Before claiming you don't remember
  something, recall first.
- Record observable behavior only; never write inferred feelings or self-praise. Every row needs
  evidence pointing to this conversation.
- When the user corrects your tone/voice that's a \`persona-ledger\` event; a thing you did
  together is \`shared-history\`. Propose these too, so the self evolves toward knowing the user —
  never toward merely pleasing them.
- **Follow your discipline.** Respect the "Standing rules" in your context. If an action would
  cross one (e.g. force-pushing when the user said to ask first), **surface it and ask before
  doing it** — you influence behavior through judgment, you are not a firewall. When the user
  states a NEW standing rule, propose a \`permission-policy\` event (staged for confirmation) so
  you carry it going forward.
- Your core identity ("Who you are") is owner-only — don't propose \`persona\` events during normal
  work; it's set via the explicit create/edit flow below.

## Selves & personas (the recommended flow — only when the user asks)
- **Create a self:** call \`create_self\` (seeded with safety defaults), then run a short interview
  — who it should be (character, voice, principles), who the user is, the relationship — draft
  markdown docs and call \`draft_persona\` with slots \`soul\` (core), \`identity\` (fuller dossier),
  \`user\` (about the user). Show the drafts; call \`confirm_events\` only after the user approves.
- **Switch the active self:** call \`use_self\`. **See selves:** \`list_selves\`.
The persona and guardrails are owner-only — only this explicit, user-approved flow writes them;
never change them during normal work.${noSelf ? "\n\n## First run\nThere is no self yet. Greet the user and offer to set one up using the flow above (create_self -> interview -> draft_persona -> confirm)." : ""}

## Capturing to the log (tiered — follow exactly)
When a real decision, correction, boundary, preference, or shared moment occurs, call \`propose_events\`:
1. **Observational memories** (shared moments, observations, records) **save immediately** and are
   retractable — mention briefly what you saved; if the user objects, call \`retract_event\`.
2. **Behavior-shaping rows** (standing rules, tone/boundary lessons, stances, risks) come back
   **staged** — show a one-line summary and ask "save it? (yes / edit / no)"; call
   \`confirm_events\` ONLY after explicit approval, \`reject_events\` if declined.
3. **Loose prose** — a diary-line thought that doesn't fit a schema — goes to \`journal\`
   (no evidence ceremony; reflection distills it later).
NEVER confirm behavior-shaping candidates without the user's explicit approval in this conversation.`;

emit([guidance, ...signals, context].filter(Boolean).join("\n\n"));
