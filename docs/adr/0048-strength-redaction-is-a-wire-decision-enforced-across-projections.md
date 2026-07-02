# ADR-0048: Strength redaction is a wire decision, enforced across projections

- Status: accepted
- Date: 2026-07-02
- Revises: ADR-0044 (Consequence 4: per-surface hand-nulling → one enforced decision the wire carries)

## Context

A protected Challenger field's strength is redacted on every public surface (ADR-0044, ADR-0024): the LK
value and the seed number are dropped, the relative-rank structure stays (ADR-0044 §2, ADR-0047). ADR-0044
Consequence 4 made that redaction **per public surface, not a single enforced seam** — two hand-written
projections (`redactChallenger`, `toConfirmedParticipant`) each nulling `lk`/`seed`, with a prose "standing
rule" that any new public projection must remember to null. It rested that call explicitly on **"only two
public surfaces"** — a shared boundary would be premature abstraction at that N (ADR-0021).

Three things have changed the premise:

1. **N is no longer two.** The public two-phase bracket (ADR-0046) added a **third** public projection that
   joins a Challenger row's strength — the live-results bracket (`redactLiveBracket`) — which had to
   re-derive the same null. The "standing rule" is a trap, and a surface already had to step around it.
2. **The `null` is overloaded.** A redacted `lk` is `null`; a not-yet-synced LK is _also_ `null` („LK
   folgt"). Nothing on the wire tells them apart, so every public consumer re-runs `isChallengerField` to
   disambiguate — the redaction rule leaks back across the seam onto the client. A consumer that trusted the
   wire would print „LK folgt" for a protected player.
3. **A fourth protected field is planned.** Damen Freizeit (`womens-challenger`) is a coming recreational
   field (CONTEXT „Competition"). Under per-surface nulling, adding it means finding every redactor and every
   client `isChallengerField` guard again.

The friction is real enough to reopen the N=2 call — not a theoretical refactor.

## Decision

**1. The public wire carries the redaction _decision_, not just its after-effect.** Each public projection
tags a protected field's output with a `redacted` flag, set server-side from `isChallengerField(competition)`
in the **same** step that nulls the strength fields — so `redacted === true` ⟺ strength nulled by policy;
they cannot drift. The flag sits at each wire's natural unit: per-row on the participant list, per-draw on the
reveal and live brackets. `lk: null` now means _pending_ unambiguously.

**2. Correctness is enforced by one cross-projection invariant test, not by prose vigilance.** A single test
walks every public projection and asserts that a protected field emits **no LK value and no seed number and
carries `redacted: true`**, and that a championship field does not — the concrete form of "assert the flag,
not the guards". This is what ADR-0044's standing rule could not do: a new projection that forgets to redact
fails the test.

**3. The client renders the flag and stops knowing which fields are protected.** `isChallengerField`
disappears from the public components (participant list, draw bracket); each render site reads `redacted`.
Adding a protected field becomes a one-line server predicate change with zero client edits.

This revises **only** ADR-0044 Consequence 4 (how redaction is structured). ADR-0044's load-bearing
decisions stand: the full un-redacted reveal is operator-only under `/api/admin/*`, and the public bracket
keeps its seeded **structure** (relative rank is not neutralized — ADR-0044 §2, ADR-0047).

## Considered Options

- **Keep per-surface hand-nulling (ADR-0044 status quo)** — rejected: the N=2 premise it rested on no longer
  holds (N=3 + a fourth field planned), the `null` overload leaks the rule onto the client, and the "standing
  rule" is a trap every new projection can trip.
- **A discriminated `PlayerDisplay` (`lk: shown | pending | redacted`)** — rejected: it de-overloads `null` at
  the type level but pays ceremony at every render site the small-N wire (ADR-0021) does not warrant; a single
  boolean captures the same invariant.
- **Force the three redactors through one shared function body** — rejected: the shapes differ for principled
  reasons (the participant wire keeps `seedRank` as placement data; the reveal/live wires null the explicit
  `seed`), so one body would be an awkward, parameterized fit. The shared thing is the _decision_ (and the
  test that guards it), not the code path.

## Consequences

- The public wire (`participantSchema`, the reveal `PublicDraw`, the live `LiveBracket`) grows a `redacted`
  boolean. `lk: null` unambiguously means _pending_; a withheld value is `redacted: true`.
- The public components no longer import `isChallengerField`; redaction is decoupled from field identity.
  Enabling Damen Freizeit (or any future protected field) is a single server-side predicate change.
- Redaction of a new public projection is still the author's job to set — but the cross-projection invariant
  test now catches an omission, where ADR-0044 relied on the author remembering the prose rule.
- Relative-rank structure (seed lines, `seedRank`) is unchanged on every public surface (ADR-0047); only the
  absolute-strength signals were ever redacted, and that is unchanged.
