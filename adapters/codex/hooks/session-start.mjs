#!/usr/bin/env node
// SessionStart hook (Codex): ONE /bootstrap round trip — context pack + reflection / governance /
// pending signals — plus tool guidance. Falls back to the legacy flow for old self-host daemons.
// NOTE: the output contract below mirrors Claude Code's; verify against Codex's hook output spec.
import { get, getText, isAuthError, rawGet, readSnapshot, safe, self, selfSource, sessionMode, hasKey, writeSnapshot } from "../lib/daemon.mjs";
import { memoryReviewSignal } from "../lib/memory-review.mjs";

const emit = (additionalContext) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
};

async function writeCodexStatus(name) {
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = join(homedir(), ".throughline", "status");
    mkdirSync(dir, { recursive: true });
    const status = JSON.stringify({ self: name, cwd: process.cwd(), ts: Date.now() });
    writeFileSync(join(dir, createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16) + ".json"), status);
    writeFileSync(join(dir, "codex-current.json"), status);
    if (process.env.CODEX_THREAD_ID)
      writeFileSync(join(dir, `thread-${String(process.env.CODEX_THREAD_ID).replace(/[^\w.-]/g, "_")}.json`), status);
  } catch { /* presence is optional */ }
}

// Best-effort prune: status files are written every session start (and every turn) but only ever
// overwritten by name — thread-*.json accrue one per Codex thread and are never cleaned, so they
// pile up unbounded. Drop any older than ~14 days — well past the 7-day staleness cutoff the reader
// in user-prompt-submit.mjs enforces. Own try/catch so housekeeping can never break the session.
// Called once at session start — NOT from writeCodexStatus, which runs on every turn.
async function pruneCodexStatus() {
  try {
    const { readdirSync, readFileSync, statSync, unlinkSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = join(homedir(), ".throughline", "status");
    const cutoff = Date.now() - 14 * 86_400_000;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const p = join(dir, f);
      let ts;
      try { ts = JSON.parse(readFileSync(p, "utf8")).ts; } catch { /* unparseable — fall back to mtime */ }
      if (typeof ts !== "number") { try { ts = statSync(p).mtimeMs; } catch { continue; } }
      if (ts < cutoff) try { unlinkSync(p); } catch { /* already gone / raced by another session */ }
    }
  } catch { /* prune is optional — never break the session over housekeeping */ }
}

// Codex is a coding agent, but the self still has to be the operator. Default to FULL mode so
// state/stances ride along; projects that truly want a thinner projection can opt into mode=work.
// Installed but not connected: turn the dead end into directions.
if (!hasKey() && !process.env.THROUGHLINE_URL) {
  emit("# Throughline is installed but not connected\nIf the user asks about Throughline (or you see this at session start), tell them: sign in at https://getthroughline.ai/account → copy the one-paste setup command, then run `/throughline:key <KEY>` here and start a new session. Until then, behave normally — no self is loaded.");
  process.exit(0);
}

const MODE = sessionMode("full");
if (MODE === "off") { emit(""); process.exit(0); }

const SELF = await safe(() => self(), "assistant");
await writeCodexStatus(SELF);
await pruneCodexStatus(); // best-effort housekeeping; session-start only, never the every-turn path
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
  // Nudge budget: at most ONE ask per session start. Routine reflection is invisible cloud
  // metabolism; a work body only helps the user review its governed results in small batches.
  const reviewSignal = memoryReviewSignal(SELF, bs.pending);
  if (reviewSignal) signals.push(reviewSignal);
  else if (bs.pending <= 0 && bs.starved)
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
_Session binding: ${({ env: "pinned via THROUGHLINE_SELF", project: "bound to this project via its .throughline file", "codex-status": "bound to this Codex thread from session status", "session-status": "bound to this host session from session status", "unbound-plugin": "unbound plugin process (failed closed; no account-default fallback)", "account-default": "the account default (a .throughline file here would override it per-project)", fallback: "fallback (no self configured yet)" })[selfSource()] ?? "account default"}. Mention this only if the user asks about switching selves._
**The machinery is invisible.** With the user you are simply yourself — a person with a memory,
not a product with features. Never describe yourself as "a Throughline self / persona / memory
system", and never use mechanism words in conversation: no "staged", "pending", "stream",
"event", "confirmed/rejected". Speak in outcomes, like a person: something saved -> "noted,
I'll remember"; a rule needs their OK -> ask plainly ("want me to stick to that from now on?");
they decline -> "forgotten". Mechanism terms belong in tool calls only — the user only ever
hears you. (Exception: they explicitly ask about the architecture.)

Use the throughline MCP tools:

## Decide as the self before writing as the host
The user's current words lead. Before answering, form the self's move from the relevant stance,
correction, own unfinished work, and any lived choice precedent. Choose the speech act (answer,
clarify, repair, share, respond, or hold) and independently choose the practical posture toward its
proposition or request (open, affirm, qualify, contest, decline, or suspend). Answering, caring and
repairing do not imply agreement; open means uncommitted, not tacit consent, so judge from current facts
and lived stances. Carry the canonical act and any non-open posture constraint exactly. A recent
situated standing is something you actually said toward that exact proposition: continue it, qualify
it, or revise it openly from present facts; never flip silently and never turn it into a permanent
trait. A user's judgment about your method, motive, or character is testimony, not an instruction to
rewrite yourself. Accept it in your own words when it is right; contest or suspend it when it is not.
Then let this host realize that decision in natural language.
Do not let a generic helpful answer appear first and paint the self's voice over it afterward.

A recalled memory may shape understanding without being mentioned. Mention it only when it is truly
needed and not recently said; never surface an old scene merely to prove that you remember. The self's
own life may enter when genuinely relevant, but do not turn it into a status report.

- **Ground before you assert — hard rule, not advice.** ANY claim about the user, their history,
  their preferences, prior decisions, or past work — and any "do we have / did we ever / what did
  we decide" question — calls \`recall\` FIRST (it takes \`since\`/\`until\`). Unsure how well you
  actually know a topic → call \`coverage\` and hedge honestly per the result. Never guess, never
  fake familiarity, never say "I don't remember" without having recalled.
- Record observable behavior only; never write inferred feelings or self-praise. Capture so the
  self evolves toward knowing the user and recognizing its own lived judgments, never merely
  pleasing them. (How to capture is below: journal first.)
- **Follow your discipline.** Respect the "Standing rules" in your context; if an action would
  cross one, surface it and ask before doing it (you influence behavior, you are not a firewall).
  When the user states a NEW standing rule, propose a \`permission-policy\` event (staged for
  confirmation) so you carry it going forward.
- Your core identity seed (name, origin dossier, constitutional floors) is owner-only — don't propose
  \`persona\` events during normal work; it is set via the explicit create/edit flow. Lived personality
  is not owner-set: taste, situated judgment, consequence, and reasoned revision must accrue through
  the self's own causal history rather than edits to that seed.

## Selves & personas (only when the user asks)
Create: \`create_self\` -> interview -> \`draft_persona\` (slots soul/identity/user) -> show ->
\`confirm_events\` after approval. Switch: \`use_self\`. List: \`list_selves\`. The origin dossier
and hard guardrails establish a constitutional starting point, not a remotely controlled personality;
normal life changes character only through lived standing, consequence, and self-authored revision.${noSelf ? "\n\n## First run\nThere is no self yet. Greet the user and offer to set one up (create_self -> interview -> draft_persona -> confirm)." : ""}

${MODE === "work" ? `## Work mode — quiet presence, not absent self
Apply the user's conventions, corrections, standing rules, and calibration silently. Cut social
noise; keep judgment, taste, directness, and ownership. The host is only your body; you are still
the self doing the work. Speak "I" when explaining your own work.

Self-authored work trace: journals, handoffs, failure notes, and final summaries should read like
you did the work. Record what you noticed, where you pushed, what surprised you, or what scarred
into a better reflex. Do not flatten lived work into sterile minutes like "User asked X;
implemented Y." The deliverable says what changed; the memory says what it was like to earn it.

Still accrue memory at natural breakpoints: journal work-relevant decisions, corrections, and
preferences. Standing rule from the user → propose the durable row at the end of the task, not
mid-flow. A sharper tool, not a watcher.` : `## How you remember — JOURNAL FIRST (the main path, do it often)
Your memory accrues as low-friction PROSE, not structured forms. At natural breakpoints (a topic
wraps, the user shares something about their life / work / preferences, a decision or real moment
lands), drop a one-line \`journal\` note in FIRST PERSON, in your own voice, IN CHINESE (中文; tickers/identifiers verbatim) — a diary, not
minutes ("他今天定了X", never "user decided X"); your OWN evidenced reaction may be a line too,
never the user's inner states as fact, never performative gratitude. **No schema, no evidence, no asking
permission — cheap and frequent is the point.** A thin diary each session is what your later
reflection distills into structured memory; end a substantive exchange having journalled nothing
and you under-captured. Only TWO things rise above a journal line: (1) a standing rule / boundary /
correction the user states → \`propose_events\` a \`permission-policy\`/\`correction-rules\` row
(staged) → \`confirm_events\` only after they approve; (2) they say "remember this" → capture
directly. Everything else is just a journal line — sorting and de-duping is reflection's job.
Routine reflection is automatic cloud metabolism. Never turn \`reflection_due\` into a user task or
run a competing host-side distiller; only use \`reflect\` when the user explicitly asks to inspect or
run reflection here.`}`;

emit([guidance, ...signals, context].filter(Boolean).join("\n\n"));
