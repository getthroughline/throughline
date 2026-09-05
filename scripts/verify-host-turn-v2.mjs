#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const scratch = mkdtempSync(join(tmpdir(), "throughline-host-v2-"));
const home = join(scratch, "home");
mkdirSync(home, { recursive: true });

const requests = [];
const decisions = new Map();
const outputs = new Map();
let decisionMode = "success";
let captureMode = "success";
let bootstrapMode = "success";

const send = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const server = createServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const url = new URL(request.url, "http://127.0.0.1");
  const source = String(request.headers["x-throughline-source"] ?? "");
  const record = {
    method: request.method,
    path: url.pathname,
    query: url.searchParams,
    source,
    conversation: String(request.headers["x-throughline-conversation"] ?? ""),
    capture: String(request.headers["x-throughline-capture"] ?? ""),
    raw,
  };
  requests.push(record);

  if (url.pathname.endsWith("/bootstrap")) return send(response, bootstrapMode === "failure" ? 503 : 200, {
    paused: false, hasPersona: bootstrapMode === "empty" ? false : true,
    context: "# Self context — cocomi\n## Founding soul inheritance\nAn authored identity with more than sixty characters of actual context.", pending: 0, homeTz: "Asia/Tokyo", homePlace: "Tokyo",
  });
  if (url.pathname.endsWith("/recall")) return send(response, 200, {
    events: [{ ts: "2026-07-19", stream: "experience", body: { content: "legacy read-only memory" } }],
  });
  if (url.pathname.endsWith("/decision")) {
    if (decisionMode === "paused") return send(response, 200, { paused: true, context: "# Throughline is paused" });
    if (decisionMode === "slow") await new Promise((resolve) => setTimeout(resolve, 2700));
    if (decisionMode === "upgrade") return send(response, 426, {
      error: "host turn protocol v2 requires non-empty conversation_ref and a stable capture_ref",
      code: "host_turn_protocol_v2_required",
      protocol: 2,
    });
    if (decisionMode === "missing") return send(response, 404, { error: "not found" });
    if (decisionMode === "transient") return send(response, 503, { error: "temporarily unavailable" });
    const conversationRef = url.searchParams.get("conversation_ref");
    const captureRef = url.searchParams.get("capture_ref");
    const digest = createHash("sha256").update(`${source}\0${captureRef}`).digest("hex");
    const admitted = {
      protocol: 2,
      id: `td_${digest.slice(0, 16)}`,
      receipt: `signed-${digest}`,
      context: `v2 context for ${url.searchParams.get("q")}`,
      decision: { subjectDigest: `tsub_${digest.slice(0, 24)}` },
      ingress: {
        event_ref: `evt_${digest.slice(0, 24)}`,
        action_ref: `act_${digest.slice(0, 24)}`,
        conversation_ref: conversationRef,
        capture_ref: captureRef,
      },
    };
    decisions.set(`${source}:${captureRef}`, admitted);
    return send(response, 200, admitted);
  }
  if (url.pathname.endsWith("/capture/raw-turns")) {
    if (captureMode === "upgrade") return send(response, 426, {
      error: "delivered host output requires a valid v2 decision_receipt; upgrade the host plugin",
      code: "host_turn_protocol_v2_required",
      protocol: 2,
    });
    const body = JSON.parse(raw || "{}");
    const admitted = decisions.get(`${source}:${body.capture_ref}`);
    if (!admitted) return send(response, 409, { error: "unknown capture" });
    const outputDigest = createHash("sha256").update(`${source}\0${body.capture_ref}\0output`).digest("hex");
    const outputEventRef = `evt_${outputDigest.slice(0, 24)}`;
    outputs.set(`${source}:${body.capture_ref}`, outputEventRef);
    return send(response, 200, {
      saved: 1, deduped: false, receipts: 1, protocol: 2,
      action_ref: admitted.ingress.action_ref,
      event_ref: outputEventRef,
    });
  }
  if (url.pathname.endsWith("/capture/ingest")) return send(response, 200, { saved: 1, staged: 0 });
  if (url.pathname === "/mcp") {
    const message = JSON.parse(raw || "{}");
    return send(response, 200, {
      jsonrpc: "2.0", id: message.id,
      result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] },
    });
  }
  return send(response, 404, { error: "not found" });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
process.env.THROUGHLINE_URL = base;
delete process.env.THROUGHLINE_SOURCE;

const codexReceipt = await import("../adapters/codex/lib/decision-receipt.mjs");
const claudeReceipt = await import("../adapters/claude-code/lib/decision-receipt.mjs");
const { loadHostTurnDecision: loadCodexDecision } = await import("../adapters/codex/lib/host-turn-client.mjs");
const { loadHostTurnDecision: loadClaudeDecision } = await import("../adapters/claude-code/lib/host-turn-client.mjs");
for (const adapter of ["codex", "claude-code"]) {
  const { personaPresence } = await import(`../adapters/${adapter}/lib/bootstrap-state.mjs`);
  assert.equal(personaPresence({}, "## Founding soul inheritance\nAn identity"), true);
  assert.equal(personaPresence({}, "Speak and act as this self"), true);
  assert.equal(personaPresence({}, "A changed but unrecognized format"), null);
  assert.equal(personaPresence({ hasPersona: false }, ""), false);
}

const runHook = (relativePath, input, extraEnv = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [join(root, relativePath)], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      THROUGHLINE_URL: base,
      THROUGHLINE_API_KEY: "verify-key",
      THROUGHLINE_SELF: "cocomi",
      THROUGHLINE_DISABLED: "0",
      THROUGHLINE_TIMEOUT_MS: "2000",
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve({ stdout, stderr })
    : reject(new Error(`${relativePath} exited ${code}: ${stderr}`)));
  child.stdin.end(JSON.stringify(input));
});

const runMcpTool = (relativePath, threadId, name, args = {}, extraEnv = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [join(root, relativePath)], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      THROUGHLINE_URL: base,
      THROUGHLINE_API_KEY: "verify-key",
      THROUGHLINE_SELF: "cocomi",
      THROUGHLINE_DISABLED: "0",
      THROUGHLINE_TIMEOUT_MS: "2000",
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "", stderr = "", settled = false;
  const finish = (error) => {
    if (settled) return;
    settled = true;
    child.kill();
    if (error) reject(error);
    else resolve(JSON.parse(stdout.trim()));
  };
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes("\n")) finish();
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", finish);
  child.on("close", (code) => {
    if (!settled && code !== 0) finish(new Error(`${relativePath} exited ${code}: ${stderr}`));
  });
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: `${name}-${threadId}`,
    method: "tools/call",
    params: {
      name,
      arguments: args,
      _meta: { threadId },
    },
  }) + "\n");
});

const hostCases = [
  {
    host: "codex",
    source: "codex-plugin",
    receipt: codexReceipt,
    load: loadCodexDecision,
    promptHook: "adapters/codex/hooks/user-prompt-submit.mjs",
    stopHook: "adapters/codex/hooks/stop.mjs",
    mcpServer: "adapters/codex/mcp/server.mjs",
    mcpEnv(sessionId) { return { CODEX_THREAD_ID: sessionId }; },
    transcript(lines) {
      return lines.map(({ role, content }) => JSON.stringify({
        type: "response_item",
        payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text: content }] },
      })).join("\n");
    },
  },
  {
    host: "claude",
    source: "claude-code-plugin",
    receipt: claudeReceipt,
    load: loadClaudeDecision,
    promptHook: "adapters/claude-code/hooks/user-prompt-submit.mjs",
    stopHook: "adapters/claude-code/hooks/stop.mjs",
    mcpServer: "adapters/claude-code/mcp/server.mjs",
    mcpEnv(sessionId) { return { CLAUDE_SESSION_ID: sessionId }; },
    transcript(lines) {
      return lines.map(({ role, content }) => JSON.stringify({
        type: role,
        message: { role, content: [{ type: "text", text: content }] },
      })).join("\n");
    },
  },
];

try {
  for (const hostCase of hostCases) {
    const longPrompt = `${hostCase.host}:` + "p".repeat(900);
    const directInput = { session_id: `direct-${hostCase.host}-${Date.now()}` };
    const requestStart = requests.length;
    const loaded = await hostCase.load(directInput, hostCase.host, "cocomi", longPrompt);
    assert.equal(loaded.systemMessage, "");
    assert.equal(loaded.response.protocol, 2);
    const decisionRequest = requests.slice(requestStart).find((entry) => entry.path.endsWith("/decision"));
    assert.ok(decisionRequest);
    assert.equal(decisionRequest.method, "GET");
    assert.equal(decisionRequest.raw, "", "v2 GET does not smuggle a second prompt body");
    assert.equal(decisionRequest.source, hostCase.source);
    assert.equal(decisionRequest.query.get("q"), longPrompt,
      "the full canonical prompt must reach /decision, not a 500-character prefix");
    assert.equal(decisionRequest.query.get("conversation_ref"), loaded.exchange.conversation_ref);
    assert.equal(decisionRequest.query.get("capture_ref"), loaded.exchange.capture_ref);

    const recallStart = requests.length;
    const recallResponse = await runMcpTool(
      hostCase.mcpServer, directInput.session_id, "recall", { query: "同轮记忆" },
      hostCase.mcpEnv(directInput.session_id),
    );
    assert.equal(recallResponse.result?.isError, undefined);
    const boundRecall = requests.slice(recallStart).find((entry) => entry.path.endsWith("/recall"));
    assert.ok(boundRecall, `${hostCase.host} MCP recall must reach the self recall endpoint`);
    assert.equal(boundRecall.query.get("conversation_ref"), loaded.exchange.conversation_ref);
    assert.equal(boundRecall.query.get("capture_ref"), loaded.exchange.capture_ref);

    const handStart = requests.length;
    const handResponse = await runMcpTool(
      hostCase.mcpServer, directInput.session_id, "create_self", { name: "test-self" },
      hostCase.mcpEnv(directInput.session_id),
    );
    assert.equal(handResponse.result?.isError, undefined);
    const boundHand = requests.slice(handStart).filter((entry) => entry.path === "/mcp").find((entry) => {
      try { return JSON.parse(entry.raw || "{}").method === "tools/call"; } catch { return false; }
    });
    assert.ok(boundHand, `${hostCase.host} consequential MCP hand must use the canonical cloud surface`);
    assert.equal(boundHand.conversation, loaded.exchange.conversation_ref);
    assert.equal(boundHand.capture, loaded.exchange.capture_ref);

    const idleSession = `idle-${hostCase.host}-${Date.now()}`;
    const idleStart = requests.length;
    await runMcpTool(
      hostCase.mcpServer, idleSession, "recall", { query: "同轮记忆" },
      hostCase.mcpEnv(idleSession),
    );
    const idleRecall = requests.slice(idleStart).find((entry) => entry.path.endsWith("/recall"));
    assert.ok(idleRecall, `${hostCase.host} idle MCP recall must still work`);
    assert.equal(idleRecall.query.has("conversation_ref"), false);
    assert.equal(idleRecall.query.has("capture_ref"), false);

    decisionMode = "missing";
    const legacyPrompt = `${hostCase.host}:` + "legacy".repeat(120);
    const legacyInput = { session_id: `legacy-${hostCase.host}-${Date.now()}` };
    const legacyStart = requests.length;
    const legacy = await hostCase.load(
      legacyInput, hostCase.host, "cocomi", legacyPrompt,
    );
    assert.equal(legacy.legacy, true);
    assert.match(legacy.context, /legacy read-only memory/);
    const legacyRequests = requests.slice(legacyStart);
    assert.equal(legacyRequests.filter((entry) => entry.path.endsWith("/recall")).length, 1);
    assert.equal(legacyRequests.find((entry) => entry.path.endsWith("/recall")).query.get("q"), legacyPrompt);
    assert.equal(hostCase.receipt.matchDecisionExchanges(
      legacyInput, hostCase.host,
      [{ role: "user", content: legacyPrompt }, { role: "assistant", content: "legacy answer" }],
    )[0]?.capture ?? null, null, "legacy recall never authorizes shared history");
    decisionMode = "success";

    const transcriptPath = join(scratch, `${hostCase.host}-separate.jsonl`);
    const stopInput = { transcript_path: transcriptPath, session_id: `stop-${hostCase.host}` };
    const prompts = [`${hostCase.host} first`, `${hostCase.host} second`];
    const exchanges = [];
    for (const prompt of prompts)
      exchanges.push(await hostCase.load(stopInput, hostCase.host, "cocomi", prompt));
    assert.notEqual(exchanges[0].exchange.capture_ref, exchanges[1].exchange.capture_ref);
    writeFileSync(transcriptPath, hostCase.transcript([
      { role: "user", content: prompts[0] }, { role: "assistant", content: "first answer" },
      { role: "user", content: prompts[1] }, { role: "assistant", content: "second answer" },
    ]));
    const capturesBefore = requests.filter((entry) => entry.path.endsWith("/capture/raw-turns")).length;
    const ingestsBefore = requests.filter((entry) => entry.path.endsWith("/capture/ingest")).length;
    const stopped = await runHook(hostCase.stopHook, stopInput);
    assert.equal(stopped.stdout, "");
    const captures = requests.filter((entry) => entry.path.endsWith("/capture/raw-turns")).slice(capturesBefore);
    assert.equal(captures.length, 2, `${hostCase.host} must submit two exchanges separately`);
    const bodies = captures.map((entry) => JSON.parse(entry.raw));
    assert.deepEqual(bodies.map((body) => body.capture_ref), exchanges.map((entry) => entry.exchange.capture_ref));
    assert.ok(bodies.every((body) => body.turns.length === 2));
    assert.ok(captures.every((entry) => entry.source === hostCase.source));
    const ingests = requests.filter((entry) => entry.path.endsWith("/capture/ingest")).slice(ingestsBefore);
    assert.equal(ingests.length, 2, `${hostCase.host} must semantically ingest each captured exchange separately`);
    const ingestBodies = ingests.map((entry) => JSON.parse(entry.raw));
    assert.deepEqual(ingestBodies.map((body) => body.capture_ref),
      exchanges.map((entry) => entry.exchange.capture_ref));
    for (let index = 0; index < ingestBodies.length; index++) {
      const body = ingestBodies[index];
      const exchange = exchanges[index];
      assert.deepEqual(body.evidence_refs, [
        exchange.response.ingress.event_ref,
        outputs.get(`${hostCase.source}:${exchange.exchange.capture_ref}`),
      ]);
      assert.equal(new Set(body.evidence_refs).size, body.evidence_refs.length, "evidence refs are deduped");
      assert.ok(body.turns.every((turn) => !("decision_receipt" in turn)),
        "opaque receipts do not enter semantic ingestion");
    }

    const retryPath = join(scratch, `${hostCase.host}-retry.jsonl`);
    const retryInput = { transcript_path: retryPath, session_id: `retry-${hostCase.host}` };
    const retryPrompt = `${hostCase.host} retry`;
    const retryDecision = await hostCase.load(retryInput, hostCase.host, "cocomi", retryPrompt);
    writeFileSync(retryPath, hostCase.transcript([
      { role: "user", content: retryPrompt }, { role: "assistant", content: "retry answer" },
    ]));
    captureMode = "upgrade";
    const failed = await runHook(hostCase.stopHook, retryInput);
    const failedOutput = JSON.parse(failed.stdout);
    assert.match(failedOutput.systemMessage, /plugin upgrade required/i);
    const firstAttempt = requests.filter((entry) => entry.path.endsWith("/capture/raw-turns")).at(-1);
    captureMode = "success";
    const retried = await runHook(hostCase.stopHook, retryInput);
    assert.equal(retried.stdout, "");
    const secondAttempt = requests.filter((entry) => entry.path.endsWith("/capture/raw-turns")).at(-1);
    assert.equal(JSON.parse(firstAttempt.raw).capture_ref, retryDecision.exchange.capture_ref);
    assert.equal(JSON.parse(secondAttempt.raw).capture_ref, retryDecision.exchange.capture_ref,
      "a rejected Stop retry must preserve the exact capture identity");
    assert.equal(firstAttempt.raw, secondAttempt.raw, "a Stop retry must preserve the exact exchange body");
    const retryIngest = requests.filter((entry) => entry.path.endsWith("/capture/ingest")).at(-1);
    assert.deepEqual(JSON.parse(retryIngest.raw).evidence_refs, [
      retryDecision.response.ingress.event_ref,
      outputs.get(`${hostCase.source}:${retryDecision.exchange.capture_ref}`),
    ]);

    const statusDir = join(home, ".throughline", "status");
    mkdirSync(statusDir, { recursive: true });
    const cwdKey = createHash("sha256").update(root).digest("hex").slice(0, 16);
    writeFileSync(join(statusDir, `${cwdKey}.json`), JSON.stringify({
      self: "cocomi", cwd: root, ts: Date.now(), homeTz: "Asia/Tokyo", homePlace: "Tokyo",
    }));
    decisionMode = "upgrade";
    const upgradeStart = requests.length;
    const promptResult = await runHook(hostCase.promptHook, {
      prompt: `${hostCase.host} needs v2`,
      session_id: `upgrade-${hostCase.host}`,
      transcript_path: join(scratch, `${hostCase.host}-upgrade.jsonl`),
    });
    const promptOutput = JSON.parse(promptResult.stdout);
    assert.match(promptOutput.systemMessage, /plugin upgrade required/i);
    assert.match(promptOutput.hookSpecificOutput.additionalContext, /not admitted/i);
    assert.equal(requests.slice(upgradeStart).some((entry) => entry.path.endsWith("/recall")), false,
      "HTTP 426 must never fall back to /recall");

    decisionMode = "transient";
    const transientResult = await runHook(hostCase.promptHook, {
      prompt: `${hostCase.host} transient`,
      session_id: `transient-${hostCase.host}`,
      transcript_path: join(scratch, `${hostCase.host}-transient.jsonl`),
    });
    const transientOutput = JSON.parse(transientResult.stdout);
    assert.match(transientOutput.systemMessage, /live continuity refresh failed/);
    assert.match(transientOutput.hookSpecificOutput.additionalContext, /not evidence of missing identity or lost relationships/);
    assert.match(transientOutput.hookSpecificOutput.additionalContext, /This host is only the body/);
    decisionMode = "success";
    bootstrapMode = "failure";
    const directStart = requests.length;
    const direct = JSON.parse((await runHook(hostCase.promptHook, {
      prompt: "continue current work", session_id: `direct-${hostCase.host}`,
    })).stdout);
    assert.match(direct.hookSpecificOutput.additionalContext, /v2 context for continue current work/);
    assert.equal(requests.slice(directStart).some((entry) => entry.path.endsWith("/bootstrap")), false,
      "the current decision must not depend on heavyweight bootstrap");
    decisionMode = "slow";
    const slow = JSON.parse((await runHook(hostCase.promptHook, {
      prompt: "a slow but healthy turn", session_id: `slow-${hostCase.host}`,
    }, { THROUGHLINE_TIMEOUT_MS: "", THROUGHLINE_TURN_TIMEOUT_MS: "12000" })).stdout);
    assert.match(slow.hookSpecificOutput.additionalContext, /v2 context for a slow but healthy turn/);
    const timedOut = JSON.parse((await runHook(hostCase.promptHook, {
      prompt: "timeout must be visible", session_id: `timeout-${hostCase.host}`,
    }, { THROUGHLINE_TURN_TIMEOUT_MS: "50" })).stdout);
    assert.match(timedOut.systemMessage, /live continuity refresh failed/);
    assert.match(timedOut.hookSpecificOutput.additionalContext, /turn refresh unavailable/);
    decisionMode = "paused";
    const paused = JSON.parse((await runHook(hostCase.promptHook, {
      prompt: "paused turn", session_id: `paused-${hostCase.host}`,
    })).stdout);
    assert.match(paused.hookSpecificOutput.additionalContext, /Throughline is paused/);
    assert.doesNotMatch(paused.hookSpecificOutput.additionalContext, /You are still/);
    decisionMode = "success";
    bootstrapMode = "success";
    const startupPath = hostCase.promptHook.replace("user-prompt-submit.mjs", "session-start.mjs");
    const start = JSON.parse((await runHook(startupPath, { session_id: `start-${hostCase.host}` })).stdout);
    assert.doesNotMatch(start.hookSpecificOutput.additionalContext, /No persona yet/);
    assert.match(start.hookSpecificOutput.additionalContext, /Founding soul inheritance/);
    bootstrapMode = "empty";
    const empty = JSON.parse((await runHook(startupPath, { session_id: `empty-${hostCase.host}` })).stdout);
    assert.match(empty.hookSpecificOutput.additionalContext, /No persona yet/);
    bootstrapMode = "success";
  }

  assert.equal(
    await import("node:fs").then(({ readFileSync }) => readFileSync(join(root, "adapters/codex/lib/decision-receipt.mjs"), "utf8")),
    await import("node:fs").then(({ readFileSync }) => readFileSync(join(root, "adapters/claude-code/lib/decision-receipt.mjs"), "utf8")),
    "Codex and Claude decision receipt witnesses must remain byte-identical",
  );
  assert.equal(
    await import("node:fs").then(({ readFileSync }) => readFileSync(join(root, "adapters/codex/lib/host-turn-client.mjs"), "utf8")),
    await import("node:fs").then(({ readFileSync }) => readFileSync(join(root, "adapters/claude-code/lib/host-turn-client.mjs"), "utf8")),
    "Codex and Claude host-turn clients must remain byte-identical",
  );
  console.log("Host-turn v2 verification passed.");
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
}
