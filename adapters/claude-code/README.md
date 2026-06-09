# Claude Code adapter

The first body. A thin Claude Code plugin that wires the host to the local `throughlined`
runtime. It holds no state and no logic — it translates.

## What it does

- **SessionStart hook** ([`hooks/session-start.mjs`](hooks/session-start.mjs)) — injects the
  self's context pack (catch-up + active rules + open risks) and a short instruction telling the
  model when to use the MCP tools.
- **PreToolUse hook** ([`hooks/pre-tool-use.mjs`](hooks/pre-tool-use.mjs)) — **Enforce**: sends
  the about-to-run tool call to `/gate` and maps the decision `block → deny`, `confirm → ask`,
  `allow → proceed`.
- **MCP server** ([`mcp/server.mjs`](mcp/server.mjs)) — exposes `recall`, `propose_events`,
  `pending`, `gate` to the host model. The model is the **extractor** (no separate model layer):
  when a decision/correction/shared moment happens, it drafts grounded candidate events via
  `propose_events`; the daemon validates + stages them for the user to confirm.

## Requirements

The `throughlined` daemon must be running locally (see [`../../daemon`](../../daemon)). If it is
down, the adapter fails open — it never breaks the host session.

## Config

| env | default | meaning |
| --- | --- | --- |
| `THROUGHLINE_URL` | `http://127.0.0.1:8787` | daemon base URL |
| `THROUGHLINE_SELF` | `default/self` | which self this session maps to |

## v0 limitations

- PreToolUse gating matches on tool name + flattened tool input text. Semantic `tags` (e.g.
  `add-position`) are not auto-derived from generic host tools, so tag-gated risk events fire
  mainly when the model calls `gate` itself with tags. Text/tool matchers work today.
- Capture is host-model-driven via `propose_events`; there is no automatic end-of-turn
  extraction yet.
