# ADR-0003: The draw is computed atomically up front, then revealed Los für Los

- Status: accepted
- Date: 2026-06-25

## Context

ADR-0002 left open _when_ the randomness is rolled in a lot-by-lot live draw. Two options: roll each
Los live at reveal time, or compute the whole draw atomically and replay it. Both forbid operator
influence; they differ in robustness and auditability.

## Decision

When the operator starts the Auslosung, the server computes the entire draw in one atomic operation
(seeding → full ordered Los sequence → final bracket) using `crypto.getRandomValues`, persists it,
and only then does the Auslosungs-Show reveal it Los für Los. The reveal is pure playback; advancing
the show never re-rolls anything.

To make the draw auditable, the server may publish a commitment (a hash of the drawn result) the
moment the draw is computed, so it can be shown afterward that nothing changed during the reveal.

## Consequences

- The official bracket exists in full from the first Los; a crashed/reloaded TV resumes from a stored
  reveal position with no risk to the result.
- The audience experiences identical suspense — the reveal is still sequential and unknown to them.
- The data model stores: the seeding, the ordered Los sequence (for playback), the final bracket, and
  a reveal cursor (how many Lose have been shown).
- A break-glass "re-run draw" is only valid before the first reveal/publish; once revealed, the draw
  stands.
