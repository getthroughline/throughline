#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";

const target = resolve(process.argv[2] ?? "adapters/codex/mcp/server.mjs");
const widgetUri = "ui://widget/memories.html";
const widgetHtml = "<!doctype html><title>memories</title>";
const remoteTool = {
  name: "recall",
  description: "Recall",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  _meta: { "openai/outputTemplate": widgetUri },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
};
let remoteResourceReads = 0;

const result = (id, value) => ({ jsonrpc: "2.0", id, result: value });
const error = (id, code, message, data) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });
const cloud = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method === "GET" && req.url === "/config") return res.end(JSON.stringify({ default_self: "cocomi" }));
  if (req.method !== "POST" || req.url !== "/mcp") {
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: "not found" }));
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const msg = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (msg.method === "tools/list") return res.end(JSON.stringify(result(msg.id, { tools: [remoteTool] })));
  if (msg.method === "tools/call" && msg.params?.name === "recall") {
    if (String(msg.params.arguments?.query).startsWith("parallel-"))
      await new Promise((done) => setTimeout(done, 180));
    return res.end(JSON.stringify(result(msg.id, {
      content: [{ type: "text", text: JSON.stringify({ events: [{ id: "evt_1" }] }) }],
      structuredContent: { query: msg.params.arguments?.query, events: [{ stream: "journal", summary: "remembered", ts: "2026-07-19", grounded: true }] },
      _meta: { "openai/outputTemplate": widgetUri },
    })));
  }
  if (msg.method === "resources/list") return res.end(JSON.stringify(result(msg.id, { resources: [{ uri: widgetUri, name: "memories.html", mimeType: "text/html+skybridge" }] })));
  if (msg.method === "resources/read") {
    remoteResourceReads++;
    if (typeof msg.params?.uri !== "string" || !msg.params.uri) return res.end(JSON.stringify(error(msg.id, -32602, "resources/read requires a non-empty uri")));
    if (msg.params.uri !== widgetUri) return res.end(JSON.stringify(error(msg.id, -32002, `resource not found: ${msg.params.uri}`, { uri: msg.params.uri })));
    return res.end(JSON.stringify(result(msg.id, { contents: [{ uri: widgetUri, mimeType: "text/html+skybridge", text: widgetHtml }] })));
  }
  return res.end(JSON.stringify(error(msg.id, -32601, `unknown method: ${msg.method}`)));
});

await new Promise((done) => cloud.listen(0, "127.0.0.1", done));
const address = cloud.address();
assert(address && typeof address === "object");
const child = spawn(process.execPath, [target], {
  cwd: dirname(target),
  env: { ...process.env, THROUGHLINE_URL: `http://127.0.0.1:${address.port}`, THROUGHLINE_API_KEY: "test-key", THROUGHLINE_SELF: "cocomi" },
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: child.stdout });
const waiting = new Map(), unexpected = [];
let nextId = 1, stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
lines.on("line", (line) => {
  const msg = JSON.parse(line), waiter = waiting.get(msg.id);
  if (waiter) { waiting.delete(msg.id); waiter(msg); }
  else unexpected.push(msg);
});
function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => { waiting.delete(id); rejectRequest(new Error(`timeout waiting for ${method}${stderr ? `: ${stderr}` : ""}`)); }, 5_000);
    waiting.set(id, (msg) => { clearTimeout(timer); resolveRequest(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

try {
  const init = await request("initialize", { protocolVersion: "1900-01-01" });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.deepEqual(init.result.capabilities.resources, {});
  const listed = await request("tools/list");
  assert.equal(listed.result.tools.find((tool) => tool.name === "recall")?._meta?.["openai/outputTemplate"], widgetUri);
  const called = await request("tools/call", { name: "recall", arguments: { query: "Tokyo" } });
  assert.equal(called.result._meta["openai/outputTemplate"], widgetUri);
  assert.equal(called.result.structuredContent.query, "Tokyo");
  assert.equal(called.result.structuredContent.events[0].summary, "remembered");
  const parallelAt = Date.now();
  const [parallelA, parallelB] = await Promise.all([
    request("tools/call", { name: "recall", arguments: { query: "parallel-a" } }),
    request("tools/call", { name: "recall", arguments: { query: "parallel-b" } }),
  ]);
  assert.equal(parallelA.result.structuredContent.query, "parallel-a");
  assert.equal(parallelB.result.structuredContent.query, "parallel-b");
  assert.ok(Date.now() - parallelAt < 320, "read-only MCP calls should not wait in a global FIFO");
  const resources = (await request("resources/list")).result.resources;
  assert.ok(resources.some((resource) => resource.uri === widgetUri));
  assert.ok(resources.some((resource) => resource.uri === "ui://widget/self-card.html"));
  const localWidget = (await request("resources/read", { uri: widgetUri })).result.contents[0];
  assert.equal(localWidget.uri, widgetUri);
  assert.equal(localWidget.mimeType, "text/html+skybridge");
  assert.match(localWidget.text, /window\.openai/);
  assert.notEqual(localWidget.text, widgetHtml, "known plugin widgets must not depend on the remote resource");
  assert.equal(remoteResourceReads, 0, "known plugin widgets must be served without a cloud round trip");
  assert.equal((await request("resources/read", {})).error.code, -32602);
  const missing = await request("resources/read", { uri: "ui://widget/missing.html" });
  assert.equal(missing.error.code, -32002);
  assert.deepEqual(missing.error.data, { uri: "ui://widget/missing.html" });
  assert.equal(remoteResourceReads, 1, "only unknown future resources may fall through to the cloud");
  assert.equal((await request("resources/templates/list")).error.code, -32601);

  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "resources/list", params: {} }) + "\n");
  await new Promise((done) => setTimeout(done, 80));
  assert.deepEqual(unexpected, [], "an id-less JSON-RPC notification must not receive a response");
  console.log(`codex MCP app resources: ok (${target})`);
} finally {
  child.kill("SIGTERM");
  lines.close();
  await new Promise((done) => cloud.close(done));
}
