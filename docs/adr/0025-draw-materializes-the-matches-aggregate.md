# ADR-0025: The draw materializes the matches aggregate; feeders are implicit

- Status: accepted
- Date: 2026-06-27
- Refines: ADR-0003 (the "final bracket" the draw stores _is_ the matches table), ADR-0004 (the
  Nebenrunde is a second bracket of the same kind)

## Context

ADR-0003 says the draw persists "the seeding, the ordered Los sequence, the final bracket, and a
reveal cursor," but left open what "the final bracket" _is_ as data. Two shapes: the draw writes a
self-contained artifact (seeding + Los sequence + bracket as a blob) that a later step materialises
into matches, or the draw writes the **matches aggregate** directly. CONTEXT already commits to "a
match exists as a bracket position from the moment of the draw … names its feeders (Sieger M3 vs
Sieger M4)" and "every advancement — byes included — is represented as a match result," which points
at the second shape. The Nebenrunde sharpens it: per ADR-0004 it is a full second draw whose bracket
is created **mid-Live** (after the Hauptrunde first round), when the Hauptrunde matches already exist
as rows and are being played.

## Decision

**The draw writes real `matches` rows; there is no separate draw blob.** The bracket the audience
sees and the Spielplan/Ergebnisse epics consume are the same rows.

- Each match row carries a **bracket discriminator** — `hauptrunde` | `nebenrunde` — alongside
  `competition`, so the two brackets per Konkurrenz live in one table. The Nebenrunde simply inserts a
  second set of rows later, into the same model (it is _not_ a separate artifact, and it gets no
  Auslosungs-Show — ADR-0004).
- **Feeders are implicit, not stored.** A match at `(round r, position p)` is fed by the matches at
  `(r−1, 2p)` and `(r−1, 2p+1)`. No `feederMatchId` columns — the tree topology yields them, exactly as
  the public preview already computes (`2*m` / `2*m+1` in `tournament-draw.astro`). An empty slot in
  **round 1 is a Freilos**; an empty slot in **round > 1 is a not-yet-decided feeder** — the round
  number disambiguates, so no separate bye flag is needed. The Freilos resolves at draw time as a match
  result (winner advances, no score).
- **This epic creates `matches` minimally** — identity, bracket, round, position, the two slot
  references, and the bye winner/outcome — i.e. only what the draw must write. The Spielplan epic adds
  `court` / planned-start columns and the Ergebnisse epic adds full set scores, each by migration. The
  table is introduced here but owned across epics.

The draw-specific data ADR-0003 names that the matches model does _not_ need — the frozen seeding
snapshot, the ordered Los sequence for playback, and the reveal cursor — live in their own draw
table(s), **per bracket**, separate from `matches`. (Their exact shape is a later decision in this
epic.)

## Consequences

- One source of truth for the bracket. No blob-to-matches reconciliation step, and no second
  representation springing into being mid-event when the Nebenrunde is drawn — it is just more rows.
- The draw is the first writer of the `matches` aggregate; Spielplan and Ergebnisse build on it. This
  follows the ADR-0011 pattern (a domain per aggregate) onto the next aggregate.
- A reader cannot see the bracket tree in foreign keys — it is encoded in `(round, position)` and must
  be read through the shared `bracketStructure(size)` helper (the one `shared/draw.ts` already TODOs),
  not re-derived per surface. That single helper is the place the topology rule is allowed to live.
