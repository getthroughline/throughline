#!/usr/bin/env node
// PreToolUse hook: ask Enforce whether the about-to-run tool call is allowed.
// Maps the daemon decision -> Claude Code permission decision: block->deny, confirm->ask, allow->(pass).
import { post, safe } from "../lib/daemon.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const input = await readStdin();
const tool = input.tool_name ?? "";
const toolInput = input.tool_input ?? {};
// Flatten the tool input into matchable text (e.g. a Bash command, a message body).
const text = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput);

const action = { tool, text };
const result = await safe(() => post("/gate", action), { decision: "allow", inject: "", reasons: [] });

if (result.decision === "allow") {
  process.exit(0); // no opinion -> let the host's normal permission flow proceed
}

const map = { block: "deny", confirm: "ask" };
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: map[result.decision] ?? "ask",
      permissionDecisionReason: result.inject || "Throughline Enforce flagged this action.",
    },
  }),
);
