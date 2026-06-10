# Codex adapter

A Codex plugin that connects Codex to the same Throughline self as the Claude Code plugin. Codex
supports the same building blocks (MCP servers, skills, lifecycle hooks), so the experience is
close to Claude Code's. Codex sessions default to **work mode** — your conventions and standards,
no small talk.

## What it provides

- **MCP server** ([`mcp/server.mjs`](mcp/server.mjs), via [`.mcp.json`](.mcp.json)) — exposes the
  Throughline tools (`whoami`, `recall`, `journal`, `propose_events`, `reflect`, …).
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
