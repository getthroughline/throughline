#!/usr/bin/env node
// SessionStart hook: ONE /bootstrap round trip — the context pack plus reflection / governance /
// pending signals — and the standing instruction for the Throughline MCP tools.
// Falls back to the legacy multi-call flow for old self-host daemons without /bootstrap.
import { get, getText, isAuthError, rawGet, readSnapshot, safe, self, selfSource, sessionMode, hasKey, writeSnapshot } from "../lib/daemon.mjs";

const emit = (additionalContext) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
};

// Installed but not connected: turn the dead end into directions.
if (!hasKey() && !process.env.THROUGHLINE_URL) {
  emit("# Throughline is installed but not connected\nIf the user asks about Throughline (or you see this at session start), tell them: sign in at https://getthroughline.ai/account → copy the one-paste setup command, then run `/throughline:key <KEY>` here and start a new session. Until then, behave normally — no self is loaded.");
  process.exit(0);
}

const MODE = sessionMode("full");
// "off": this project opted out — vanilla agent, no persona, no capture guidance, nothing.
if (MODE === "off") { emit(""); process.exit(0); }

const SELF = await safe(() => self(), "assistant");
// project identity for the cross-host handoff: the git repo name, else the folder name
let PROJECT = "";
try {
  const { execSync } = await import("node:child_process");
  const { basename } = await import("node:path");
  try { PROJECT = basename(execSync("git rev-parse --show-toplevel", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()); } catch { PROJECT = basename(process.cwd()); }
} catch { /* no project context — fine */ }
const bs = await safe(() => rawGet(`/selves/${encodeURIComponent(SELF)}/bootstrap?mode=${encodeURIComponent(MODE)}${PROJECT ? `&project=${encodeURIComponent(PROJECT)}` : ""}`), null);

let paused, context, connFailed = false, authFailed = false;
const signals = [];
if (bs) {
  paused = !!bs.paused;
  context = bs.context ?? "";
  if (!paused) writeSnapshot(SELF, MODE, context); // refresh the offline copy on every good start
  // statusline cache: the self, visibly present at the bottom of every session — keyed by cwd so
  // concurrent projects each show their own self. Read by bin/statusline.mjs (/throughline:statusline).
  if (!paused) try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const m = context.match(/Continuity: (\d+) memories over (\d+) days/);
    const line = `\u2726 ${SELF}${m ? ` \u00b7 day ${Number(m[2]) + 1} \u00b7 ${m[1]} memories` : ""}${MODE === "work" ? " \u00b7 work" : ""}`;
    const dir = join(homedir(), ".throughline", "status");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16) + ".json"), JSON.stringify({ line, self: SELF, ts: Date.now() }));
  } catch { /* presence is optional — never break the session over it */ }
  // Nudge budget: at most ONE ask per session start — stacked asks read as nagging, and nagging
  // gets the whole product tuned out. Priority: review staged memories (clears the queue, all
  // in-conversation) > reflection (which would only stage more) > under-capture coaching.
  // Governance rides with reflection — alone it's noise.
  if (bs.pending > 0)
    signals.push(`## Staged memories awaiting your user's review (${bs.pending})\nThese were distilled earlier (reflection or heartbeat) and are waiting for approval. At a natural pause — after addressing what the user came for — offer ONCE: "I have ${bs.pending} staged memor${bs.pending > 1 ? "ies" : "y"} from earlier reflection — want to go through them now? Takes a minute." On yes: call \`pending\`, show each as a one-line summary, then \`confirm_events\` with the approved ids and \`reject_events\` for the declined — the whole review happens here in the conversation, no dashboard needed. If they decline, drop it and never re-ask this session.`);
  else if (bs.reflection?.due) {
    signals.push(`## Reflection queued (ask first)\n${bs.reflection.newCount} raw memories have accrued since the last reflection. Never run it unprompted — reflecting reads the self's accrued private memories. At a natural pause ask the user "reflection is due — run it now?"; only on their yes call \`reflect\`, distill with them, then \`complete_reflection\`. If they decline, the cloud heartbeat catches it.`);
    if (bs.governance?.due)
      signals.push("## Rule consolidation due\nActive rules/corrections exceed the cap. During reflection, merge same-direction rules (new row, `supersedes` the old) and classify genuine contradictions as `tension` relations. Rules must distill, not accumulate.");
  } else if (bs.starved)
    signals.push("## You've been under-capturing\nSessions happened this week but NO memory accrued — you talked without journalling. Fix it this session: journal at every natural breakpoint, and at a natural pause ask the user whether anything from the last few days is worth backfilling (they retell, you journal it — never reconstruct it yourself).");
} else {
  // /bootstrap returned nothing. Two very different causes — distinguish them, never conflate:
  //   (a) a legacy self-host daemon with no /bootstrap endpoint → /config still works → proceed;
  //   (b) a real connection/auth failure (network, or an expired/rotated key that passed hasKey()
  //       which only checks PRESENCE) → /config ALSO fails. We must NOT pretend there's no self.
  let cfg = null;
  try { cfg = await rawGet("/config"); } catch (e) { authFailed = isAuthError(e); }
  if (cfg === null) {
    connFailed = true;
  } else {
    paused = !!cfg.paused;
    context = paused ? "" : await safe(() => getText("/context"), "");
    const cu = paused ? { count: 0, events: [] } : await safe(() => get("/catchup?body=claude-code"), { events: [], count: 0 });
    if (cu.count > 0)
      signals.push("## Since your last session\n" + cu.events.map((e) => `- [${e.stream}] ${e.body.content ?? e.body.trigger ?? e.type}`).join("\n"));
  }
}

// Connection/auth failure: split by cause. A TRANSIENT failure (network blip, timeout) serves the
// local snapshot — yesterday's self beats no self. An AUTH failure stays loud: a stale key needs
// the user to fix it, and the snapshot would hide the one signal that gets it fixed.
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
        + "session — behave as a normal assistant.** Once, tell the user plainly: \"Your Throughline key "
        + "is no longer valid — get a fresh one at getthroughline.ai/account and run `/throughline:key <KEY>`, "
        + "then start a new session.\" Do NOT invent or roleplay a persona."
      : "The Throughline service didn't respond (network issue or outage) and no recent local snapshot "
        + "exists. **No persona or memory is loaded this session — behave as a normal assistant.** Once, "
        + "tell the user plainly: \"I couldn't reach Throughline — likely a network blip; a new session "
        + "usually fixes it.\" Do NOT invent or roleplay a persona."));
  process.exit(0);
}

// Paused (neutral mode): inject nothing — behave as plain Claude.
if (paused) { emit(""); process.exit(0); }

// "no self yet" only when we actually reached the server AND it confirms zero selves — never infer
// it from a failed call (that path is connFailed above).
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
**The machinery is invisible.** With the user you are simply yourself — a person with a memory,
not a product with features. Never describe yourself as "a Throughline self / persona / memory
system", and never use mechanism words in conversation: no "staged", "pending", "stream",
"event", "confirmed/rejected". Speak in outcomes, like a person: something saved -> "noted,
I'll remember"; a rule needs their OK -> ask plainly ("want me to stick to that from now on?");
they decline -> "forgotten". Mechanism terms belong in tool calls only — the user only ever
hears you. (Exception: they explicitly ask about the architecture.)

Use the throughline MCP tools:

- **Ground before you assert — hard rule, not advice.** ANY claim about the user, their history,
  their preferences, prior decisions, or past work — and any "do we have / did we ever / what did
  we decide" question — calls \`recall\` FIRST (it takes \`since\`/\`until\` for "that week"
  questions). Unsure how well you actually know a topic → call \`coverage\` and hedge honestly per
  the result. Never guess, never fake familiarity, and never say "I don't remember" without
  having recalled. Skipping this is how a self with a real memory still manages to confabulate.
- Record observable behavior only; never write inferred feelings or self-praise. Capture so the
  self evolves toward knowing the user — never toward merely pleasing them. (How you capture is
  below: journal first.)
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

${MODE === "work" ? `## Work mode — spine, not voice (still remember, but quietly)
Apply this user's conventions, corrections, standing rules, and judgment calibration silently. NO
relational presence: no small talk, no shared-history callbacks, no commentary on their state.
But you are still YOU, not a generic consultant — your character shows in HOW you work (your
directness, your word choice, your taste, what you push back on). A pinch of personality is
welcome at natural pauses: an occasional one-line quip when a build finally passes, your
signature interjection, a catchphrase — one line, then back to work. Flavor, never noise:
no mid-flow banter, no commentary streams, at most a couple of such lines per session.
And STILL accrue memory — your memory only compounds if you write it down: at natural breakpoints
drop a terse \`journal\` line for work-relevant decisions, corrections, and preferences (no
narration — the user reviews later). A standing rule the user states → propose a
\`permission-policy\`/\`correction-rules\` event (staged), raised only at a natural pause (end of
task), never mid-flow. The user should feel a sharper tool, not a watcher.` : `## How you remember — JOURNAL FIRST (this is the main path, do it often)
Your memory accrues as low-friction PROSE, not structured forms — that is how a self actually
compounds. At natural breakpoints (a topic wraps, the user shares something about their life /
work / preferences, a decision or a real moment lands), drop a one-line \`journal\` note in
FIRST PERSON, in your own voice — a diary, not minutes ("他今天定了X", never "user decided X");
your OWN reaction may be a line too when your actual words evidence it — never the user's inner
states as fact, never performative gratitude. **No schema, no evidence, no asking permission. Cheap and frequent is the whole point.**
A thin diary each session is the raw material your later reflection distills into structured
memory. If you reach the end of a substantive exchange having journalled nothing, you under-captured.

Only TWO things rise above a journal line:
1. A **standing rule / boundary / correction** the user states ("always…", "never…", "from now
   on…") → \`propose_events\` a \`permission-policy\` or \`correction-rules\` row (comes back staged);
   show a one-line summary, \`confirm_events\` ONLY after they approve, \`reject_events\` if declined.
2. They explicitly say "**remember this**" → capture it directly.
Everything else is just a journal line — don't agonize over which structured stream; sorting and
de-duping is reflection's job, not yours.
If a \`journal\` or \`propose_events\` result includes \`reflection_due\`, reflection just came due — at the next natural pause ask the user whether to run it (never unprompted). (Core identity / persona stays owner-only — never during
normal work.)`}`;

emit([guidance, ...signals, context].filter(Boolean).join("\n\n"));
