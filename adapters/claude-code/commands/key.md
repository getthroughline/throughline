---
description: Save your Throughline API key (from the dashboard's Key & data page)
argument-hint: <API key>
---

Save my Throughline API key so the plugin can reach my cloud self.

1. Write the file `~/.throughline/auth.json` with exactly this JSON content (create the directory
   if needed): `{"token":"$ARGUMENTS"}`. Then `chmod 600` it.
2. **Verify it now** — never let a bad key fail silently in the next session. Run (it reads the
   token back from the file, so the key itself never appears in the command or output):

   ```
   curl -fsS -m 8 -H "authorization: Bearer $(node -p 'JSON.parse(require("fs").readFileSync(require("os").homedir()+"/.throughline/auth.json","utf8")).token')" "${THROUGHLINE_URL:-https://getthroughline.ai}/config" > /dev/null && echo VERIFIED
   ```

3. Report by outcome, one line:
   - **VERIFIED** → the key is saved and works; tell me to start a new session so the self loads.
   - **HTTP 401/403** → the key is invalid or revoked: delete `~/.throughline/auth.json` (a broken
     file is worse than none) and tell me to re-copy the key from
     [getthroughline.ai/account](https://getthroughline.ai/account) (Key & data).
   - **Network error / timeout** → saved but unverified; say so plainly — the next session will tell.

Do NOT print the key back to me at any point.
