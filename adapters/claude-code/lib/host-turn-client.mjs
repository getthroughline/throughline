import { isLegacyDecisionEndpointError, isProtocolUpgradeError, rawGet } from "./daemon.mjs";
import {
  closeDecisionExchange,
  decisionRequestPath,
  isLegacyDecisionResponse,
  prepareDecisionExchange,
  rememberDecisionReceipt,
} from "./decision-receipt.mjs";

const protocolNotice = (detail) =>
  `Throughline plugin upgrade required: the server rejected this turn's shared-self protocol${detail ? ` (${detail})` : ""}. `
  + "Update Throughline and start a new session; this turn was not admitted to shared history.";

const protocolGuard = "# Throughline shared-self capture unavailable\n"
  + "This turn was not admitted by the host-turn protocol. Keep the local self anchor, but do not "
  + "claim that this answer entered shared memory or carries an admitted cross-body decision.";

async function legacyRecall(selfName, subject) {
  try {
    const query = new URLSearchParams({ q: subject, k: "4", semantic: "0" });
    const response = await rawGet(`/selves/${encodeURIComponent(selfName)}/recall?${query.toString()}`);
    const rows = Array.isArray(response?.events) ? response.events : [];
    if (!rows.length) return "";
    return "Fresh cross-body memory for THIS prompt (may shape the answer; mention only when needed):\n"
      + rows.map((event) => `- [${String(event.ts ?? "").slice(0, 10)} · ${event.stream}] ${String(event.body?.content ?? event.body?.observation ?? "").slice(0, 220)}`).join("\n");
  } catch { return ""; }
}

/** Resolve one current prompt through host-turn v2. Only a proven old endpoint may use read-only
 * recall; 426 and malformed v2 responses are terminal for shared history and visibly surfaced. */
export async function loadHostTurnDecision(input, host, selfName, prompt) {
  let exchange;
  try {
    exchange = prepareDecisionExchange(input, host, prompt);
    if (!exchange) return { context: "", systemMessage: "" };
    const response = await rawGet(decisionRequestPath(selfName, exchange));
    if (response?.protocol === 2) {
      try {
        rememberDecisionReceipt(input, host, prompt, exchange, response);
      } catch {
        closeDecisionExchange(input, host, exchange.capture_ref, "invalid-v2-identity");
        return {
          context: protocolGuard,
          systemMessage: protocolNotice("mismatched host-turn v2 identity"),
          protocolFailure: true,
        };
      }
      return { context: String(response.context ?? ""), systemMessage: "", exchange, response };
    }
    if (isLegacyDecisionResponse(response)) {
      closeDecisionExchange(input, host, exchange.capture_ref, "legacy-response");
      return { context: String(response.context), systemMessage: "", legacy: true };
    }
    closeDecisionExchange(input, host, exchange.capture_ref, "invalid-response");
    return {
      context: protocolGuard,
      systemMessage: protocolNotice("invalid host-turn v2 response"),
      protocolFailure: true,
    };
  } catch (error) {
    if (isProtocolUpgradeError(error)) {
      if (exchange) closeDecisionExchange(input, host, exchange.capture_ref, "upgrade-required");
      return {
        context: protocolGuard,
        systemMessage: protocolNotice(String(error.code || error.message || "HTTP 426")),
        protocolFailure: true,
      };
    }
    if (isLegacyDecisionEndpointError(error)) {
      if (exchange) closeDecisionExchange(input, host, exchange.capture_ref, "legacy-endpoint");
      return { context: await legacyRecall(selfName, exchange?.subject ?? ""), systemMessage: "", legacy: true };
    }
    // Network, timeout and local persistence failures stay fail-soft. The caller still emits its
    // local anchor, and no receipt means Stop cannot turn this unadmitted output into self-history.
    return { context: "", systemMessage: "", transientFailure: true };
  }
}
