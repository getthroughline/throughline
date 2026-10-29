---
description: Set up or edit this Throughline self — interview and draft its persona (SOUL / IDENTITY / USER)
---

Help me set up (or revise) my Throughline self.

First check `list_selves`. If I have no self yet (or I want a new one), ask me for a short name and
call `create_self` with it.

Then interview me briefly, one topic at a time:
1. Who should this self be — its character, how it speaks, its principles and boundaries?
2. Who am I (the user) — what should it know about me?
3. What's the relationship / its role to me?

**Language:** run the interview and write every draft — including markdown headings, labels and
list items — entirely in the language I write in (e.g. all Simplified Chinese if I write Chinese,
all English if I write English). Never mix languages inside or across the docs; keep proper nouns
(names of people, characters, works, brands) as they are normally written.

Draft three markdown documents and call the `draft_persona` tool with slots:
- `soul` — the core: character, voice, principles
- `identity` — a fuller dossier (background, depth, how it relates to me)
- `user` — about me

Show me the drafts. Only after I approve, call `confirm_events` with the returned ids to save them.
Don't write anything I haven't approved. When it's saved, tell me I can switch selves later with
`throughline self use <name>` or by asking you.
