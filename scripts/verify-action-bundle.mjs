#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseActionBundle as parseCodex, parseVisibleTurns as turnsCodex } from "../adapters/codex/lib/action-bundle.mjs";
import { parseActionBundle as parseClaude, parseVisibleTurns as turnsClaude } from "../adapters/claude-code/lib/action-bundle.mjs";
import {
  activeDecisionExchange,
  canonicalDecisionSubject,
  closeDecisionExchange,
  consumeDecisionExchange,
  decisionConversationRef,
  decisionRequestPath,
  matchDecisionExchanges,
  prepareDecisionExchange,
  rememberDecisionOutput,
  rememberDecisionReceipt,
} from "../adapters/codex/lib/decision-receipt.mjs";

const codexLines = [
  { type: "response_item", timestamp: "2026-07-16T01:00:00Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "修一下" }] } },
  { type: "response_item", timestamp: "2026-07-16T01:01:00Z", payload: { type: "custom_tool_call", call_id: "c1", name: "exec", input: "const file='src/tools.ts'; await tools.exec_command({}); await tools.wait({}); await tools.apply_patch('x')" } },
  { type: "response_item", timestamp: "2026-07-16T01:01:02Z", payload: { type: "custom_tool_call_output", call_id: "c1", output: '{"exit_code":0}' } },
  { type: "response_item", timestamp: "2026-07-16T01:01:03Z", payload: { type: "custom_tool_call", call_id: "c2", name: "wait", input: "{}" } },
  { type: "response_item", timestamp: "2026-07-16T01:01:04Z", payload: { type: "custom_tool_call_output", call_id: "c2", output: '{"status":"completed"}' } },
  { type: "response_item", timestamp: "2026-07-16T01:02:00Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "修完并验证了。" }] } },
].map(JSON.stringify);
const c = parseCodex(codexLines, "codex");
assert.deepEqual(c.actions.map((x) => x.name), ["exec_command", "apply_patch"]);
assert.ok(c.actions.every((x) => x.ok === true));
assert.equal(c.summary, "修完并验证了。");
assert.deepEqual(turnsCodex(codexLines, "codex"), [{ role: "user", content: "修一下" }, { role: "assistant", content: "修完并验证了。" }]);

const claudeLines = [
  { type: "user", timestamp: "2026-07-16T02:00:00Z", cwd: "/repo/app", sessionId: "s1", message: { role: "user", content: [{ type: "text", text: "看看测试" }] } },
  { type: "assistant", timestamp: "2026-07-16T02:01:00Z", cwd: "/repo/app", sessionId: "s1", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "secret command", description: "run focused tests" } }] } },
  { type: "user", timestamp: "2026-07-16T02:01:02Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: false, content: "all pass" }] } },
  { type: "assistant", timestamp: "2026-07-16T02:02:00Z", message: { role: "assistant", content: [{ type: "text", text: "测试通过。" }] } },
].map(JSON.stringify);
const h = parseClaude(claudeLines, "claude");
assert.deepEqual(h.actions, [{ name: "Bash", subject: "run focused tests", ok: true }]);
assert.equal(h.project, "app");
assert.ok(!JSON.stringify(h).includes("secret command"), "raw commands must never enter the bundle");
assert.deepEqual(turnsClaude(claudeLines, "claude"), [{ role: "user", content: "看看测试" }, { role: "assistant", content: "测试通过。" }]);

const cortexCodex = parseCodex([
  { type: "response_item", payload: { type: "custom_tool_call", call_id: "b1", name: "exec", input: "await tools.mcp__throughline__borrow_cortex({}); await tools.exec_command({}); await tools.mcp__throughline__settle_cortex({})" } },
].map(JSON.stringify), "codex");
assert.deepEqual(cortexCodex.actions.map((x) => x.name), [
  "mcp__throughline__borrow_cortex", "exec_command", "mcp__throughline__settle_cortex",
], "Codex traces must preserve the causal borrow/action/settle order");

const cortexClaude = parseClaude([
  { type: "assistant", message: { role: "assistant", content: [
    { type: "tool_use", id: "b", name: "mcp__throughline__borrow_cortex", input: {} },
    { type: "tool_use", id: "a", name: "Read", input: { file_path: "src/self.ts" } },
    { type: "tool_use", id: "s", name: "mcp__throughline__settle_cortex", input: {} },
  ] } },
].map(JSON.stringify), "claude");
assert.deepEqual(cortexClaude.actions.map((x) => x.name), [
  "mcp__throughline__borrow_cortex", "Read", "mcp__throughline__settle_cortex",
], "Claude traces must preserve the causal borrow/action/settle order");

const longBorrowed = parseClaude([
  { type: "assistant", message: { role: "assistant", content: [
    { type: "tool_use", id: "b", name: "mcp__throughline__borrow_cortex", input: {} },
    ...Array.from({ length: 40 }, (_, i) => ({ type: "tool_use", id: `r${i}`, name: "Read", input: { file_path: `src/${i}.ts` } })),
    { type: "tool_use", id: "s", name: "mcp__throughline__settle_cortex", input: {} },
  ] } },
].map(JSON.stringify), "claude");
assert.equal(longBorrowed.actions.length, 32);
assert.equal(longBorrowed.actions[0].name, "mcp__throughline__borrow_cortex", "bounded traces keep the causal start");
assert.equal(longBorrowed.actions.at(-1).name, "mcp__throughline__settle_cortex", "bounded traces keep settlement");

const admittedDecision = (exchange, suffix, receipt = `receipt-${suffix}`) => ({
  protocol: 2,
  id: `td_${String(suffix).padStart(16, "0").slice(-16)}`,
  receipt,
  context: `decision ${suffix}`,
  decision: { subjectDigest: `tsub_${String(suffix).padStart(24, "0").slice(-24)}` },
  ingress: {
    event_ref: `evt_${String(suffix).padStart(24, "0").slice(-24)}`,
    action_ref: `act_${String(suffix).padStart(24, "0").slice(-24)}`,
    conversation_ref: exchange.conversation_ref,
    capture_ref: exchange.capture_ref,
  },
});

const receiptInput = { session_id: `verify-${process.pid}-${Date.now()}` };
const receiptNow = Date.now();
assert.equal(decisionConversationRef(receiptInput, "codex"), decisionConversationRef(receiptInput, "codex"));
assert.notEqual(decisionConversationRef(receiptInput, "codex"), decisionConversationRef(receiptInput, "claude"));
const phasePromptInput = { session_id: `phase-${process.pid}-${Date.now()}` };
const phaseStopInput = { ...phasePromptInput, transcript_path: "/tmp/later-stop-transcript.jsonl" };
assert.equal(decisionConversationRef(phasePromptInput, "codex"), decisionConversationRef(phaseStopInput, "codex"),
  "UserPromptSubmit and Stop use the shared session id even when only Stop exposes a transcript path");
const phaseExchange = prepareDecisionExchange(phasePromptInput, "codex", "跨 hook", { nonce: "cross-hook" });
assert.equal(rememberDecisionReceipt(phasePromptInput, "codex", "跨 hook", phaseExchange,
  admittedDecision(phaseExchange, "0", "cross-hook-token")), true);
assert.equal(matchDecisionExchanges(phaseStopInput, "codex", [
  { role: "user", content: "跨 hook" }, { role: "assistant", content: "接上了" },
])[0].capture.capture_ref, phaseExchange.capture_ref);
const dedupeInput = { session_id: `dedupe-${process.pid}-${Date.now()}` };
const dedupeExchange = prepareDecisionExchange(dedupeInput, "codex", "证据去重", { nonce: "dedupe" });
const dedupeDecision = admittedDecision(dedupeExchange, "8", "dedupe-token");
assert.equal(rememberDecisionReceipt(dedupeInput, "codex", "证据去重", dedupeExchange, dedupeDecision), true);
assert.deepEqual(rememberDecisionOutput(
  dedupeInput, "codex", dedupeExchange.capture_ref, dedupeDecision.ingress.event_ref,
), [dedupeDecision.ingress.event_ref], "ingress/output evidence refs are deduped before ingest");
const firstExchange = prepareDecisionExchange(receiptInput, "codex", "修一下", { nonce: "exchange-one", now: receiptNow });
const promptRetry = prepareDecisionExchange(receiptInput, "codex", "修一下", { nonce: "ignored-on-retry", now: receiptNow + 1 });
assert.equal(promptRetry.capture_ref, firstExchange.capture_ref, "a repeated decision attempt reuses its pending deed");
assert.equal(firstExchange.source, "codex-plugin");
assert.match(firstExchange.capture_ref, /^codex:[a-f0-9]{32}:exchange-one$/);
const firstPath = new URL(decisionRequestPath("cocomi", firstExchange), "https://example.test");
assert.equal(firstPath.pathname, "/selves/cocomi/decision");
assert.equal(firstPath.searchParams.get("q"), "修一下");
assert.equal(firstPath.searchParams.get("conversation_ref"), firstExchange.conversation_ref);
assert.equal(firstPath.searchParams.get("capture_ref"), firstExchange.capture_ref);
const firstDecision = admittedDecision(firstExchange, "1", "signed-token");
assert.equal(rememberDecisionReceipt(receiptInput, "codex", "修一下", firstExchange, firstDecision), true);
assert.deepEqual(activeDecisionExchange(receiptInput, "codex"), {
  conversation_ref: firstExchange.conversation_ref,
  capture_ref: firstExchange.capture_ref,
}, "an admitted, open exchange is visible to same-turn recall");
let firstMatches = matchDecisionExchanges(receiptInput, "codex", turnsCodex(codexLines, "codex"));
assert.equal(firstMatches.length, 1);
assert.deepEqual(firstMatches[0].capture.turns, [
  { role: "user", content: "修一下" },
  { role: "assistant", content: "修完并验证了。", decision_receipt: "signed-token" },
]);
assert.equal(firstMatches[0].capture.capture_ref, firstExchange.capture_ref);
assert.equal(firstMatches[0].capture.action_ref, firstDecision.ingress.action_ref);
const firstOutputRef = "evt_000000000000000000000099";
assert.deepEqual(rememberDecisionOutput(receiptInput, "codex", firstExchange.capture_ref, firstOutputRef), [
  firstDecision.ingress.event_ref,
  firstOutputRef,
]);
firstMatches = matchDecisionExchanges(receiptInput, "codex", turnsCodex(codexLines, "codex"));
assert.equal(firstMatches[0].capture.output_event_ref, firstOutputRef);
assert.equal(matchDecisionExchanges(receiptInput, "codex", turnsCodex(codexLines, "codex"))[0].capture.capture_ref,
  firstExchange.capture_ref, "a failed upload retries the exact same deed");
assert.equal(consumeDecisionExchange(receiptInput, "codex", firstExchange.capture_ref), true);
assert.equal(activeDecisionExchange(receiptInput, "codex"), null,
  "a captured exchange is no longer visible to recall");
assert.equal(matchDecisionExchanges(receiptInput, "codex", turnsCodex(codexLines, "codex"))[0].capture, null,
  "an acknowledged exchange is retired only after durable capture succeeds");

const repeatedExchange = prepareDecisionExchange(receiptInput, "codex", "修一下", { nonce: "exchange-two", now: receiptNow + 2 });
assert.notEqual(repeatedExchange.capture_ref, firstExchange.capture_ref,
  "two real exchanges with identical words remain two deeds");
assert.equal(rememberDecisionReceipt(receiptInput, "codex", "修一下", repeatedExchange,
  admittedDecision(repeatedExchange, "2", "second-token")), true);
assert.equal(matchDecisionExchanges(receiptInput, "codex", turnsCodex(codexLines, "codex"))[0].capture.capture_ref,
  repeatedExchange.capture_ref);
const latestExchange = prepareDecisionExchange(receiptInput, "codex", "再看一下", { nonce: "exchange-three" });
assert.equal(rememberDecisionReceipt(receiptInput, "codex", "再看一下", latestExchange,
  admittedDecision(latestExchange, "7", "latest-token")), true);
assert.equal(activeDecisionExchange(receiptInput, "codex")?.capture_ref, latestExchange.capture_ref,
  "same-turn recall binds to the newest admitted exchange when more than one remains open");

const closedInput = { session_id: `verify-closed-${process.pid}-${Date.now()}` };
const closedExchange = prepareDecisionExchange(closedInput, "codex", "关闭", { nonce: "closed" });
assert.equal(activeDecisionExchange(closedInput, "codex"), null,
  "a merely prepared exchange is not active before server admission");
assert.equal(rememberDecisionReceipt(closedInput, "codex", "关闭", closedExchange,
  admittedDecision(closedExchange, "9", "closed-token")), true);
assert.equal(closeDecisionExchange(closedInput, "codex", closedExchange.capture_ref, "test"), true);
assert.equal(activeDecisionExchange(closedInput, "codex"), null,
  "a closed exchange is no longer visible to recall");

const progressInput = { session_id: `verify-progress-${process.pid}-${Date.now()}` };
const progressExchange = prepareDecisionExchange(progressInput, "codex", "做个长任务", { nonce: "progress" });
assert.equal(rememberDecisionReceipt(progressInput, "codex", "做个长任务", progressExchange,
  admittedDecision(progressExchange, "3", "final-token")), true);
const progressTurns = [
  { role: "user", content: "做个长任务" },
  ...Array.from({ length: 10 }, (_, i) => ({ role: "assistant", content: `进度 ${i + 1}` })),
  { role: "assistant", content: "最终结论。" },
];
assert.deepEqual(matchDecisionExchanges(progressInput, "codex", progressTurns)[0].capture.turns, [
  { role: "user", content: "做个长任务" },
  { role: "assistant", content: "最终结论。", decision_receipt: "final-token" },
], "progress updates cannot become the Self's durable position or evict its user subject");

const exactInput = { session_id: `verify-exact-${process.pid}-${Date.now()}` };
const exactExchange = prepareDecisionExchange(exactInput, "codex", "保留  两个空格", { nonce: "exact" });
assert.equal(rememberDecisionReceipt(exactInput, "codex", "保留  两个空格", exactExchange,
  admittedDecision(exactExchange, "4", "exact-token")), true);
assert.equal(matchDecisionExchanges(exactInput, "codex", [
  { role: "user", content: "保留 两个空格" }, { role: "assistant", content: "不同输入。" },
])[0].capture, null, "receipt matching preserves the exact proposition instead of collapsing whitespace");

const boundedInput = { session_id: `verify-bounded-${process.pid}-${Date.now()}` };
const prefix = "x".repeat(2400);
const boundedExchange = prepareDecisionExchange(boundedInput, "codex", prefix + "first transport tail", { nonce: "bounded" });
assert.equal(rememberDecisionReceipt(boundedInput, "codex", prefix + "first transport tail", boundedExchange,
  admittedDecision(boundedExchange, "5", "bounded-token")), true);
assert.equal(matchDecisionExchanges(boundedInput, "codex", [
  { role: "user", content: prefix + "second transport tail" }, { role: "assistant", content: "同一有界命题。" },
])[0].capture, null, "the bounded server proposition cannot attach to a different full host turn");
assert.deepEqual(matchDecisionExchanges(boundedInput, "codex", [
  { role: "user", content: prefix + "first transport tail" }, { role: "assistant", content: "原始完整命题。" },
])[0].capture.turns, [
  { role: "user", content: prefix + "first transport tail" },
  { role: "assistant", content: "原始完整命题。", decision_receipt: "bounded-token" },
], "server subject and full transcript identity are bound separately");

const longPrompt = "p".repeat(900);
const longInput = { session_id: `verify-long-${process.pid}-${Date.now()}` };
const longExchange = prepareDecisionExchange(longInput, "codex", longPrompt, { nonce: "full-prompt" });
const longPath = new URL(decisionRequestPath("cocomi", longExchange), "https://example.test");
assert.equal(longPath.searchParams.get("q"), longPrompt,
  "the v2 decision request carries the full canonical prompt instead of a 500-character recall query");

const astral = "x".repeat(2399) + "😀" + "tail";
assert.equal(Array.from(canonicalDecisionSubject(astral)).length, 2400);
assert.equal(canonicalDecisionSubject(astral).endsWith("😀"), true,
  "subject bounds count code points and cannot split a surrogate pair");
assert.doesNotThrow(() => encodeURIComponent(canonicalDecisionSubject(astral)));

assert.equal(
  readFileSync(new URL("../adapters/codex/lib/action-bundle.mjs", import.meta.url), "utf8"),
  readFileSync(new URL("../adapters/claude-code/lib/action-bundle.mjs", import.meta.url), "utf8"),
  "host parsers must stay byte-identical",
);
assert.equal(
  readFileSync(new URL("../adapters/codex/lib/decision-receipt.mjs", import.meta.url), "utf8"),
  readFileSync(new URL("../adapters/claude-code/lib/decision-receipt.mjs", import.meta.url), "utf8"),
  "host receipt witnesses must stay byte-identical",
);
assert.equal(
  readFileSync(new URL("../adapters/codex/lib/host-turn-client.mjs", import.meta.url), "utf8"),
  readFileSync(new URL("../adapters/claude-code/lib/host-turn-client.mjs", import.meta.url), "utf8"),
  "host-turn v2 clients must stay byte-identical",
);
console.log("Action bundle verification passed.");
