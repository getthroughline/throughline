---
description: Save your Throughline API key (from the dashboard's Key & data page)
argument-hint: <API key>
---

Save my Throughline API key so the plugin can reach my cloud self.

Write the file `~/.throughline/auth.json` with exactly this JSON content (create the directory if
needed): `{"token":"$ARGUMENTS"}`. Then `chmod 600` it.

Do NOT print the key back to me. Confirm in one line that it's saved, and tell me to start a new
session so the self loads.
