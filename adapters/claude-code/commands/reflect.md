---
description: Consolidate recent memories into lasting understanding (reflection)
---

Run a reflection pass on my active self.

1. Call the `reflect` tool. It returns the raw memories accrued since the last reflection, the
   self's existing stances/rules, and guidance.
2. Follow the guidance: distill the raw material into a few lasting higher-order memories —
   voiced stances (`self-continuity`), tone/boundary lessons (`persona-ledger`), or callback
   hooks (`shared-history`) — each citing evidence from the raw events.
3. **Reconcile contradictions, never silently pick a winner.** If something contradicts an
   existing stance/rule, surface it to me and let me classify: a genuine change of mind →
   propose the new event with `supersedes` = the old id; both true depending on context →
   propose a `relations` tension; unsure → leave both.
4. Show me a short plain-language summary, get my confirmation via `propose_events` /
   `confirm_events`, then call `complete_reflection` with the cursor `reflect` gave you.

If there's nothing meaningful to consolidate yet, just say so — don't invent.
