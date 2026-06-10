# Throughline for OpenClaw

Carries a Throughline self into an OpenClaw workspace — same self, same memory as the web,
Claude Code, Codex, and ChatGPT. In OpenClaw's native idiom: one exec script, two snippets.

## Install (per workspace)

1. **Key** — sign in at https://getthroughline.ai/account, copy your API key, add to `~/.openclaw/.env`:
   ```
   THROUGHLINE_API_KEY=<your key>
   THROUGHLINE_SELF=<self name>        # optional pin; otherwise the account default
   ```
2. **Script** — copy `throughline.sh` into the workspace `scripts/` and `chmod +x` it.
3. **AGENTS.md** — paste the block from `AGENTS-SNIPPET.md` into the workspace `AGENTS.md`.
4. **HEARTBEAT.md** — paste the block from `HEARTBEAT-SNIPPET.md` into the workspace `HEARTBEAT.md`.

## What you get

- **Session start**: `throughline.sh bootstrap` returns the self-context (persona, rules,
  most-alive memories) plus reflection/pending signals — the AGENTS.md block tells the model
  to run it and fully adopt the identity.
- **Journal-first capture**: the model drops one-line diary notes via `throughline.sh journal`
  at natural moments — no schema, no ceremony. Standing rules go through `propose` and stage
  for your confirmation.
- **Heartbeat reflection**: the HEARTBEAT.md block distills accrued raw memory into lasting
  structured memory on OpenClaw's own cadence — the same consolidation contract as every
  other host, run by your model.

Memory written here surfaces everywhere; memory written anywhere surfaces here.
