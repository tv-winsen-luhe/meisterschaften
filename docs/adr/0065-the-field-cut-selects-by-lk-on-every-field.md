# ADR-0065: The field cut selects by LK on every field; registration order is only a tie-break

- Status: accepted
- Date: 2026-08-17
- Supersedes: ADR-0043 (the field-type split: championship by LK, Challenger/mixer by registration order)
- Relates to: ADR-0024 (the cap binds at the draw), ADR-0047 (seed rank is LK-derived everywhere —
  confirmed, not changed), ADR-0058 (unseededness is a slug-suffix trait), ADR-0061 (the Challenger
  publishes its strength), ADR-0020 (the LK is derived, never operator-entered)

## Context

ADR-0043 gave each field type its own admission rule: a championship field takes the top-N by LK, a
Challenger or Social field the first N by `createdAt`, because "strength must not decide a protected
field". That split cost more than one comparator. It forked `compareForCut`, needed `cutsByStrength` to
own the fork, needed a second `provisional` flag to say whether the resulting cut drifts, and forked the
public list order (`byListOrder`) away from the draw order (`bySeedingThenTime`) — two comparators over
the same rows, differing only by field type. It also produced the defect ADR-0047 had to fix: because a
Challenger list was ordered by registration while its seeds came from LK, two surfaces inferred a seed
from row position and put the wrong players on the seed lines. ADR-0047 fixed the surfaces but kept the
two axes, so the operator Setzliste still shows badges out of numeric order by design — Nr. 1 may sit at
the bottom — which reads as a bug every time someone new looks at it.

The operator's instruction was that there is no admission logic by registration date any more.

## Decision

**One comparator, `bySeedingLk`, orders every field: `seedingValue` ascending (strongest first), with
`createdAt` breaking ties among equal LKs.** It governs the seeding, the field cut, the reserve order,
the operator Setzliste and the public participant list, for all four competitions.

Three consequences of that single rule, each deliberate:

1. **The Challenger cut is by strength, ascending, like a championship field.** A protected field is no
   longer protected in _admission_: when it is oversubscribed the strongest admitted entries take the
   field and the weakest become reserves. What still protects it is the **cap** — `CHALLENGER_MIN_LK`,
   `isTooStrongForChallenger`, `challengerEligibility`, binding hard at the draw (ADR-0024) — which this
   ADR does not touch. Admission by strength _within_ the cap is the accepted price.
2. **`createdAt` survives only as a tie-break.** Equal LKs are common at this scale (ADR-0021), and
   `drawBracket` verifies a non-decreasing seeding order and throws otherwise, so the order must be
   deterministic. As a tie-break `createdAt` decides nothing about strength; it is a stable anchor that
   keeps the list from reordering between reads.
3. **Every cut is now provisional.** With LK as the key, every field's cut drifts until the seeding
   freeze, so the `provisional` flag is constantly `true` and is deleted. The Challenger Setzliste loses
   its „fix" label: a spot there is no longer secure once taken.

**A field is not drawable while an entry in it has an unresolved LK.** Confirmation requires a _seeding
basis_, not an LK (`canConfirm`), so a confirmed row can carry `lk: null` — the linked-nuLiga-id path
leaves it null, and `resolveLkOnConfirm` is best-effort: no rating, no id, or a nuLiga outage all return
null and write nothing. Under ADR-0043 that was harmless for a Challenger field, which cut by time. Under
this ADR `seedingValue(null)` ⇒ 25.0 becomes **admission-deciding**, so an unsynced entry — or one caught
by a nuLiga outage — would be silently cut as the weakest. A new draw blocker closes that: the
provisional cut still uses 25.0, but the draw refuses a seeded field holding an unresolved LK, and the
operator must resolve it first (nuLiga match, or explicitly „keine nuLiga-ID" ⇒ 25.0). It hangs off the
seam that already exists — the cut is provisional and binds at the freeze — beside the Challenger cap
guard. The Social mixer is exempt: it is unseeded and never drawn (ADR-0058).

## Considered and rejected

- **Sort the operator Setzliste by LK but keep the cut by registration order.** The first thing tried,
  and the narrowest fix for the out-of-order badges. Rejected: it decouples row order from the cut, so the
  cut line stops being a line — a late reserve with a strong LK sits among field players, and reserves
  scatter through the list. Recovering legibility needs field/reserve sections or per-row badges, i.e.
  _more_ mechanism for a display-only gain, while every comparator stays forked.
- **Cut the Challenger descending (weakest first).** Genuine LK logic with no registration date, and it
  preserves ADR-0043's intent: the field belongs to the weaker players. Rejected for the single
  comparator — this was the explicit trade, simplicity over the protection.
- **Exempt the Social mixer from the LK cut.** Rejected: it would keep the field-type fork alive for one
  field. The mixer's entries are unrated by construction, so `seedingValue` returns 25.0 for nearly all of
  them and the tie-break governs — in effect registration order, as before. The mixer is therefore only
  nominally LK-cut. Note this does **not** re-seed it: `isUnseededCompetition` still refuses its draw and
  suppresses its seed ranks, so ADR-0058 §1 (unrated by construction ≠ weak) still holds where it matters.
- **Hold an unresolved-LK entry's place until its LK lands.** Rejected: new state, against the point of
  this change. The draw blocker gets the same guarantee at the freeze, which is where the cut binds anyway.
- **A lot as the tie-break instead of `createdAt`.** The fair answer to genuine equality, and the lot is
  already a domain concept. Rejected: it must be persisted or the list reorders on every read — new
  state, again the opposite of the simplification.

## Consequences

- **The public participant list becomes a visible strength ranking**, the Challenger's included (its LK is
  public since ADR-0061). A player who registered early with a weak LK now sees themselves low on the list
  and, in an oversubscribed field, below the cut. The list no longer evidences first-come admission,
  because that is no longer the rule.
- **The Setzliste's badges now read in numeric order** on every field, Nr. 1 at the top. The behaviour
  ADR-0047 §3 documented as "a deliberate, honest signal that seeding ≠ registration order" disappears —
  not because it was wrong, but because the two orders are now the same order.
- **ADR-0047 is confirmed, not superseded.** Seed rank stays LK-derived via the shared helper on every
  surface; its amendment (seeds preview the _confirmed_ field, the cut runs on the _active_ one) is
  untouched. What changes is only that the cut order it was carefully distinguished from now coincides
  with it.
- **A nuLiga outage before the draw is now blocking rather than silent.** That is the intent: an
  admission decision may rest on a stated LK, never on a missing one.
- Deleted: `cutsByStrength`, `compareForCut`, `byListOrder`, `FieldCutResult.provisional`.
