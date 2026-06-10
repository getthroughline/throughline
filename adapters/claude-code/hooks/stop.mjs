#!/usr/bin/env node
// Stop hook: deterministic write-back. The model already replied; relying on it to *volunteer* a
// propose_events call mid-conversation doesn't work in practice (it reads and answers, but rarely
// writes). So after each turn we send the new exchanges — tracked by a per-transcript cursor — to
// the cloud, which extracts durable memories through the SAME propose() gate. Background, silent,
// never blocks the session. Mirrors the web-chat write-back.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rawPost, self, sessionMode, hasKey, safe } from "../lib/daemon.mjs";

const done = () => process.exit(0); // never block Stop, never error the session

try {
  if (!hasKey() && !process.env.THROUGHLINE_URL) done();
  const MODE = sessionMode("full");
  if (MODE === "off") done(); // opted out: no capture

  // hook stdin: { session_id, transcript_path, stop_hook_active, ... }
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (input.stop_hook_active) done(); // we're inside a stop continuation — don't recurse
  const tp = input.transcript_path;
  if (!tp || !existsSync(tp)) done();

  // collect ordered user/assistant text turns (skip thinking, tool_use, tool_result)
  const textOf = (content) => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    return "";
  };
  const turns = [];
  for (const line of readFileSync(tp, "utf8").trim().split("\n")) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const role = o.message?.role;
    if ((o.type === "user" && role === "user") || (o.type === "assistant" && role === "assistant")) {
      const content = textOf(o.message?.content).trim();
      if (content) turns.push({ role, content });
    }
  }

  // cursor: how many turns we've already shipped for this transcript
  const cursorFile = join(tmpdir(), "throughline-capture-" + Buffer.from(tp).toString("base64url").slice(-40) + ".json");
  let cursor = 0;
  if (existsSync(cursorFile)) { try { cursor = JSON.parse(readFileSync(cursorFile, "utf8")).n || 0; } catch {} }
  const fresh = turns.slice(cursor);
  // debounce: wait for at least one full exchange of new material before spending an extraction
  if (fresh.length < 2) done();

  const SELF = await safe(() => self(), "assistant");
  await safe(() => rawPost(`/selves/${encodeURIComponent(SELF)}/capture/ingest`, { turns: fresh.slice(-40) }), null);
  try { writeFileSync(cursorFile, JSON.stringify({ n: turns.length })); } catch {}
} catch { /* best-effort: capture must never break the session */ }
done();
