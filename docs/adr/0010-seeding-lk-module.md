# ADR-0010: A pure seeding-LK module behind a roster port; the freeze lives with the draw

- Status: accepted
- Date: 2026-06-25

## Context

LK handling is spread across `fetchClubRoster`/`fetchAllRosters`/`fetchNuligaMap`/`parseClubRoster`/
`normalizeName`/`findRosterMatch`/`autoMatchPlayer`/`refreshLk`. The name-matching logic is duplicated
between `autoMatchPlayer` (per-signup) and `refreshLk` (bulk cron/admin), both reach straight into D1,
and rosters are re-fetched every time. LK feeds **seeding**, and the **seeding freeze**
(ADR-0006) must stop the weekly nuLiga sync from shifting an already-drawn bracket — while _before_
the draw, LKs must keep updating and the provisional seeding list must reflect them live.

## Decision

**`seedingLk` is a pure lookup behind a roster port; persistence belongs to the Store.**

- Interface: `lookup(player) → { playerId, lk } | null` — match a player (by name+club, or an existing
  player_id) against a roster and return the nuLiga identity + LK. It returns a value; it never
  touches D1.
- Port: `RosterSource` — the nuLiga adapter (HTTP + regex parse) in production, an in-memory fake in
  tests. Two adapters ⇒ a real seam. `parseClubRoster` / `normalizeName` / the matcher become
  _internal_ seams of the implementation (still unit-testable), not part of the interface.
- The name-matching logic lives exactly once, inside `seedingLk`.
- A thin orchestration composes `seedingLk.lookup(...)` with `store.setLk(...)` for the two workflows:
  `matchOnRegister(reg)` (at signup, kept at the transport edge via `ctx.waitUntil`) and `syncAll()`
  (cron/admin). Each sync run fetches each club roster **once** and reuses it across lookups — fixing
  the per-call re-fetch.

**`seedingLk` has no freeze logic.** The seeding freeze is realized by the draw, not the LK module:

- **Before the draw:** the cron keeps `registrations.lk` current; the provisional seeding list (seeding
  preview) reflects live LK and updates as it changes.
- **At the draw:** the draw (ADR-0003) reads each player's current LK and snapshots it into its
  immutable draw/seeding record. That snapshot _is_ the freeze.
- **After the draw:** the cron is pointless, so it is **phase-gated** — the `scheduled` handler runs
  `syncAll()` only while the phase (ADR-0006) is `signup`. No suppression flag; `registrations.lk`
  is simply never read back into the immutable draw.

## Consequences

- The interface is the test surface: feed `seedingLk` a fake roster and assert the match — no D1, no
  HTTP. The matcher/parser keep their own unit tests as internal seams.
- Deletion test passes: delete `seedingLk` and name-matching scatters back across the two workflows.
- `seedingLk` builds on the Store (ADR-0009) for the `setLk` side; it is the injected LK dependency
  for the Registration domain (candidate #4) and the draw's seeding step.
- Refines ADR-0006: the freeze is "the draw snapshots its seeding inputs," and the cron is gated to
  the signup phase — not a cron that "respects a freeze flag."
