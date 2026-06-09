#!/usr/bin/env node
// Minimal MCP stdio server (JSON-RPC 2.0, newline-delimited), no SDK / no deps.
// Exposes the local throughlined API to the host model as tools. The host model is the
// extractor; this server is just the bridge.
import { get, post } from "../lib/daemon.mjs";

const TOOLS = [
  {
    name: "recall",
    description: "Search this self's past events (judgments, corrections, risks, shared history).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        k: { type: "number", description: "max results (default 8)" },
        stream: { type: "string", description: "optional: restrict to one stream" },
      },
      required: ["query"],
    },
  },
  {
    name: "propose_events",
    description:
      "Draft grounded candidate ledger events for the user to confirm. Each event needs evidence " +
      "pointing to this conversation. Record observable facts only — no inferred feelings or self-praise.",
    inputSchema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              stream: { type: "string" },
              type: { type: "string" },
              ts: { type: "string", description: "ISO 8601" },
              body: { type: "object" },
              evidence: { type: "array", items: { type: "string" } },
              supersedes: { type: ["string", "null"] },
            },
            required: ["stream", "type", "ts", "body", "evidence"],
          },
        },
      },
      required: ["events"],
    },
  },
  { name: "pending", description: "List candidate events staged for confirmation.", inputSchema: { type: "object", properties: {} } },
  {
    name: "gate",
    description: "Check whether a proposed action is allowed (block/confirm/allow) before doing it.",
    inputSchema: {
      type: "object",
      properties: { tool: { type: "string" }, text: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case "recall": {
      const params = new URLSearchParams({ q: args.query ?? "", k: String(args.k ?? 8) });
      if (args.stream) params.set("stream", args.stream);
      return get(`/recall?${params}`);
    }
    case "propose_events":
      return post("/capture/propose", { events: args.events ?? [], source: "claude-code" });
    case "pending":
      return get("/capture/pending");
    case "gate":
      return post("/gate", { tool: args.tool, text: args.text, tags: args.tags });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function replyError(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "throughline", version: "0.0.1" },
    });
  }
  if (method === "tools/list") return reply(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      const out = await callTool(params.name, params.arguments ?? {});
      return reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
    } catch (err) {
      return reply(id, { content: [{ type: "text", text: `error: ${err.message}` }], isError: true });
    }
  }
  if (method && method.startsWith("notifications/")) return; // notifications get no response
  if (id !== undefined) return replyError(id, `unknown method: ${method}`);
}

let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handle(JSON.parse(line)).catch(() => {});
  }
});
