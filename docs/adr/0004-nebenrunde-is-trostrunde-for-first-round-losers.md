# ADR-0004: Nebenrunde is a Trostrunde for first-round losers, not a full consolation

- Status: accepted
- Date: 2026-06-25

## Context

The format is "K.O. mit Nebenrunde." "Nebenrunde" could mean a consolation only for first-round
losers, a full consolation that every main-draw loser feeds into, or a split plate. The goal behind
having any Nebenrunde is that nobody travels in, loses one match, and goes home. The hard constraint
is the schedule: 6 courts, one weekend, best-of-2-sets-plus-Match-Tie-Break matches.

## Decision

The Nebenrunde is a Trostrunde: only first-round losers enter it (and, in a non-full draw, players
who took a Freilos in round 1 and then lost in round 2 — they are folded in with the round-1 losers).
Losers from round 2 onward of the Hauptrunde are out. The Nebenrunde is itself a single KO.

The Nebenrunde is a full DTB draw in its own right — its entrants are seeded by LK and it carries its
own Freilose, drawn randomly via the same draw procedure as the Hauptrunde (ADR-0002/0003). The
difference is purely presentational: the Nebenrunde draw is **not** revealed Los für Los. It is
computed after the Hauptrunde first round and published directly, with no Auslosungs-Show.

## Consequences

- Every entrant is guaranteed at least two matches without doubling the total match count.
- The schedule stays achievable on 6 courts over the weekend — a full consolation (option B) was
  rejected precisely because it cannot reliably finish in one weekend alongside the Hauptrunde.
- The data model needs a second KO bracket per Konkurrenz whose entrants (the first-round losers plus
  the byes-then-round-2-loser fold-in) are seeded and drawn — not deterministically mapped.
- The draw procedure is a reusable module: input a set of players with seeding LK, output a seeded
  DTB bracket with Freilose. The Hauptrunde calls it once up front (with a live reveal); the
  Nebenrunde calls it after round 1 (published directly, no reveal).
- The Nebenrunde bracket can only be drawn once the Hauptrunde first round (and the relevant round-2
  bye matches) are decided — it is not part of the initial Auslosung.
