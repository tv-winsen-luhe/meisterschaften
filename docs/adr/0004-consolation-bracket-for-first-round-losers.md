# ADR-0004: The consolation bracket is a reduced consolation for first-round losers

- Status: accepted
- Date: 2026-06-25

## Context

The format is "KO with consolation bracket." "Consolation bracket" could mean a consolation only for
first-round losers, a full consolation that every main-bracket loser feeds into, or a split plate. The
goal behind having any consolation bracket is that nobody travels in, loses one match, and goes home.
The hard constraint is the schedule: 6 courts, one weekend, best-of-2-sets-plus-Match-Tie-Break
matches.

## Decision

The consolation bracket is a reduced consolation: only first-round losers enter it (and, in a non-full
draw, players who took a bye in round 1 and then lost in round 2 — they are folded in with the round-1
losers). Losers from round 2 onward of the main bracket are out. The consolation bracket is itself a
single KO.

The consolation bracket is a full DTB draw in its own right — its entrants are seeded by LK and it
carries its own byes, drawn randomly via the same draw procedure as the main bracket (ADR-0002/0003).
The difference is purely presentational: the consolation bracket draw is **not** revealed lot step by
lot step. It is computed after the main bracket first round and published directly, with no draw
reveal show.

## Consequences

- Every entrant is guaranteed at least two matches without doubling the total match count.
- The schedule stays achievable on 6 courts over the weekend — a full consolation (option B) was
  rejected precisely because it cannot reliably finish in one weekend alongside the main bracket.
- The data model needs a second KO bracket per competition whose entrants (the first-round losers plus
  the byes-then-round-2-loser fold-in) are seeded and drawn — not deterministically mapped.
- The draw procedure is a reusable module: input a set of players with seeding LK, output a seeded
  DTB bracket with byes. The main bracket calls it once up front (with a live reveal); the
  consolation bracket calls it after round 1 (published directly, no reveal).
- The consolation bracket can only be drawn once the main bracket first round (and the relevant
  round-2 bye matches) are decided — it is not part of the initial draw.
