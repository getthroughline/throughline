#!/usr/bin/env node
// Throughline statusline for Claude Code — the self, visibly present: "✦ cocomi · day 92 · 311 memories".
// Reads the per-cwd cache the SessionStart hook writes; prints nothing when there's no fresh self.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

let cwd = process.cwd();
try {
  const inp = JSON.parse(readFileSync(0, "utf8"));
  cwd = inp?.workspace?.current_dir || inp?.cwd || cwd;
} catch { /* no stdin payload — fall back to process cwd */ }
try {
  const file = join(homedir(), ".throughline", "status", createHash("sha256").update(cwd).digest("hex").slice(0, 16) + ".json");
  const s = JSON.parse(readFileSync(file, "utf8"));
  if (Date.now() - s.ts < 7 * 86_400_000) console.log(s.line); // a week-stale self is no self
} catch { /* not connected here — stay silent */ }
