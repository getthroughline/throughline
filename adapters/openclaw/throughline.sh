#!/usr/bin/env bash
# Throughline for OpenClaw — a thin curl wrapper in OpenClaw's native idiom (exec + files).
# The model calls these subcommands; the cloud does the rest. No daemon, no deps beyond curl+jq-less.
#
# Setup: THROUGHLINE_API_KEY in ~/.openclaw/.env (key from getthroughline.ai/account).
# Optional: THROUGHLINE_SELF (pin a self), THROUGHLINE_URL (self-host).
set -euo pipefail

BASE="${THROUGHLINE_URL:-https://getthroughline.ai}"
KEY="${THROUGHLINE_API_KEY:-}"
[ -z "$KEY" ] && { echo "THROUGHLINE_API_KEY not set (get it at $BASE/account)"; exit 1; }

auth=(-H "authorization: Bearer $KEY" -H "x-throughline-source: openclaw" -H "content-type: application/json")
[ -n "${THROUGHLINE_MODEL:-}" ] && auth+=(-H "x-throughline-model: $THROUGHLINE_MODEL")

self() {
  if [ -n "${THROUGHLINE_SELF:-}" ]; then echo "$THROUGHLINE_SELF"; return; fi
  curl -sf "$BASE/config" "${auth[@]}" | sed -n 's/.*"default_self"[: ]*"\([^"]*\)".*/\1/p'
}

case "${1:-help}" in
  bootstrap)   # one round trip: context + reflection/pending signals. Run at session start; ADOPT the output.
    curl -sf "$BASE/selves/$(self)/bootstrap?mode=${2:-full}" "${auth[@]}" ;;
  journal)     # journal "a one-line diary note" — the main capture path, cheap and frequent
    shift; curl -sf -X POST "$BASE/selves/$(self)/journal" "${auth[@]}" -d "{\"content\": $(printf '%s' "$*" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}" ;;
  recall)      # recall "query" [k] — search memory before claiming you don't remember
    q=$(printf '%s' "$2" | python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.stdin.read()))')
    curl -sf "$BASE/selves/$(self)/recall?q=$q&k=${3:-8}" "${auth[@]}" ;;
  context)     # the injected self-context only
    curl -sf "$BASE/selves/$(self)/context" "${auth[@]}" ;;
  propose)     # propose '<events-json>' — structured capture (rules/corrections stage for the user)
    curl -sf -X POST "$BASE/selves/$(self)/capture/propose" "${auth[@]}" -d "$2" ;;
  pending)     # staged candidates awaiting the user's confirm
    curl -sf "$BASE/selves/$(self)/capture/pending" "${auth[@]}" ;;
  confirm)     # confirm <event-id> — ONLY after the user explicitly approved in conversation
    curl -sf -X POST "$BASE/selves/$(self)/capture/confirm" "${auth[@]}" -d "{\"id\":\"$2\"}" ;;
  retract)     # retract <event-id> — delete a wrongly captured memory
    curl -sf -X POST "$BASE/selves/$(self)/capture/retract" "${auth[@]}" -d "{\"id\":\"$2\"}" ;;
  reflect)     # raw material + guidance for consolidation (run from HEARTBEAT when due)
    curl -sf "$BASE/selves/$(self)/reflect" "${auth[@]}" ;;
  reflect-done) # reflect-done <cursor> — advance the watermark after distilling
    curl -sf -X POST "$BASE/selves/$(self)/reflect/complete" "${auth[@]}" -d "{\"cursor\":$2}" ;;
  *)
    sed -n '2,6p' "$0"; echo; grep -E '^  [a-z-]+\)' "$0" | sed 's/).*#/ —/' ;;
esac
