# ADR-0020: The LK is derived, never operator-entered

- Status: accepted
- Date: 2026-06-26

## Context

The registration domain (ADR-0011) modelled the **seeding basis** as "a linked nuLiga `player_id`, or
an explicit LK": the admin detail panel carried a free LK input, `resolveSeedingBasis` accepted a typed
`lk`, `canConfirm` treated a typed LK as a valid basis, and a `setLk` operation existed. So there were
three ways to obtain a seedable LK — nuLiga ID, an operator-typed number, or the no-ID default.

Reviewing the admin, the operator-typed path was judged to add risk, not value: the LK is vereinsintern
with no rating effect, nuLiga is already the single authority for it, and a hand-typed LK is a silent way
to disagree with that authority.

## Decision

The LK is **derived, never supplied by hand.** The only seeding input the operator gives is whether an
entry is **linked to a nuLiga `player_id`** or **explicitly has none** ("keine nuLiga-ID"). The LK then
follows from one rule:

> **No resolvable nuLiga rating → `defaultLk` (25.0)** — whether the cause is no linked ID, or an ID
> that nuLiga has no rating for (unrated / not yet rated). Otherwise the LK is the linked player's nuLiga
> rating, refreshed by the weekly sync during Anmeldung and snapshotted at Auslosung (ADR-0010).

Consequences for the model: the typed-LK path is removed — `resolveSeedingBasis` derives the LK from
`playerId`/`noId` only, `canConfirm` checks that the ID-or-no-ID choice has been made (not that a number
was typed), the operator `setLk` override is dropped, and the detail panel shows the LK **read-only**
with its provenance (nuLiga vs Standard) rather than as an input.

## Consequences

- One authority for the LK (nuLiga, or the documented default) — no second, hand-entered source that can
  silently diverge from it.
- The escape hatch is lost: if nuLiga is wrong or unreachable, there is no operator override. Accepted
  because the championship is vereinsintern with no LK effect, so seeding precision is low-stakes, and an
  unrated/ID-less player still seeds cleanly at the default. If this ever bites, the override returns as a
  deliberate, audited action — not the always-present free field it was.
- ADR-0011 stands and is sharpened: the seeding basis is now a binary linked/not-linked choice, and the
  LK ceases to be operator-editable state.
