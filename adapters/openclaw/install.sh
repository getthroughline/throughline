#!/usr/bin/env bash
# Throughline → OpenClaw one-line installer.
#   curl -fsSL https://getthroughline.ai/openclaw.sh | bash
#   curl -fsSL https://getthroughline.ai/openclaw.sh | bash -s -- ~/.openclaw/workspace-karina haein
# Args: [workspace dir] [self name to pin]. Idempotent — safe to re-run.
set -euo pipefail

RAW="${THROUGHLINE_RAW:-https://raw.githubusercontent.com/getthroughline/throughline/main/adapters/openclaw}"
WS="${1:-$HOME/.openclaw/workspace}"
PIN="${2:-}"
ENVF="$HOME/.openclaw/.env"

[ -d "$WS" ] || { echo "✗ workspace not found: $WS  (pass one: ... | bash -s -- ~/.openclaw/workspace-foo)"; exit 1; }
echo "→ installing Throughline into $WS"

# 1. the exec script
mkdir -p "$WS/scripts"
curl -fsSL "$RAW/throughline.sh" -o "$WS/scripts/throughline.sh"
chmod +x "$WS/scripts/throughline.sh"
echo "  ✓ scripts/throughline.sh"

# 2. API key (prompt only if missing; reads from the terminal even under curl|bash)
if ! grep -q "^THROUGHLINE_API_KEY=" "$ENVF" 2>/dev/null; then
  if [ -r /dev/tty ]; then
    printf "  Throughline API key (from https://getthroughline.ai/account): "
    read -r KEY < /dev/tty
    [ -n "$KEY" ] && { printf "\nTHROUGHLINE_API_KEY=%s\n" "$KEY" >> "$ENVF"; echo "  ✓ key saved to ~/.openclaw/.env"; }
  else
    echo "  ⚠ no THROUGHLINE_API_KEY in ~/.openclaw/.env — add it manually (getthroughline.ai/account)"
  fi
fi

# 3. optional per-workspace self pin (a .throughline file, same convention as the Claude Code plugin)
if [ -n "$PIN" ]; then
  printf "%s\n" "$PIN" > "$WS/.throughline"
  echo "  ✓ pinned self '$PIN' (.throughline)"
fi

# 4. AGENTS.md block (append once, never duplicate)
if ! grep -q "Throughline — your persistent self" "$WS/AGENTS.md" 2>/dev/null; then
  { echo; curl -fsSL "$RAW/AGENTS-SNIPPET.md" | sed '1{/^# → paste/d;}'; } >> "$WS/AGENTS.md"
  echo "  ✓ AGENTS.md block appended"
else
  echo "  · AGENTS.md already has the block"
fi
# v0.8.25: routine reflection moved to one canonical cloud executor. Remove only the exact legacy
# block this installer used to append; leave every user-authored heartbeat instruction untouched.
if grep -q '^## Throughline reflection（' "$WS/HEARTBEAT.md" 2>/dev/null; then
  tmp="$(mktemp)"
  awk 'BEGIN{drop=0} /^## Throughline reflection（/{drop=1;next} drop && /^## /{drop=0} !drop{print}' "$WS/HEARTBEAT.md" > "$tmp"
  mv "$tmp" "$WS/HEARTBEAT.md"
  echo "  ✓ removed legacy host-side reflection job (cloud now owns it)"
fi

# 5. smoke
echo "→ testing…"
if THROUGHLINE_API_KEY="$(grep '^THROUGHLINE_API_KEY=' "$ENVF" 2>/dev/null | cut -d= -f2-)" "$WS/scripts/throughline.sh" bootstrap >/dev/null 2>&1; then
  echo "  ✓ connected — your self is live in this workspace. Next session, the agent adopts it automatically."
else
  echo "  ⚠ couldn't reach the API yet — check the key in ~/.openclaw/.env, then run: scripts/throughline.sh bootstrap"
fi
