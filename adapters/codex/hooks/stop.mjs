#!/usr/bin/env node
// Evidence-only close. Silent when this Codex host does not expose a transcript path.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasKey, rawPost, safe, self, sessionMode } from "../lib/daemon.mjs";

const done = () => process.exit(0);
try {
  if ((!hasKey() && !process.env.THROUGHLINE_URL) || sessionMode("full") === "off") done();
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (input.stop_hook_active || !input.transcript_path || !existsSync(input.transcript_path)) done();
  const textOf = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.filter((x) => x.type === "text" || x.type === "output_text").map((x) => x.text ?? x.content ?? "").join("\n") : "";
  const turns = [];
  for (const line of readFileSync(input.transcript_path, "utf8").trim().split("\n")) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const role = o.message?.role ?? o.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = textOf(o.message?.content ?? o.content).trim();
    if (content) turns.push({ role, content });
  }
  const cursorFile = join(tmpdir(), "throughline-raw-" + Buffer.from(input.transcript_path).toString("base64url").slice(-40) + ".json");
  let cursor = 0; try { cursor = JSON.parse(readFileSync(cursorFile, "utf8")).n || 0; } catch {}
  const fresh = turns.slice(cursor);
  if (fresh.length < 2) done();
  const name = await safe(() => self(), "assistant");
  const saved = await safe(() => rawPost(`/selves/${encodeURIComponent(name)}/capture/raw-turns`, { turns: fresh.slice(-8) }), null);
  if (saved) try { writeFileSync(cursorFile, JSON.stringify({ n: turns.length })); } catch {}
} catch {}
done();
