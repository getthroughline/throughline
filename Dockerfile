# Throughline MCP server (stdio) — connects any MCP host to the user's cloud self.
# Dependency-free Node: no npm install step. Introspection (initialize / tools/list)
# works without credentials; tool calls require THROUGHLINE_API_KEY (or a
# self-hosted THROUGHLINE_URL) — get a key at https://getthroughline.ai/account.
FROM node:22-alpine
WORKDIR /app
COPY adapters/claude-code/ ./
ENTRYPOINT ["node", "mcp/server.mjs"]
