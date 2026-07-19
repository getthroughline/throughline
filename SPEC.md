# Throughline Event Spec — v1 (2026-06-10)

The self IS this format. Any store that holds these events and any host that honors these
semantics can carry the same self. This document is the contract that makes "own the self,
BYO body" implementation-independent. Changes bump the version; v1 events must remain
interpretable forever.

## 1. The envelope

Every memory is one immutable event:

```json
{
  "id": "evt_<24 hex>",
  "self": "string",
  "stream": "string",
  "ts": "ISO-8601",
  "type": "string",
  "body": { },
  "evidence": ["string", "..."],
  "supersedes": "evt_… | null"
}
```

**Content-addressed id:** `id = "evt_" + sha256(canonical(envelope minus id))[:24]`, where
`canonical` is JSON with object keys sorted recursively (arrays keep order). Consequences:
identical content deduplicates everywhere; append is idempotent; sync between stores is a
conflict-free union; an export is self-verifying (recompute every id).

**Append-only.** Events are never edited. Change of mind = a new event with `supersedes`
pointing at the old one (the old row stays, auditable). The only deletion is `retract`
(§5) — the user's right to remove a wrongly captured memory entirely.

## 2. Stream registry

| stream | what it holds | capture tier | evidence | recall policy | injected |
|---|---|---|---|---|---|
| `persona` | authored self docs (slots: soul/identity/relationship/user) | owner-only | `["authored"]` | — | always (full docs) |
| `persona-ledger` | observed tone/boundary facts of the relationship | confirm-first | required | reinforced | tone section |
| `permission-policy` | standing rules the self must follow | confirm-first | required | reinforced | rules section (never hidden; tensions annotated both sides) |
| `correction-rules` | trigger → do/avoid corrections | confirm-first | required | reinforced | corrections section |
| `risk-events` | open risks with severity + required response | confirm-first | required | **governed** | risks section (sev ≥ 3) |
| `self-continuity` | stances the self actually voiced | confirm-first | required | reinforced | "her own line" (salience-capped 6) |
| `self-state` | the self's own subjective layer: moods, opinions, fallible impressions | auto-save | **exempt** (the one allowed-subjective stream) | reinforced | latest active row, marked subjective |
| `relations` | links between events; `type: "tension"` = held contradiction, `type: "episode"` = grouping | confirm-first | required (member ids) | — | arbitrates shadowing |
| `shared-history` | real shared moments / inside jokes / callbacks | auto-save | required | reinforced | callbacks (salience-capped 8) |
| `journal` | raw prose inlet (diary lines, conversation residue) | auto-save | **exempt** (it IS the evidence) | reinforced | never (raw material) |
| `judgment-ledger` | judgments: ticker/topic, thesis, conviction 1-5, falsifier, status | auto-save | required; `*.opened` requires `falsifier` | **governed** | calibration block (computed) |
| `investment-lessons`, `failure-ledger` | resolved lessons / repeated failures | auto-save | required | **governed** | — |
| `attunement`, `relationship-pulse` | observable interaction signals only (schema-restricted fields) | auto-save | required | reinforced | — |
| `commitments` | open obligations (`status: open/done/dropped`) | auto-save | required | reinforced | — |
| `salience` | checkpointed memory-weighting (`target`, `salience`, `state`) | system | exempt | — | excluded from knowledge basis |

Unknown streams are legal (auto-save tier, evidence required, recallable, not injected).
A host must ignore streams it doesn't understand, never reject them.

## 3. Discipline (enforced at the write path, server-side)

1. **Owner-only:** `persona` is never writable during a session; only the explicit authoring
   flow (`allowOwner`) may stage it, and it still requires user confirmation.
2. **Evidence:** all proposed events require non-empty `evidence`, except `self-state` and
   `journal` (§2). Evidence-critical streams require it even on direct appends.
3. **Observable-only:** `attunement` / `relationship-pulse` accept only their registered
   observation fields — inferred feelings are rejected at the schema level.
4. **Anti-flattery:** self-praise / inferred-affection phrasing ("他很喜欢", "I did great",
   "he felt …") is rejected in `shared-history`, `self-continuity`, `self-state`, and
   observable-only streams. `journal` is exempt — the user's own words are not policed.
5. **Falsifier:** a `judgment-ledger` `*.opened` event must name what would prove it wrong.
6. **Reconciliation (projection behavior, not a format change):** every open judgment has a
   review horizon — an explicit `review_by` (ISO date; `review_at`/`horizon` accepted), or a
   default 90-day staleness window when none was set. Past the horizon it is surfaced as due in
   the context pack, the dashboard, and reflection (which may *propose* a settlement when the raw
   diary explicitly settles the falsifier — staged like everything else). Settling = a
   superseding event with `status: confirmed|falsified`, carrying the body (incl. `conviction`)
   over. The settle rate — settled ÷ judgments that reached a horizon — is the ledger's value
   metric: a prediction is only worth its settled outcome.
7. **Stance shifts (projection behavior):** the one sanctioned way reflection may touch an
   existing `self-continuity` stance is a `stance.shift` proposal — a superseding event carrying
   the new position and a `why`, proposed only when the raw material shows the self explicitly
   voicing the change, and staged for confirmation like all reflection output. Mere contradiction
   in the raw material is never resolved by the distiller — humans classify contradictions.

**Evidence convention (recommended):** point at things that survive migration — event ids
(`evt_…`, e.g. the journal entry that records the moment) over host-private pointers
(`t:#m123`). Host pointers are legal but unverifiable after the self moves.

## 4. Capture tiers + fidelity gate

`propose` classifies each candidate:
- **auto-save** (observational streams): appended immediately, retractable. Confirmation
  fatigue kills memory accrual faster than a wrong low-risk memory does.
- **confirm-first** (behavior-shaping streams, §2): staged as pending; a human must confirm.
- `strict: true` forces everything to pending.
- **Fidelity gate:** if the writing model matches a weak-substrate marker
  (`-flash`, `-lite`, `-mini`, `-nano`, `-haiku`, `gemini` — denylist, fail-safe direction),
  it loses the auto-save privilege: all its captures stage. A low-fidelity fallback must not
  quietly pollute the self.

## 5. Lifecycle

- **Supersede** (change of mind): new event, `supersedes: <old id>`. Old row stays, inactive.
- **Status**: a row with `body.status` ∈ {superseded, retired, resolved, dropped, done} is
  inactive for projections (still recallable).
- **Tension** (held contradiction): `relations` event, `type: "tension"`,
  `body.members: [idA, idB]`, optional `body.keys: {<id>: "when this side holds"}`. Both
  members stay active; the always-injected context shows the more salient member and notes
  the shadowed count. **Rules are the exception:** `permission-policy` members of a tension
  are never hidden — both render with a conflict annotation.
- **Retract** (wrongly captured): hard-delete of the event and its derived rows (salience,
  embeddings). Distinct from supersede — retraction is for memories that should never have
  existed; supersede is for memories that were true and changed.

## 6. Projection semantics (compute — rebuildable, never authoritative)

- **Context pack:** persona docs + tone + rules + corrections + risks + calibration +
  self-state + stances + callbacks, prefixed by a computed continuity line. Bounded:
  callbacks top-8 / stances top-6 by salience × recency. There are no personality modes: every
  body reads the same self. Body capability, current cause, relevance, and context budget shape
  realization without partitioning memory or personality.
- **Recall:** relevance × recency × salience. Per-stream policy: **governed** streams
  (judgment-ledger, risk-events, investment-lessons, failure-ledger) are deterministic —
  lexical × recency only, no salience multiplier, no semantic scoring, never reinforced
  (semantic+reinforcement is a deepening feature for relationship memory and a
  confirmation-bias loop for judgment memory). All other streams may use semantic
  similarity and are reinforced on recall (salience uses+1).
- **Salience:** `3 + log2(1+uses)` capped at 6; state by last-use age: fresh ≤7d ×1.3,
  warm ≤30d ×1.0, dormant ≤120d ×0.5, retired ×0.15. Decay is lazy (computed at read).
  Weighting is part of the self: archives must carry it (§8).
- **Coverage (metacognition):** computed confidence none/thin/partial/strong over
  declarative events (excluding `salience`, `relations`, `self-state` — the self's own
  impressions are not knowledge about the user). `journal` hits count as grounded.
- **Reflection:** raw (non-distilled-stream) events past the watermark, due at threshold
  (default 8). The host distills raw → higher-order events (stances / observations /
  callbacks), classifies contradictions (supersede / tension / leave), human confirms,
  then the watermark advances. **Governance anti-bloat:** > 12 active rows in any of
  persona-ledger / correction-rules / permission-policy raises a consolidation-due signal —
  rules must distill, not accumulate.

## 7. Pause

`paused: true` must be honored on every surface: context endpoints and `whoami` return a
neutral "act as a plain assistant" context instead of the persona. Memory tools remain
available for explicit lookups. Pause is the user's kill switch, not host etiquette.

## 8. Portability formats

- **Export** (`NDJSON`): one event per line; the last line is
  `{"_manifest": {"version": 1, "self", "count", "chain"}}` where
  `chain = fold(sha256(prev_hex + id))` seeded with `"throughline-chain-v1"`. Verifiable
  offline: recompute every id from content, refold the chain. The manifest attests to the
  snapshot; tamper-evidence over time = anchor chain heads externally.
- **Import**: NDJSON in; ids are recomputed (manifest lines skipped); same self = idempotent
  restore, new self name = migration.
- **Archive** (complete self): `{version, self, events, salience, chain}` — events alone are
  the truth, salience rows carry the memory weighting. The reflection watermark is
  deliberately absent (seq-based, not portable; reflection just becomes due again).

## 9. Provenance & conformance (sidecar — outside the envelope)

- **Provenance:** who wrote each event — `source` (host) and `model`, declared via
  `x-throughline-source` / `x-throughline-model`. Stored beside the envelope, never inside
  it (would change ids and break dedup). Feeds the fidelity gate and audit.
- **Conformance:** per host × model × day, counts of adoption-defining operations
  (context/whoami/bootstrap, recall, propose/confirm/journal). Two named failure modes:
  *active but never loaded the self* (adoption failing) and *read-only* (memory not
  accruing).

## 10. Versioning

This is spec v1. Additive changes (new streams, new optional fields, new sidecar columns)
do not bump the version. Breaking changes (envelope fields, id derivation, chain algorithm,
lifecycle semantics) bump to v2 and require a documented migration that preserves v1
interpretability. The golden contextPack test pins the v1 rendering; intentional rendering
changes update the golden, loudly.
