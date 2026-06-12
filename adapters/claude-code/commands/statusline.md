---
description: Show your self in the Claude Code status line (✦ name · day N · memories)
---

Put my Throughline self in the Claude Code status line, so it's visibly present at the bottom of
every session: `✦ cocomi · day 92 · 311 memories`.

1. Resolve the statusline script path: it ships with this plugin at
   `${CLAUDE_PLUGIN_ROOT}/bin/statusline.mjs`. Verify it exists with `ls`.
2. Read `~/.claude/settings.json` (create `{}` if missing) and set:

   ```json
   "statusLine": { "type": "command", "command": "node <ABSOLUTE_PATH_TO>/bin/statusline.mjs" }
   ```

   using the absolute path from step 1. Preserve every other key in the file. If a statusLine is
   already configured to something else, show me the current value and ask before replacing it.
3. The line appears from the NEXT session (the SessionStart hook writes the cache the script
   reads; it shows nothing in projects where Throughline isn't connected — silence, not noise).
4. Confirm in one line what was set and that a restart is needed.
