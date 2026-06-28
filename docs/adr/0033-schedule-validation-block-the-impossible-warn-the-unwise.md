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
