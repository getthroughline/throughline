# Throughline for OpenClaw

Carries a Throughline self into an OpenClaw workspace — same self, same memory as the web,
Claude Code, Codex, and ChatGPT. In OpenClaw's native idiom: one exec script, two snippets.

Requires `curl` and `python3` (for URL/JSON encoding) — both standard on macOS and Linux.

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
Manual install: copy `throughline.sh` to `scripts/`, paste `AGENTS-SNIPPET.md`, set the key in
`~/.openclaw/.env`.)

## What you get

- **Session start**: `throughline.sh bootstrap` returns the self-context (persona, rules,
  most-alive memories) plus a bounded review signal — the AGENTS.md block tells the model
  to run it and fully adopt the identity.
- **Journal-first capture**: the model drops one-line diary notes via `throughline.sh journal`
  at natural moments — no schema, no ceremony. Standing rules go through `propose` and stage
  for your confirmation.
- **Invisible reflection**: the cloud distills accrued raw memory on one canonical cadence.
  OpenClaw never turns memory maintenance into a user task or runs a competing distiller.

Memory written here surfaces everywhere; memory written anywhere surfaces here.
