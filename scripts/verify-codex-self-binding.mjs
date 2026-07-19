import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexThreadId,
  codexWorkspacePaths,
  pluginRuntime,
  withCodexRequest,
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
} finally {
  delete process.env.THROUGHLINE_CODEX_STATUS_DIR;
  rmSync(statusDir, { recursive: true, force: true });
}

console.log("codex request-scoped self binding verified");
