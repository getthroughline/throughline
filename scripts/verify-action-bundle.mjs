#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseActionBundle as parseCodex, parseVisibleTurns as turnsCodex } from "../adapters/codex/lib/action-bundle.mjs";
import { parseActionBundle as parseClaude, parseVisibleTurns as turnsClaude } from "../adapters/claude-code/lib/action-bundle.mjs";

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

assert.equal(
  readFileSync(new URL("../adapters/codex/lib/action-bundle.mjs", import.meta.url), "utf8"),
  readFileSync(new URL("../adapters/claude-code/lib/action-bundle.mjs", import.meta.url), "utf8"),
  "host parsers must stay byte-identical",
);
console.log("Action bundle verification passed.");
