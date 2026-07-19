import assert from "node:assert/strict";
import { pluginRuntime } from "../adapters/codex/lib/daemon.mjs";

assert.equal(pluginRuntime("/Users/example/throughline-cloud"), false);
assert.equal(
  pluginRuntime("/Users/example/.codex/plugins/cache/throughline/throughline/0.8.34/lib"),
  true,
);

console.log("codex self binding fallback scope verified");
