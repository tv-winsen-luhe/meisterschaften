# ADR-0024: The Challenger LK cap binds at the Auslosung, not at confirm

- Status: accepted
- Date: 2026-06-27

## Context

The Herren Challenger is a protected field — only LK ≥ `CHALLENGER_MIN_LK` (20), i.e. weaker players
(no rating counts as the default 25.0). An architecture review asked whether confirming a too-strong
entry into Challenger should be a hard block rather than the soft, overridable hint the admin shows
today.

It cannot be — not at confirm. The LK is **provisional during Anmeldung**: it is synced weekly and only
**snapshotted at the Auslosung** (the Setzungs-Freeze, ADR-0010), so the LK that "counts" is the one
frozen at the draw, not the value a row happens to carry mid-Anmeldung. A hard confirm-time block on a
provisional LK is wrong in both directions — it would reject a player who is LK 19 today but LK 21 at
the draw, and admit one who is LK 21 today but LK 19 at the draw. It is also frequently undecidable: a
freshly linked id has no rating until the confirm edge fetches it afterward (ADR-0020).

## Decision

The Challenger cap **binds at the Auslosung, on the frozen LK** — the single moment the LK is
authoritative. Confirming a registration during Anmeldung is a provisional act, so a too-strong entry
raises a **hint, not a block**: the operator may confirm it (the `confirmPreview` „stark fürs
Challenger-Feld" warning, overridable via the existing confirmation dialog).

If the field's composition shifts before the draw, the operator's lever is the **global
`CHALLENGER_MIN_LK` threshold**, adjusted for the whole field at the draw — never a per-player
exception. There is deliberately no legitimate per-player override (cf. ADR-0020 for the LK itself).

## Consequences

- The hard eligibility check is **draw-time work**, built with the Auslosung (which does not exist
  yet): the draw procedure validates the Challenger field against the then-current `CHALLENGER_MIN_LK`
  on the frozen LKs. Until then there is no hard enforcement — only the confirm-time hint and the
  provisorische Setzliste, which surfaces every LK for the operator to eyeball before drawing.
- `CHALLENGER_MIN_LK` becomes an operator-tunable lever at the draw (today a fixed shared constant);
  making it adjustable is part of the Auslosung work, not before.
- Records the explicit _no_ so a future architecture review does not re-suggest a hard confirm-time
  block — the soft confirm hint is deliberate, not an oversight.
