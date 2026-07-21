import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexThreadId,
  codexWorkspacePaths,
  pluginRuntime,
  withCodexRequest,
  rebindSelf,
  self,
} from "../adapters/codex/lib/daemon.mjs";

assert.equal(pluginRuntime("/Users/example/throughline-cloud"), false);
assert.equal(
  pluginRuntime("/Users/example/.codex/plugins/cache/throughline/throughline/0.8.34/lib"),
  true,
);

const meta = {
  params: {
    _meta: {
      threadId: "thread-cocomi",
      "x-codex-turn-metadata": {
        session_id: "wrong-lower-priority-id",
        workspaces: {
          "/Users/example/throughline-cloud": { latest_git_commit_hash: "abc" },
        },
      },
    },
  },
};
assert.equal(codexThreadId(meta), "thread-cocomi");
assert.deepEqual(codexWorkspacePaths(meta), ["/Users/example/throughline-cloud", process.cwd()]);

const statusDir = mkdtempSync(join(tmpdir(), "throughline-codex-binding-"));
process.env.THROUGHLINE_CODEX_STATUS_DIR = statusDir;
try {
  writeFileSync(join(statusDir, "thread-thread-cocomi.json"), JSON.stringify({ self: "cocomi", ts: Date.now() }));
  writeFileSync(join(statusDir, "thread-thread-haein.json"), JSON.stringify({ self: "haein", ts: Date.now() }));
  const [cocomi, haein] = await Promise.all([
    withCodexRequest({ threadId: "thread-cocomi", workspaces: {} }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return self();
    }),
    withCodexRequest({ threadId: "thread-haein", workspaces: {} }, async () => self()),
  ]);
  assert.deepEqual([cocomi, haein], ["cocomi", "haein"]);

  const project = join(statusDir, "project");
  mkdirSync(project);
  writeFileSync(join(project, ".throughline"), "cocomi\n");
  writeFileSync(join(statusDir, "thread-thread-project.json"), JSON.stringify({ self: "haein", source: "account-default", ts: Date.now() }));
  assert.equal(await withCodexRequest({ threadId: "thread-project", workspace: project }, async () => self()), "cocomi");

  writeFileSync(join(statusDir, "thread-thread-switch.json"), JSON.stringify({ self: "haein", source: "account-default", ts: Date.now() }));
  assert.equal(await withCodexRequest({ threadId: "thread-switch", workspaces: {} }, async () => {
    assert.equal(await self(), "haein");
    assert.equal(rebindSelf("cocomi"), true);
    return self();
  }), "cocomi");
  const switched = JSON.parse(readFileSync(join(statusDir, "thread-thread-switch.json"), "utf8"));
  assert.equal(switched.self, "cocomi");
  assert.equal(switched.source, "explicit-session");

  const unbound = join(statusDir, "unbound");
  mkdirSync(unbound);
  const unboundKey = (await import("node:crypto")).createHash("sha256").update(unbound).digest("hex").slice(0, 16);
  writeFileSync(join(statusDir, `${unboundKey}.json`), JSON.stringify({ self: "haein", source: "account-default", ts: Date.now() }));
  assert.notEqual(await withCodexRequest({ threadId: "thread-new", workspace: unbound }, async () => self()), "haein");
} finally {
  delete process.env.THROUGHLINE_CODEX_STATUS_DIR;
  rmSync(statusDir, { recursive: true, force: true });
}

console.log("codex request-scoped self binding verified");
