---
description: Create or edit this self's persona by interview (drafts SOUL / IDENTITY / USER)
---

Help me set up (or revise) this Throughline self's persona.

Interview me briefly, one topic at a time:
1. Who should this self be — its character, how it speaks, its principles and boundaries?
2. Who am I (the user) — what should it know about me?
3. What's the relationship / its role to me?

Then draft three markdown documents and call the `draft_persona` MCP tool with slots:
- `soul` — the core: character, voice, principles
- `identity` — a fuller dossier (background, depth, how it relates to me)
- `user` — about me

Show me the drafts. Only after I approve, call `confirm_events` with the returned ids to save
them. Don't write anything I haven't approved.
