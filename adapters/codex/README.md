# Codex adapter

A Codex plugin that connects Codex to the same local Throughline self as the Claude Code plugin.
Codex plugins support the same building blocks (MCP servers, skills, lifecycle hooks), so the
experience is close to Claude Code's.

## What it provides

- **MCP server** ([`.mcp.json`](.mcp.json)) — runs `throughline mcp`, exposing the tools:
  `whoami`, `recall`, `propose_events`/`confirm_events`, `draft_persona`, `create_self`/`use_self`,
  `gate`. (Requires the local daemon running — `throughline status`.)
- **SessionStart hook** ([`hooks/`](hooks/)) — injects the self's identity + memory + catch-up at
  the start of a session, so Codex adopts the self automatically.
- **Skill** ([`skills/throughline`](skills/throughline)) — guidance for being the self, capturing
  with confirmation, and authoring the persona.

## Install

```sh
codex plugin marketplace add nianliu-tech/throughline
codex plugin install throughline
```

(Or repo-/personal-scoped marketplaces — see Codex's plugin docs.) The daemon + `throughline` CLI
must be installed first (`curl -fsSL .../install.sh | sh`); the MCP entry calls `throughline mcp`.

## Status / to verify on real Codex

- The SessionStart hook's output contract (`hookSpecificOutput.additionalContext`) mirrors Claude
  Code's; confirm Codex injects it the same way.
- Codex has its own command-approval system, so deterministic pre-action Enforce gating is left to
  Codex + a voluntary `gate` call (no PreToolUse hook here yet).
