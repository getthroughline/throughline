# Adapters

A thin per-host client that connects an editor to your Throughline self in the cloud. It owns no
data and no logic of its own — it carries an API key, injects the self's context at session
start, and exposes the Throughline tools to the host model over MCP.

- **`claude-code/`** — Claude Code plugin (SessionStart hook + MCP server + slash commands)
- **`codex/`** — Codex plugin (same, adapted to Codex's hook contract)

Both talk to `https://getthroughline.ai` with your API key. See the top-level README to install.
