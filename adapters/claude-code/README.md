# Claude Code adapter

A thin Claude Code plugin that connects the editor to your Throughline self in the cloud. It
holds no state and no logic — it carries your key and translates.

Work presence is quiet and first-person: do the work before narrating it, report concrete movement or
uncertainty, and never turn an answer into an explanation of the host, persona, or memory machinery.
Ordinary conversation still makes one primary move instead of a bundled assistant response.
When `whoami` carries a cross-body task assigned here, Claude continues that exact task and records
`acting`, a concrete blocking point, or a verified completion through `advance_body_task`; it does not
create a parallel todo or impersonate the return body.
Before time-sensitive work in a long session, refresh `whoami` or the local clock and rebind old
relative dates; the session-start clock is a snapshot, not a permanently live present.

## What it does

- **SessionStart hook** ([`hooks/session-start.mjs`](hooks/session-start.mjs)) — loads the self
  for this session (in one round trip) and injects its context plus a short instruction for when
  to use the tools. Honors pause; respects per-project binding.
- **MCP server** ([`mcp/server.mjs`](mcp/server.mjs)) — exposes the Throughline tools
  (`whoami`, `recall`, `journal`, `propose_events`, `reflect`, …) to the host model.
- **Slash commands** ([`commands/`](commands)) — `/throughline:create`, `:switch`, `:journal`,
  `:reflect`, and more.

## Config

| env | default | meaning |
| --- | --- | --- |
| `THROUGHLINE_API_KEY` | from `~/.throughline/auth.json` | your account key (set via `/throughline:key`) |
| `THROUGHLINE_SELF` | your account default | pin which self this session uses |

Per-project binding: put a `.throughline` file in a repo root with the self's name on the first
line (and optionally `mode=work`, or just `off`).
