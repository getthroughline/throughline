#!/usr/bin/env node
// Host-turn close: admit the exact delivered output, then ask the cloud to ingest that exchange
// with its input/output evidence. Silent when this Codex host exposes no transcript path.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasKey, isProtocolUpgradeError, rawPost, safe, self, sessionDisabled } from "../lib/daemon.mjs";
import { parseActionBundle, parseVisibleTurns } from "../lib/action-bundle.mjs";
import { consumeDecisionExchange, matchDecisionExchanges, rememberDecisionOutput } from "../lib/decision-receipt.mjs";

const done = () => process.exit(0);
const emitNotice = (systemMessage) => process.stdout.write(JSON.stringify({ systemMessage }));
const upgradeNotice = (error) =>
  `Throughline plugin upgrade required: shared-self capture was rejected (${String(error?.code || error?.message || "HTTP 426")}). `
  + "Update Throughline and start a new session; the rejected exchange was not written to shared history.";
try {
  if ((!hasKey() && !process.env.THROUGHLINE_URL) || sessionDisabled()) done();
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  if (input.stop_hook_active || !input.transcript_path || !existsSync(input.transcript_path)) done();
  const lines = readFileSync(input.transcript_path, "utf8").trim().split("\n");
  const turns = parseVisibleTurns(lines, "codex");
  const cursorFile = join(tmpdir(), "throughline-raw-" + Buffer.from(input.transcript_path).toString("base64url").slice(-40) + ".json");
  let cursor = {}; try { cursor = JSON.parse(readFileSync(cursorFile, "utf8")); } catch {}
  const rawStart = Math.max(0, Number(cursor.n) || 0);
  const fresh = turns.slice(rawStart);
  const exchanges = matchDecisionExchanges(input, "codex", fresh);
  let rawCursor = rawStart;
  let protocolMessage = "";
  const name = await safe(() => self(), "assistant");
  for (const exchange of exchanges) {
    const nextCursor = rawStart + exchange.end;
    if (!exchange.capture) {
      rawCursor = nextCursor;
      continue;
    }
    try {
      const saved = await rawPost(`/selves/${encodeURIComponent(name)}/capture/raw-turns`, {
        turns: exchange.capture.turns,
        conversation_ref: exchange.capture.conversation_ref,
        capture_ref: exchange.capture.capture_ref,
      });
      if (saved?.protocol !== 2 || saved?.action_ref !== exchange.capture.action_ref || !saved?.event_ref)
        throw new Error("host-turn v2 capture acknowledgement did not match its action identity");
      const evidenceRefs = rememberDecisionOutput(
        input, "codex", exchange.capture.capture_ref, saved.event_ref,
      );
      await rawPost(`/selves/${encodeURIComponent(name)}/capture/ingest`, {
        turns: exchange.capture.turns.map(({ role, content }) => ({ role, content })),
        conversation_ref: exchange.capture.conversation_ref,
        capture_ref: exchange.capture.capture_ref,
        evidence_refs: evidenceRefs,
      });
      consumeDecisionExchange(input, "codex", exchange.capture.capture_ref);
      rawCursor = nextCursor;
    } catch (error) {
      if (isProtocolUpgradeError(error)) protocolMessage = upgradeNotice(error);
      break;
    }
  }
  const actionStart = cursor.actionLines || 0;
  const bundle = parseActionBundle(lines.slice(actionStart), "codex");
  const actionSaved = bundle.actions.length
    ? await safe(() => rawPost(`/selves/${encodeURIComponent(name)}/capture/action-bundle`, {
        ...bundle, bundle_id: `${Buffer.from(input.transcript_path).toString("base64url").slice(-28)}:${actionStart}-${lines.length}`,
      }), null)
    : true;
  if (rawCursor !== rawStart || actionSaved) try {
    writeFileSync(cursorFile, JSON.stringify({ n: rawCursor, actionLines: actionSaved ? lines.length : actionStart }));
  } catch {}
  if (protocolMessage) emitNotice(protocolMessage);
} catch {}
