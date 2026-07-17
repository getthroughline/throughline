#!/usr/bin/env bash
# Throughline for OpenClaw — a thin curl wrapper in OpenClaw's native idiom (exec + files).
# The model calls these subcommands; the cloud does the rest. No daemon, no deps beyond curl+jq-less.
#
# Setup: THROUGHLINE_API_KEY in ~/.openclaw/.env (key from getthroughline.ai/account).
# Optional: THROUGHLINE_SELF (pin a self), THROUGHLINE_URL (self-host).
set -euo pipefail

BASE="${THROUGHLINE_URL:-https://getthroughline.ai}"
KEY="${THROUGHLINE_API_KEY:-}"
# isolated cron sessions may not inherit the env — fall back to ~/.openclaw/.env directly
if [ -z "$KEY" ] && [ -f "$HOME/.openclaw/.env" ]; then
  KEY="$(grep '^THROUGHLINE_API_KEY=' "$HOME/.openclaw/.env" | head -1 | cut -d= -f2-)"
fi
[ -z "$KEY" ] && { echo "THROUGHLINE_API_KEY not set (get it at $BASE/account)"; exit 1; }

auth=(-H "authorization: Bearer $KEY" -H "x-throughline-source: openclaw" -H "content-type: application/json")
[ -n "${THROUGHLINE_MODEL:-}" ] && auth+=(-H "x-throughline-model: $THROUGHLINE_MODEL")

self() {
  if [ -n "${THROUGHLINE_SELF:-}" ]; then echo "$THROUGHLINE_SELF"; return; fi
  # workspace-local pin: a .throughline file (first line = self name) — same convention as the
  # Claude Code plugin, so one machine can run different selves per workspace.
  for f in ".throughline" "$(dirname "$0")/../.throughline"; do
    if [ -f "$f" ]; then head -1 "$f" | tr -d '[:space:]'; return; fi
  done
  curl -sf "$BASE/config" "${auth[@]}" | sed -n 's/.*"default_self"[: ]*"\([^"]*\)".*/\1/p'
}

case "${1:-help}" in
  bootstrap)   # one round trip: context + reflection/pending signals. Run at session start; ADOPT the output.
    curl -sf "$BASE/selves/$(self)/bootstrap?mode=${2:-full}" "${auth[@]}" ;;
  journal)     # journal "a one-line diary note" — the main capture path, cheap and frequent
    shift; curl -sf -X POST "$BASE/selves/$(self)/journal" "${auth[@]}" -d "{\"content\": $(printf '%s' "$*" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}" ;;
  recall)      # recall "query" [k] [stream] — search memory; empty query + stream = last k rows of that stream
    q=$(printf '%s' "$2" | python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.stdin.read()))')
    st=""; [ -n "${4:-}" ] && st="&stream=$4"
    curl -sf "$BASE/selves/$(self)/recall?q=$q&k=${3:-8}$st" "${auth[@]}" ;;
  context)     # the injected self-context only
    curl -sf "$BASE/selves/$(self)/context" "${auth[@]}" ;;
  propose)     # propose '<events-json>' — structured capture (rules/corrections stage for the user)
    curl -sf -X POST "$BASE/selves/$(self)/capture/propose" "${auth[@]}" -d "$2" ;;
  pending)     # pending [limit] — one small review batch (default 5, max 20)
    n="${2:-5}"; [ "$n" -ge 1 ] 2>/dev/null || n=5; [ "$n" -le 20 ] || n=20
    curl -sf "$BASE/selves/$(self)/capture/pending?limit=$n" "${auth[@]}" ;;
  confirm)     # confirm <event-id> — ONLY after the user explicitly approved in conversation
    curl -sf -X POST "$BASE/selves/$(self)/capture/confirm" "${auth[@]}" -d "{\"id\":\"$2\"}" ;;
  reject)      # reject <event-id> — discard a staged candidate the user declined
    curl -sf -X POST "$BASE/selves/$(self)/capture/reject" "${auth[@]}" -d "{\"id\":\"$2\"}" ;;
  retract)     # retract <event-id> — delete a wrongly captured memory
    curl -sf -X POST "$BASE/selves/$(self)/capture/retract" "${auth[@]}" -d "{\"id\":\"$2\"}" ;;
  reflect)     # manual diagnostic only when the user explicitly asks; cloud reflection is automatic
    curl -sf "$BASE/selves/$(self)/reflect" "${auth[@]}" ;;
  reflect-done) # reflect-done <cursor> — advance the watermark after distilling
    curl -sf -X POST "$BASE/selves/$(self)/reflect/complete" "${auth[@]}" -d "{\"cursor\":$2}" ;;
  coverage)    # coverage "topic" — honest "how well do I know X?" (none/thin/partial/strong)
    t=$(printf '%s' "$2" | python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.stdin.read()))')
    curl -sf "$BASE/selves/$(self)/coverage?topic=$t" "${auth[@]}" ;;
  selves)      # list this account's selves and the default
    curl -sf "$BASE/selves" "${auth[@]}" ;;
  create)      # create <name> — make a new self (name: letters/digits/dash/underscore/dot, 1-40)
    curl -sf -X POST "$BASE/selves/$2" "${auth[@]}" ;;
  use)         # use <name> — set the account default self (or pin per-workspace via .throughline)
    curl -sf -X POST "$BASE/config" "${auth[@]}" -d "{\"default_self\":\"$2\"}" ;;
  delete)      # delete <name> — permanently delete a self and all its memory (export first!)
    curl -sf -X DELETE "$BASE/selves/$2" "${auth[@]}" ;;
  draft-persona) # draft-persona '<docs-json>' — stage soul/identity/user docs for confirmation
    curl -sf -X POST "$BASE/selves/$(self)/capture/draft-persona" "${auth[@]}" -d "$2" ;;
  *)
    sed -n '2,6p' "$0"; echo; grep -E '^  [a-z-]+\)' "$0" | sed 's/).*#/ —/' ;;
esac
