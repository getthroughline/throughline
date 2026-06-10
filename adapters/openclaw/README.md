# Throughline for OpenClaw

Carries a Throughline self into an OpenClaw workspace — same self, same memory as the web,
Claude Code, Codex, and ChatGPT. In OpenClaw's native idiom: one exec script, two snippets.

## Install — one line

```bash
curl -fsSL https://getthroughline.ai/openclaw.sh | bash
```

It installs into `~/.openclaw/workspace`, prompts for your API key (from
https://getthroughline.ai/account) if it isn't in `~/.openclaw/.env` yet, appends the
AGENTS.md / HEARTBEAT.md blocks (once — re-running is safe), and smoke-tests the connection.

Another workspace, pinned to a specific self:

```bash
curl -fsSL https://getthroughline.ai/openclaw.sh | bash -s -- ~/.openclaw/workspace-karina haein
```

(The pin is a `.throughline` file in the workspace — same convention as the Claude Code plugin.
Manual install: copy `throughline.sh` to `scripts/`, paste the two snippets, set the key in `~/.openclaw/.env`.)

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
