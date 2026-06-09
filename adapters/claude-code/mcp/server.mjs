#!/usr/bin/env node
// Minimal MCP stdio server (JSON-RPC 2.0, newline-delimited), no SDK / no deps.
// Exposes the local throughlined API to the host model as tools. The host model is the
// extractor; this server is just the bridge.
import { get, post, rawGet, rawPost } from "../lib/daemon.mjs";

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
    name: "confirm_events",
    description:
      "Write staged candidate events into the permanent log. ONLY call this after the user has " +
      "explicitly approved them in this conversation — never auto-confirm. ids come from " +
      "propose_events or pending.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
    },
  },
  {
    name: "reject_events",
    description: "Discard staged candidate events the user declined. ids from propose_events or pending.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
    },
  },
  {
    name: "list_selves",
    description: "List the user's selves (agents) and which is the default/active one.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_self",
    description:
      "Create a new self (agent) — only when the user asks. Starts with no preset rules; its " +
      "persona is set via the interview and its guardrails are distilled from conversation later. " +
      "The first self becomes the default. After creating, run the persona interview and call " +
      "draft_persona to give it an identity.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "use_self",
    description: "Switch the default/active self to <name> — only when the user asks.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "draft_persona",
    description:
      "Author/edit this self's persona, ONLY when the user explicitly asks to create or change it. " +
      "Interview the user (who the self should be, who they are, the relationship), then draft the " +
      "documents and call this. Each doc is a markdown string. Slots: 'soul' (core: character, " +
      "voice, principles), 'identity' (fuller dossier), 'user' (about the user). The drafts are " +
      "STAGED — show them to the user and call confirm_events with the returned ids only after they approve.",
    inputSchema: {
      type: "object",
      properties: {
        docs: {
          type: "array",
          items: {
            type: "object",
            properties: { slot: { type: "string", enum: ["soul", "identity", "user"] }, content: { type: "string" } },
            required: ["slot", "content"],
          },
        },
      },
      required: ["docs"],
    },
  },
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
    case "confirm_events": {
      const confirmed = [], notFound = [];
      for (const id of args.ids ?? []) {
        try { confirmed.push((await post("/capture/confirm", { id })).confirmed.id); }
        catch { notFound.push(id); }
      }
      return { confirmed, notFound };
    }
    case "reject_events": {
      const rejected = [];
      for (const id of args.ids ?? []) {
        const r = await post("/capture/reject", { id }).catch(() => ({ rejected: false }));
        if (r.rejected) rejected.push(id);
      }
      return { rejected };
    }
    case "list_selves": {
      const [selves, cfg] = await Promise.all([rawGet("/selves"), rawGet("/config")]);
      return { selves: selves.selves, default: cfg.default_self ?? null };
    }
    case "create_self":
      return rawPost(`/selves/${encodeURIComponent(args.name)}`, { packs: [] });
    case "use_self":
      return rawPost("/config", { default_self: args.name });
    case "draft_persona":
      return post("/capture/draft-persona", { docs: args.docs ?? [] });
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
