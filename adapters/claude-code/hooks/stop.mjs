#!/usr/bin/env node
// Evidence-only close: no extraction model and no reflection. The cloud owns later distillation.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasKey, rawPost, safe, self, sessionMode } from "../lib/daemon.mjs";
import { parseActionBundle, parseVisibleTurns } from "../lib/action-bundle.mjs";

const done = () => process.exit(0);
try {
  if ((!hasKey() && !process.env.THROUGHLINE_URL) || sessionMode("full") === "off") done();
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (input.stop_hook_active || !input.transcript_path || !existsSync(input.transcript_path)) done();
  const lines = readFileSync(input.transcript_path, "utf8").trim().split("\n");
  const turns = parseVisibleTurns(lines, "claude");
  const cursorFile = join(tmpdir(), "throughline-raw-" + Buffer.from(input.transcript_path).toString("base64url").slice(-40) + ".json");
  let cursor = {}; try { cursor = JSON.parse(readFileSync(cursorFile, "utf8")); } catch {}
  const fresh = turns.slice(cursor.n || 0);
  const actionStart = cursor.actionLines || 0;
  const bundle = parseActionBundle(lines.slice(actionStart), "claude");
  const name = await safe(() => self(), "assistant");
  const saved = fresh.length >= 2
    ? await safe(() => rawPost(`/selves/${encodeURIComponent(name)}/capture/raw-turns`, { turns: fresh.slice(-8) }), null)
    : true;
  const actionSaved = bundle.actions.length
    ? await safe(() => rawPost(`/selves/${encodeURIComponent(name)}/capture/action-bundle`, {
        ...bundle, bundle_id: `${Buffer.from(input.transcript_path).toString("base64url").slice(-28)}:${actionStart}-${lines.length}`,
      }), null)
    : true;
  if (saved || actionSaved) try { writeFileSync(cursorFile, JSON.stringify({ n: saved ? turns.length : cursor.n || 0, actionLines: actionSaved ? lines.length : actionStart })); } catch {}
} catch {}
done();
