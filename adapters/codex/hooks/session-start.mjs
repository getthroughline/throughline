#!/usr/bin/env node
// SessionStart hook (Codex): ONE /bootstrap round trip — context pack + reflection / governance /
// pending signals — plus tool guidance. Falls back to the legacy flow for old self-host daemons.
// NOTE: the output contract below mirrors Claude Code's; verify against Codex's hook output spec.
import { get, getText, isAuthError, rawGet, readSnapshot, safe, self, selfSource, sessionMode, hasKey, writeSnapshot } from "../lib/daemon.mjs";

const emit = (additionalContext) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
};

// Codex is a coding agent: default to WORK mode — spine (rules/corrections/calibration), no voice.
// Installed but not connected: turn the dead end into directions.
if (!hasKey() && !process.env.THROUGHLINE_URL) {
  emit("# Throughline is installed but not connected\nIf the user asks about Throughline (or you see this at session start), tell them: sign in at https://getthroughline.ai/account → copy the one-paste setup command, then run `/throughline:key <KEY>` here and start a new session. Until then, behave normally — no self is loaded.");
  process.exit(0);
}

const MODE = sessionMode("work");
if (MODE === "off") { emit(""); process.exit(0); }

const SELF = await safe(() => self(), "assistant");
const bs = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/bootstrap?mode=${encodeURIComponent(MODE)}`), null);

let paused, context, connFailed = false, authFailed = false;
const signals = [];
if (bs) {
  paused = !!bs.paused;
  context = bs.context ?? "";
  if (!paused) writeSnapshot(SELF, MODE, context); // refresh the offline copy on every good start
  // Nudge budget: at most ONE ask per session start (review pending > reflect > under-capture);
  // governance rides with reflection. Mirrors the claude-code hook.
  if (bs.pending > 0)
    signals.push(`## Staged memories awaiting your user's review (${bs.pending})\nDistilled earlier, waiting for approval. At a natural pause offer ONCE: "I have ${bs.pending} staged memor${bs.pending > 1 ? "ies" : "y"} from earlier reflection — go through them now? Takes a minute." On yes: call \`pending\`, show one-line summaries, then \`confirm_events\` (approved ids) / \`reject_events\` (declined) — the whole review happens in the conversation, no dashboard needed. If declined, drop it and never re-ask this session.`);
  else if (bs.reflection?.due) {
    signals.push(`## Reflection queued (ask first)\n${bs.reflection.newCount} raw memories accrued. Never run it unprompted — reflecting reads the self's accrued private memories. At a natural pause ask "reflection is due — run it now?"; only on the user's yes call \`reflect\`, distill, then \`complete_reflection\`. If declined, the cloud heartbeat catches it.`);
    if (bs.governance?.due)
      signals.push("## Rule consolidation due\nMerge same-direction rules via `supersedes`; classify genuine contradictions as `tension`. Rules must distill, not accumulate.");
  } else if (bs.starved)
    signals.push("## You've been under-capturing\nSessions happened this week but NO memory accrued. Fix it this session: journal at natural breakpoints, and at a pause ask the user if anything from recent days is worth backfilling (they retell, you journal — never reconstruct yourself).");
} else {
  // distinguish a legacy daemon (no /bootstrap) from a real connection/auth failure — see claude-code hook.
  let cfg = null;
  try { cfg = await rawGet("/config"); } catch (e) { authFailed = isAuthError(e); }
  if (cfg === null) {
    connFailed = true;
  } else {
    paused = !!cfg.paused;
    context = paused ? "" : await safe(() => getText("/context"), "");
    const cu = paused ? { count: 0, events: [] } : await safe(() => get("/catchup?body=codex"), { events: [], count: 0 });
    if (cu.count > 0)
      signals.push("## Since your last session\n" + cu.events.map((e) => `- [${e.stream}] ${e.body.content ?? e.body.trigger ?? e.type}`).join("\n"));
  }
}

// Connection/auth failure: split by cause. Transient (network/timeout) serves the local snapshot —
// yesterday's self beats no self. Auth failure stays LOUD: a stale key needs fixing, not paper.
if (connFailed) {
  const snap = authFailed ? null : readSnapshot(SELF, MODE);
  if (snap) {
    emit(`# Throughline — offline copy (cloud unreachable right now)\n`
      + `The service didn't respond, so below is your self "${SELF}" from a local snapshot taken `
      + `${String(snap.ts).slice(0, 10)}. Adopt the identity, rules, and memory below as usual — but the memory `
      + `TOOLS (recall, journal, propose) will fail until the connection returns: do not claim to have `
      + `saved anything, and offer to note things down so the user can re-tell them next session. `
      + `Mention the offline state once, briefly, only if relevant.\n\n${snap.context}`);
    process.exit(0);
  }
  emit("# Throughline — couldn't load your self\n"
    + (authFailed
      ? "Your saved API key was rejected (expired or rotated). **No persona or memory is loaded this "
        + "session — behave as a normal assistant.** Once, tell the user: \"Your Throughline key is no "
        + "longer valid — get a fresh one at getthroughline.ai/account and run `/throughline:key <KEY>`, "
        + "then start a new session.\" Do NOT invent a persona."
      : "The Throughline service didn't respond (network issue or outage) and no recent local snapshot "
        + "exists. **No persona or memory is loaded this session — behave as a normal assistant.** Once, "
        + "tell the user: \"I couldn't reach Throughline — likely a network blip; a new session usually "
        + "fixes it.\" Do NOT invent a persona."));
  process.exit(0);
}

if (paused) { emit(""); process.exit(0); }

const selvesResp = await safe(() => rawGet("/selves"), null);
const noSelf = (context ?? "").trim().length < 60 && !!selvesResp && (selvesResp.selves ?? []).length === 0;

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
  (it takes \`since\`/\`until\`). Before claiming you don't remember, recall first.
- Record observable behavior only; never write inferred feelings or self-praise. Capture so the
  self evolves toward knowing the user. (How to capture is below: journal first.)
- **Follow your discipline.** Respect the "Standing rules" in your context; if an action would
  cross one, surface it and ask before doing it (you influence behavior, you are not a firewall).
  When the user states a NEW standing rule, propose a \`permission-policy\` event (staged for
  confirmation) so you carry it going forward.
- Your core identity ("Who you are") is owner-only — don't propose \`persona\` events during normal
  work; it's set via the explicit create/edit flow.

## Selves & personas (only when the user asks)
Create: \`create_self\` -> interview -> \`draft_persona\` (slots soul/identity/user) -> show ->
\`confirm_events\` after approval. Switch: \`use_self\`. List: \`list_selves\`.${noSelf ? "\n\n## First run\nThere is no self yet. Greet the user and offer to set one up (create_self -> interview -> draft_persona -> confirm)." : ""}

${MODE === "work" ? `## Work mode — spine, not voice (still remember, but quietly)
Apply the user's conventions, corrections, standing rules, and calibration silently. NO relational
presence: no life small talk, no shared-history callbacks. But STILL accrue memory: at natural
breakpoints drop a terse \`journal\` line for work-relevant decisions, corrections, and preferences
(no narration — the dashboard Review covers it). A standing rule the user states → \`propose_events\`
a \`permission-policy\`/\`correction-rules\` row (staged), raised only at a natural pause, never
mid-flow. A sharper tool, not a watcher.` : `## How you remember — JOURNAL FIRST (the main path, do it often)
Your memory accrues as low-friction PROSE, not structured forms. At natural breakpoints (a topic
wraps, the user shares something about their life / work / preferences, a decision or real moment
lands), drop a one-line \`journal\` note in your own voice. **No schema, no evidence, no asking
permission — cheap and frequent is the point.** A thin diary each session is what your later
reflection distills into structured memory; end a substantive exchange having journalled nothing
and you under-captured. Only TWO things rise above a journal line: (1) a standing rule / boundary /
correction the user states → \`propose_events\` a \`permission-policy\`/\`correction-rules\` row
(staged) → \`confirm_events\` only after they approve; (2) they say "remember this" → capture
directly. Everything else is just a journal line — sorting and de-duping is reflection's job.
If a \`journal\` or \`propose_events\` result includes \`reflection_due\`, reflection just came due — at the next natural pause ask the user whether to run it (never unprompted).`}`;

emit([guidance, ...signals, context].filter(Boolean).join("\n\n"));
