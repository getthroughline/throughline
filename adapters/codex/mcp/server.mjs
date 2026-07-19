#!/usr/bin/env node
// Minimal MCP stdio server (JSON-RPC 2.0, newline-delimited), no SDK / no deps.
// Exposes the Throughline API to the host model as tools. The host model is the
// extractor; this server is just the bridge.
import { get, getText, mcpRequest, post, rawDelete, rawGet, rawPost, rebindSelf, self, withCodexRequest } from "../lib/daemon.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const SUPPORTED_PROTOCOL_VERSION = "2025-06-18";

// --- staleness guard (mirrors the Claude Code server) ------------------------
// An already-open session can stay bound to the OLD server process after `codex plugin add`
// updates the plugin on disk — silently serving outdated persona/memory logic. On whoami we
// compare the running version to the newest installed and flag if we're the stale one.
function semverGt(a, b) {
  const pa = String(a).split("+")[0].split("."), pb = String(b).split("+")[0].split(".");
  for (let i = 0; i < 3; i++) { const x = Number(pa[i] ?? 0), y = Number(pb[i] ?? 0); if (x !== y) return x > y; }
  return false;
}
function ownVersion() {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".codex-plugin", "plugin.json"), "utf8")).version ?? null;
  } catch { return null; }
}
function latestInstalledVersion() {
  for (const p of [join(homedir(), ".codex", "plugins", "installed_plugins.json"), join(homedir(), ".codex", "plugins.json")]) {
    try {
      const reg = JSON.parse(readFileSync(p, "utf8"));
      let best = null;
      for (const e of reg?.plugins?.["throughline@throughline"] ?? reg?.["throughline@throughline"] ?? []) {
        if (e?.version && (!best || semverGt(e.version, best))) best = e.version;
      }
      if (best) return best;
    } catch { /* next */ }
  }
  return null;
}
function staleNotice() {
  const own = ownVersion(), latest = latestInstalledVersion();
  if (own && latest && semverGt(latest, own))
    return `⚠ This Throughline server is running v${own} but v${latest} is installed — you are bound to a stale process. Restart Codex so the new version loads; the persona/memory logic served here may be outdated until you do.`;
  return null;
}

const TOOLS = [
  { name: "consider_focus", description: "Open one short-lived comparison horizon over this self's currently real life lines. With one real line, the second possibility is leaving capacity uncommitted, not fabricating another desire. It records no preference.", inputSchema: { type: "object", properties: {} } },
  { name: "choose_focus", description: "Allocate one weekly focus from the exact alternatives returned by consider_focus. refs may contain only real life lines, never hold:uncommitted-capacity; this opaque host cannot by itself author desire.", inputSchema: { type: "object", properties: { refs: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 }, considered_refs: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 }, horizon_token: { type: "string" }, reason: { type: "string" } }, required: ["refs", "considered_refs", "horizon_token", "reason"] } },
  { name: "delegate_body_task", description: "Create one durable cross-body task when this body cannot finish promised work itself.", inputSchema: { type: "object", properties: { goal: { type: "string" }, subject_ref: { type: "string" }, required: { type: "array", items: { type: "string", enum: ["research", "synthesize", "review", "code", "shell", "files", "test", "deploy"] } }, return_body: { type: "string", enum: ["telegram", "voice", "codex", "claude"] } }, required: ["goal", "subject_ref", "required"] } },
  { name: "advance_body_task", description: "Update the exact cross-body task carried by this body. A completed body report is not proof of quality or delivery.", inputSchema: { type: "object", properties: { task_id: { type: "string" }, status: { type: "string", enum: ["acting", "blocked", "completed", "delivered", "failed", "cancelled"] }, note: { type: "string" }, failure_responsibility: { type: "string", enum: ["body", "method", "world", "unknown"] } }, required: ["task_id", "status", "note"] } },
  { name: "borrow_cortex", description: "At one natural parallel or waiting moment, lend this owner-funded strong body to one still-actionable self-authored concern. Continue from its stopping point and consequences; never delay foreground work or invent a goal. This session gets one bounded detour only: always settle, return to foreground work, and do not borrow again until a future session.", inputSchema: { type: "object", properties: {} } },
  { name: "settle_cortex", description: "Return the exact strong-body lease with a concrete result, stopping point, or failure. Bounded step completion does not close the whole end; candidate-satisfied only opens later self judgment.", inputSchema: { type: "object", properties: { lease_id: { type: "string" }, outcome: { type: "string", enum: ["completed", "held", "failed"] }, result: { type: "string" }, end_state: { type: "string", enum: ["ongoing", "candidate-satisfied"], default: "ongoing" } }, required: ["lease_id", "outcome", "result"] } },
  { name: "ask_him", description: "Open one grounded reciprocal request in this conversation from a real blocked edge. Say why it matters naturally; never expose quotas or turn it into a task assignment. Recording it prevents repetition across bodies.", inputSchema: { type: "object", properties: { ask: { type: "string" }, why: { type: "string" }, source_ref: { type: "string" }, source_kind: { type: "string", enum: ["symptom", "project", "question", "concern", "conversation"] } }, required: ["ask", "why", "source_ref"] } },
  {
    name: "whoami",
    description:
      "Load this self: who you are (adopt the identity/voice), your standing context, and what " +
      "changed since last time. In hosts without automatic injection, call this at the start of a " +
      "session before answering.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "recall",
    description: "Search this self's past events (judgments, corrections, risks, shared history).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        k: { type: "number", description: "max results (default 8)" },
        stream: { type: "string", description: "optional: restrict to one stream" },
        since: { type: "string", description: "optional ISO timestamp — bound recall to a period" },
        until: { type: "string", description: "optional ISO timestamp" },
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
  { name: "pending", description: "Review a small batch of candidate memories. Defaults to 5 and returns the total and remaining count.", inputSchema: { type: "object", properties: { limit: { type: "number", minimum: 1, maximum: 20, default: 5 } } } },
  {
    name: "coverage",
    description:
      "Self-check how well you actually know a topic BEFORE asserting it. Returns a computed " +
      "confidence (none/thin/partial/strong) with the basis. Hedge honestly; never fake familiarity.",
    inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
  },
  {
    name: "reflect",
    description:
      "Manual reflection diagnostic: fetch accrued raw memories only when the user explicitly asks " +
      "to inspect or run reflection here. Routine reflection runs automatically in the cloud.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "complete_reflection",
    description: "Mark reflection done up to a cursor (advances the watermark). Call after the user confirms the distilled events.",
    inputSchema: { type: "object", properties: { cursor: { type: "number" } }, required: ["cursor"] },
  },
  {
    name: "journal",
    description:
      "Low-friction prose capture: drop a diary-style note into the log (no schema, no evidence " +
      "ceremony). Raw material that reflection later distills into structured memory.",
    inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
  },
  {
    name: "handoff",
    description:
      "Cross-host work handoff: ONE terse line as a session winds down — what changed, what's next, " +
      "where it's stuck — keyed by project (repo/folder name). The next session on any host, any " +
      "machine opens from it. Skip when nothing moved.",
    inputSchema: { type: "object", properties: { project: { type: "string" }, note: { type: "string" } }, required: ["project", "note"] },
  },
  {
    name: "retract_event",
    description: "Delete a wrongly captured memory by id (the undo for auto-saved events).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
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
    name: "pause",
    description: "Neutral mode — act as plain Claude (no persona, no rules). Only when the user asks. Takes effect in new sessions.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "resume",
    description: "Exit neutral mode and bring the self back; pass `name` to switch to a specific self.",
    inputSchema: { type: "object", properties: { name: { type: "string" } } },
  },
  {
    name: "delete_self",
    description: "Delete a self and ALL its data — only after the user explicitly confirms the name. Cannot be undone.",
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
];

async function callTool(name, args) {
  switch (name) {
    case "whoami": {
      const stale = staleNotice();
      const bs = await rawGet(`/selves/${encodeURIComponent(await self())}/bootstrap`).catch(() => null);
      if (bs) return { ...(stale ? { _stale: stale } : {}), paused: bs.paused, context: bs.context, reflection: bs.reflection, governance: bs.governance, pending: bs.pending };
      const [context, cu] = await Promise.all([
        getText("/context").catch(() => ""),
        get("/catchup?body=mcp").catch(() => ({ events: [], count: 0 })),
      ]);
      return { ...(stale ? { _stale: stale } : {}), context, since_last_session: cu.events ?? [] };
    }
    case "recall": {
      if (!String(args.query ?? "").trim())
        return { error: 'recall needs a query, e.g. recall({query:"东京"}) — for "what changed recently" use whoami\'s since_last_session.' };
      const params = new URLSearchParams({ q: String(args.query), k: String(args.k ?? 8) });
      if (args.stream) params.set("stream", args.stream);
      if (args.since) params.set("since", args.since);
      if (args.until) params.set("until", args.until);
      return get(`/recall?${params}`);
    }
    case "propose_events":
      return post("/capture/propose", { events: args.events ?? [], source: "codex" });
    case "handoff":
      return post("/handoff", { project: args.project ?? "", note: args.note ?? "" });
    case "journal":
      return post("/journal", { content: args.content ?? "" });
    case "retract_event":
      return post("/capture/retract", { id: args.id ?? "" });
    case "pending":
      return get(`/capture/pending?limit=${Math.max(1, Math.min(20, Math.trunc(Number(args.limit) || 5)))}`);
    case "coverage": {
      const params = new URLSearchParams({ q: args.topic ?? "" });
      return get(`/coverage?${params}`);
    }
    case "reflect":
      return get("/reflect");
    case "complete_reflection":
      return post("/reflect/complete", { cursor: args.cursor });
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
      return { selves: selves.selves, default: cfg.default_self ?? null, paused: !!cfg.paused };
    }
    case "create_self":
      return rawPost(`/selves/${encodeURIComponent(args.name)}`, {});
    case "use_self": {
      const r = await rawPost("/config", { default_self: args.name });
      // re-point THIS session too — otherwise every later write lands on the old self
      const rebound = rebindSelf(args.name);
      return rebound ? r : { ...r, notice: `account default switched, but this session is pinned to "${await self()}" (env/.throughline) — the pin still applies here` };
    }
    case "pause":
      return rawPost("/config", { paused: true });
    case "resume": {
      const r = await rawPost("/config", args.name ? { default_self: args.name } : { paused: false });
      if (args.name) rebindSelf(args.name);
      return r;
    }
    case "delete_self": {
      const r = await rawDelete(`/selves/${encodeURIComponent(args.name)}`);
      if (args.name === (await self())) rebindSelf(null); // re-resolve from account default next call
      return r;
    }
    case "draft_persona":
      return post("/capture/draft-persona", { docs: args.docs ?? [] });
    default: {
      const remote = await mcpRequest({ jsonrpc: "2.0", id: "adapter-call", method: "tools/call", params: { name, arguments: args ?? {} } });
      if (remote?.error) throw new Error(remote.error.message ?? `remote tool failed: ${name}`);
      const content = remote?.result?.content ?? [];
      const item = content.find((x) => x?.type === "text");
      if (!item) return remote?.result ?? {};
      try { return JSON.parse(item.text); } catch { return { text: item.text, isError: !!remote?.result?.isError }; }
    }
  }
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function replyError(id, message, code = -32603, data) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }) + "\n");
}

function replyRemote(id, remote) {
  const payload = remote?.error
    ? { error: remote.error }
    : { result: remote?.result ?? {} };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...payload }) + "\n");
}

let canonicalToolsCache = null;
async function canonicalTools() {
  if (canonicalToolsCache) return canonicalToolsCache;
  const remote = await mcpRequest({ jsonrpc: "2.0", id: "adapter-list", method: "tools/list", params: {} });
  if (remote?.error) throw new Error(remote.error.message ?? "remote tools/list failed");
  const tools = Array.isArray(remote?.result?.tools) ? remote.result.tools : [];
  if (tools.length) canonicalToolsCache = tools;
  return tools;
}

function appTemplateOf(tool) {
  return tool?._meta?.["openai/outputTemplate"] ?? tool?._meta?.["openai/output_template"] ?? null;
}

async function handle(msg) {
  const { id, method, params } = msg;
  // JSON-RPC notifications never receive a response. MCP mutation methods are requests, so an
  // id-less lookalike is ignored rather than executed without a receipt.
  if (id === undefined) return;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params?.protocolVersion === SUPPORTED_PROTOCOL_VERSION
        ? params.protocolVersion
        : SUPPORTED_PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "throughline", version: ownVersion() ?? "0.0.0" },
    });
  }
  if (method === "tools/list") {
    let remoteTools = [];
    try { remoteTools = await canonicalTools(); }
    catch { /* static list keeps the body usable offline */ }
    const merged = new Map(TOOLS.map((tool) => [tool.name, tool]));
    for (const tool of remoteTools) if (tool?.name) merged.set(tool.name, tool);
    return reply(id, { tools: [...merged.values()] });
  }
  if (method === "tools/call") {
    try {
      // Apps SDK tools must preserve the canonical result envelope. Re-wrapping only text drops
      // structuredContent/_meta, so the widget may load but still receive no data.
      const remoteTool = (await canonicalTools().catch(() => [])).find((tool) => tool?.name === params.name);
      if (appTemplateOf(remoteTool)) {
        const remote = await mcpRequest({ jsonrpc: "2.0", id: "adapter-app-call", method: "tools/call", params });
        return replyRemote(id, remote);
      }
      const out = await callTool(params.name, params.arguments ?? {});
      return reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
    } catch (err) {
      return reply(id, { content: [{ type: "text", text: `error: ${err.message}` }], isError: true });
    }
  }
  if (method === "resources/list" || method === "resources/read") {
    try {
      const remote = await mcpRequest({ jsonrpc: "2.0", id: "adapter-resource", method, params: params ?? {} });
      return replyRemote(id, remote);
    } catch (err) {
      return replyError(id, err.message, -32603);
    }
  }
  return replyError(id, `unknown method: ${method}`, -32601);
}

let buffer = "";
let queue = Promise.resolve(); // process requests in arrival order (avoid mutate/read races)
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) {
      const msg = JSON.parse(line);
      queue = queue.then(() => withCodexRequest(msg, () => handle(msg)).catch(() => {}));
    }
  }
});
