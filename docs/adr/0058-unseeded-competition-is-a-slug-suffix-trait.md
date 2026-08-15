# ADR-0058: „Unseeded" is a competition trait, carried by the slug suffix

- Status: accepted
- Date: 2026-08-15
- Builds on: ADR-0051 (the Social mixer — which deliberately **deferred** this modeling ADR to „when it
  is actually built"; it was built in #193 and the ADR was never written until now)
- Relates to: ADR-0043 (field cut), ADR-0034 (≥4 draw floor), ADR-0022 (derive, don't add a parallel
  flag), ADR-0028 (English identifiers)

## Context

The Social mixer (`womens-social`) is the first competition with **no strength dimension**: entries carry
no LK, nothing is seeded, and no bracket is ever drawn. That is not one relaxation in one place — it
branches five surfaces:

1. `confirm` / `canConfirmEntry` — an entry may be confirmed **without a seeding basis**
2. the field cut (`cutsByStrength`) — admission is **first-come**, not top-N by LK
3. the public participant list — no seed ranks, and the scarcity meter is replaced by momentum framing
4. the draw — refused outright (`fail('Unseeded')`)
5. the admin court-load gauge — excluded from the KO match math, because the mixer's court use is the
   separate `socialMixerReservedSlots` reservation and would otherwise be counted twice

ADR-0051 named the trait and consciously deferred its modeling ADR. The build shipped; the ADR did not.
This records it after the fact, before the trait acquires a second member and the reasoning is lost.

## Decision

**Unseededness is a property of the _competition_, not of the registration — and it is carried by the
`-social` slug suffix, read through one predicate `isUnseededCompetition` in `shared/seeding.ts`.**

Two halves, each load-bearing:

1. **Competition-level, not registration-level.** The tempting alternative is to treat a mixer entry as
   „a registration that happens to have no LK" and let the existing null-LK paths absorb it. That is
   wrong: a _championship_ entry with no LK is a **weak** player (`defaultLk` 25.0 — it seeds last, and
   `seedingValue` exists precisely to make that true). A mixer entry with no LK is **not weak, it is
   unrated by construction**. Collapsing the two would silently seed mixer players as 25.0 and let a
   bracket be drawn for a field that has none. The distinction has to live one level up, on the
   competition.

2. **Slug suffix, not an explicit field.** `isUnseededCompetition(c) = c.endsWith('-social')`, mirroring
   the existing `isChallengerField(c) = c.endsWith('-challenger')`. The alternative — a boolean on the
   `Competition` record in `src/data/tournament.ts` — reads cleaner but **fails open**: the trait must be
   known in `shared/` and in the worker, where the presentational `Competition` list is not the authority
   (`COMPETITION_SLUGS` is, ADR-0022). A slug the contract accepts but the trait table forgot would be
   drawn into a bracket it has no players for. The suffix cannot drift from the slug, because it _is_ the
   slug.

## Considered and rejected

- **A `seeded: boolean` on the `Competition` record.** More explicit and self-documenting, but the
  authority for what is registerable is `COMPETITION_SLUGS` in `shared/`, not the presentational list —
  so the flag and the contract could disagree, and the failure mode is silent (ADR-0022 exists to prevent
  exactly this class of parallel flag).
- **Per-registration „no LK required".** Conflates _unrated by construction_ with _weak_ — see Decision
  §1. It would also have to be re-decided on every surface.
- **A separate table / a `competition_types` lookup.** Far past what four fixed fields justify; the whole
  line-up is a hand-maintained literal.

## Consequences

- **The suffix is now load-bearing naming.** Renaming `womens-social` without the `-social` suffix
  silently turns the mixer into a seeded, drawable field. The same trap already exists for
  `-challenger`; this ADR makes it explicit for both. A rename is a migration, not a rename.
- **A second social field is free** — it inherits all five behaviours the moment its slug ends `-social`.
- **A non-social unseeded field would need a real refactor**, not a new suffix. If one ever appears
  (e.g. an unseeded mixed format), that is the moment to revisit the suffix convention — not before.
- **`-social` and `-challenger` are mutually exclusive by convention only**, not by construction. Nothing
  enforces it; a hypothetical `x-social-challenger` would be read as both. Not worth guarding today.
