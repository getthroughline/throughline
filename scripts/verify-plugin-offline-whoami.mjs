#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const targets = process.argv.slice(2).map((target) => resolve(target));
if (!targets.length) targets.push(
  resolve("adapters/codex/mcp/server.mjs"),
  resolve("adapters/claude-code/mcp/server.mjs"),
);

const home = mkdtempSync(join(tmpdir(), "throughline-offline-whoami-"));
const cacheDir = join(home, ".throughline", "cache");
mkdirSync(cacheDir, { recursive: true });
writeFileSync(join(cacheDir, "cocomi.json"), JSON.stringify({
  ts: new Date().toISOString(),
  self: "cocomi",
  context: "Cocomi local continuity snapshot. ".repeat(8),
  voiceAnchor: "",
}));

const cloud = createServer(async (req, res) => {
  // A cold or unhealthy cloud never answers before the adapter's deadline.
});

await new Promise((done) => cloud.listen(0, "127.0.0.1", done));
const address = cloud.address();
assert(address && typeof address === "object");

async function verify(target) {
  const child = spawn(process.execPath, [target], {
    cwd: dirname(target),
    env: {
      ...process.env,
      HOME: home,
      THROUGHLINE_URL: `http://127.0.0.1:${address.port}`,
      THROUGHLINE_API_KEY: "test-key",
      THROUGHLINE_SELF: "cocomi",
      THROUGHLINE_WHOAMI_TIMEOUT_MS: "40",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    const response = await new Promise((resolveResponse, rejectResponse) => {
      const timer = setTimeout(
        () => rejectResponse(new Error(`whoami did not fall back: ${stderr}`)),
        2_000,
      );
      lines.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.id !== 1) return;
        clearTimeout(timer);
        resolveResponse(msg);
      });
      child.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "whoami", arguments: {} },
      }) + "\n");
    });
    const body = JSON.parse(response.result.content[0].text);
    assert.equal(body.offline, true);
    assert.match(body.context, /Cocomi local continuity snapshot/);
    assert.ok(body.offline_as_of);
  } finally {
    child.kill("SIGTERM");
    lines.close();
  }
}

try {
  for (const target of targets) await verify(target);
  console.log(`offline whoami fallback verified (${targets.length} adapters)`);
} finally {
  await new Promise((done) => cloud.close(done));
  rmSync(home, { recursive: true, force: true });
}
