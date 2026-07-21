# Codex adapter

A Codex plugin that connects Codex to the same Throughline self as the Claude Code plugin. Codex
supports the same building blocks (MCP servers, skills, lifecycle hooks), so the experience is
close to Claude Code's. It is the same self in a work-capable body; the current scene shapes expression
without selecting a separate personality mode.

## What it provides

- **MCP server** ([`mcp/server.mjs`](mcp/server.mjs), via [`.mcp.json`](.mcp.json)) — exposes the
  Throughline tools (`whoami`, `recall`, `journal`, `propose_events`, `reflect`, …). Consequential
  Throughline hands carry the exact open host-turn identity so the cloud can enforce the same signed posture that
  shaped the current answer; stale or unbound hands fail closed.
- **SessionStart hook** ([`hooks/`](hooks/)) — loads the self's identity + memory at session
  start so Codex adopts it automatically.
- **Skill** ([`skills/throughline`](skills/throughline)) — guidance for being the self and
  capturing with confirmation.

## Install

```
/plugin marketplace add getthroughline/throughline
/plugin install throughline
```

Restart, then save your key: `/throughline:key <YOUR_KEY>` (from
[getthroughline.ai/account](https://getthroughline.ai/account)).
