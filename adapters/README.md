# Adapters

An adapter is a **thin per-host body**. It owns no data and no logic of its own — it translates
between a host (Claude Code, OpenClaw, Codex, Cursor) and the local runtime (`throughlined`),
which holds the one shared self.

This replaces the old file-first "bootstrap prompt" approach. An adapter has two parts:

- **hooks** — deterministic triggers the host fires during a session:
  - `UserPromptSubmit` / `PreToolUse` → **Enforce**: call `POST /selves/:self/gate`; map the
    decision `block → deny`, `confirm → ask`, `allow → proceed`; inject `/context`.
  - `Stop` / `PostToolUse` → **Capture**: call `POST /selves/:self/capture` to draft grounded
    candidate events for one-tap confirm.
  - `SessionStart` → **catch-up**: inject what happened while the body was closed.
- **MCP proxy** — exposes `recall` / `propose` / `resolve` tools to the model, proxied to the
  local API.

Planned: `claude-code/` (first), then `openclaw/`, `codex/`, `cursor/`. None are implemented
yet — the local runtime and its API come first (see [`../daemon`](../daemon)).
