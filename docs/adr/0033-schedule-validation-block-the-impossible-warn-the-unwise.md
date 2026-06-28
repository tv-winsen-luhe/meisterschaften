# ADR-0033: Schedule validation — block the impossible, warn the unwise

- Status: accepted
- Date: 2026-06-28
- Refines: ADR-0005 (the operator schedules by hand; the system validates)

## Context

ADR-0005 decided the operator places matches by hand on a courts×time grid and the system validates
rather than auto-generates. It listed two **hard** rules (a match cannot precede its feeders' slots; no
slot exceeds the 6 courts) and one **soft** rule (warn on back-to-back matches). CONTEXT.md later drifted:
it added "caps each player at **2 matches per day**" as if it were hard — a third rule absent from the
ADR. Epic #9 has to pin the rule set down before building the validator, and the ambiguity is which
rules block and which only warn.

## Decision

Validation follows one principle: **block the impossible, warn the unwise.**

- **Hard (blocked):** the only states that are _physically impossible_ —
  - a match scheduled before its feeder matches' slots end (round dependency);
  - more matches in one slot than there are courts (6).
- **Soft (warn, operator may override):** everything about a **player's load**, which is human comfort,
  not physics —
  - more than **2 matches per day** for one player;
  - back-to-back matches with no rest gap.

So **2-matches-per-day is a warning, not a cap.** CONTEXT.md is corrected to match. The operator stays
the authority (consistent with ADR-0022: constraints are hints, the operator confirms), and the
validator never paints them into a corner during live disruption — rain delays, or a player who simply
wants to finish.

This rests on the confirmed invariant that each member holds exactly one active entry (CONTEXT.md), so a
player is never in two matches at once and the validator never has to resolve cross-field player clashes.

## Consequences

- A future load rule defaults to a **warning**; a rule is hard only if violating it is physically
  impossible.
- The grid's 6 court rows make the court-cap structural; feeder ordering is the one hard rule that needs
  real checking.

## Amendment (2026-06-28): the court hard rule is per-cell occupancy, checked server-side — not just a slot count

Building the validator (#89) showed the second consequence above to be wrong on one point: the grid's
structural court guarantee **does not reach the API**, and this same Decision makes the place endpoint the
authority. The admin grid only drops into empty cells, but the endpoint is reachable directly (and by a
second operator, or a stale/retried client), so the server cannot lean on the grid's structure.

A literal "more matches in one slot than the 6 courts" check is also too weak to be that authority: it
counts a slot's total and never asks whether the _specific_ court is free, so two matches can land on the
identical `court+day+slot` while the slot still holds ≤ 6 — corrupting the public schedule (two matches on
one „Platz" at one time) and silently overwriting one in the admin grid's cell-keyed index.

**Decision (amended):** the hard court rule `validatePlacement` enforces is **per-cell occupancy** — at
most one match per `court+day+slot` (`court-taken`). Because the contract bounds `court` to the six
courts, "more matches in a slot than courts" then falls out as a _consequence_ of per-cell occupancy and
is never counted separately — which is the sense in which the court cap is structural. So the corrected
statement is: **feeder ordering and court occupancy are both hard rules the validator checks server-side;
the six-court slot cap is their emergent consequence, not a third check.**

A DB unique index on `(court, day, slot)` would close the last gap — two near-simultaneous placements that
both validate against state without the other's row yet (a TOCTOU race). We deliberately leave it out:
ADR-0005 has a single desk operator placing by hand, so the race is not realistic, and the validator
covers every non-simultaneous path (move, retry, stale client, direct API). If concurrent operators ever
become real, the index — mirroring the draw's `(competition, bracket)` uniqueness — is the backstop.

## Amendment (2026-06-29): feeder-order is structural, not only pairwise — a match can't sit earlier than its real feeder chain

The Decision's feeder-order rule was implemented **pairwise**: `validatePlacement` blocks the candidate
only against feeders that are **already placed**. That leaves a gap the original Context disavows — "the
validator never paints them into a corner":

- The operator places a later-round match (a Viertelfinale) while its feeder (the Achtelfinale) is still
  in the backlog. No placed feeder exists, so the placement is allowed — into any slot, including the
  first.
- When the operator later places that feeder, the now-placed successor check fires and blocks it from
  every slot at-or-after the dependent match. If the dependent match went into an early slot, its feeder
  has **nowhere legal to go** — the operator is in the corner, and only learns at the wall.

The pairwise check keeps any _committed_ plan sound (whichever match is placed second is validated), but
it lets the operator _build toward_ an impossible one.

**Decision (amended):** feeder-order is also enforced **structurally**. A match's absolute slot
(`day · slotsPerDay + slot`) must be **≥ the depth of its longest chain of real feeder matches** — the
matches actually played, and therefore scheduled. A round-1 **bye** is never scheduled (CONTEXT: Bye), so
it contributes no slot: a later-round match fed only through byes keeps its early slots. This depends only
on the candidate and the bracket's bye pattern — not on what else is placed — so it rejects a too-early
placement the moment it is attempted, before any corner can form.

This stays "block the impossible": a match at absolute slot _s_ whose real feeder chain has depth _d > s_
cannot be completed — there are not _d_ distinct earlier slots for the chain. It is the same
physical-impossibility test the court rule uses, so it is a **facet of the existing feeder-order hard
rule, not a third rule**. The pairwise check remains, for ordering against feeders that _are_ placed;
together they make an out-of-order plan impossible to either commit or approach.

**Consequences:**

- A later-round match can no longer be dropped into a slot too early for its feeder chain, even while
  those feeders sit in the backlog — closing the corner the original Context disavowed.
- Bye-only feeder chains stay placeable in early slots; the guard counts real (scheduled) matches, so it
  never blocks a slot a bye legitimately leaves free.
- The earliest legal slot becomes a property the grid can surface proactively (grey the too-early cells
  when a match is picked up), not only a rejection at drop time.
