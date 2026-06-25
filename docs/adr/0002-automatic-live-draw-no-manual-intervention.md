# ADR-0002: The Auslosung is automatic, live, and lot-by-lot — no manual intervention

- Status: accepted
- Date: 2026-06-25

## Context

The site owns the draw (ADR-0001). We considered letting an operator generate a seeded draw and then
adjust positions before publishing. That was rejected: for a club championship, any human ability to
move a player after seeing the draw is indistinguishable from rigging it (Betrug). The draw also
doubles as a social event — the organizers want to run it live and project it on a big TV.

## Decision

The Auslosung runs as an automatic draw following DTB-Ranglistenturnier conventions (seed by LK,
seeds to fixed bracket positions, byes to top seeds, unseeded players drawn randomly into the open
slots). It is revealed **lot by lot** (Los für Los) in a presentation mode built for a large screen.

There is **no operator edit step** on the draw outcome. The operator can trigger the draw and pace
the reveal, but cannot change who lands where. Randomness uses a cryptographic source
(`crypto.getRandomValues`), not `Math.random`.

## Consequences

- The draw is a deterministic-given-its-randomness procedure: inputs are the confirmed participants
  and their seeding LK; output is the seeding, an ordered sequence of Lose, and the final bracket.
- We need a public presentation ("Auslosungs-Show") mode distinct from the participant list.
- Seeding correctness now matters a lot: LK must be synced and frozen before the draw (a player's LK
  can't shift mid-draw). See the seeding-freeze question.
- Fairness is a product feature, not just an implementation detail — how randomness is generated and
  whether the result is auditable are in scope, not afterthoughts.
- The admin's only draw powers are: start the draw, advance/replay the reveal, and (break-glass)
  re-run before anything is published. Editing individual placements is explicitly out.
