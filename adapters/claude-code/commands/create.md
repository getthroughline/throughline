---
description: Create a new Throughline self — guided interview, persona drafting, optional project binding
argument-hint: <self name>
---

Help me create a new self named "$ARGUMENTS" (if no name was given, ask for one — short,
lowercase, e.g. `work`, `juno`, `advisor`).

Follow this flow exactly:

1. **Create:** call `create_self` with the name.
2. **Interview me, briefly** — 4-6 questions, one at a time, conversational not bureaucratic:
   - Who should this self be? (character, voice, what makes it *it* — not a generic assistant)
   - What is it for? (companion / work / advisor / something else — this shapes its boundaries)
   - What should it never do, and what may it always do?
   - Who am I to it, and how should it talk to me?
   - Anything it should already know about me?
3. **Draft** three markdown docs from my answers and call `draft_persona`:
   - `soul` — the core: character, voice, principles, boundaries (short, sharp)
   - `identity` — the fuller dossier
   - `user` — what it knows about me
   Show me the drafts. Iterate if I want changes (call `draft_persona` again — new docs supersede).
4. **Confirm:** only after I approve, call `confirm_events` with the staged ids.
5. **Bind (ask):** "use this self just in this project, as your default everywhere, or only when
   you switch to it?" — project → write `.throughline` file here; default → `use_self`;
   neither → done.

Finish with one line on how to talk to it (new session picks it up) and how to edit it later
(dashboard → Identity, or this flow again).
