# ADR-0061: The Herren Challenger publishes its strength; redaction becomes a dormant, per-field seam

- Status: accepted
- Date: 2026-08-16
- Revises: ADR-0024 (the protection's public-display half), ADR-0044 (§1's motivation, §2 unchanged in
  substance), ADR-0047 (Decision 2's redaction caveat), ADR-0048 (the decision the enforced flag carries —
  the mechanism stands)

## Context

The Challenger is a **protected** field in two distinct senses, and they have always travelled together:

1. It is **capped by LK** — stronger players belong in the championship field, so the field's matches stay
   competitive for recreational and returning players (`CHALLENGER_MIN_LK`, ADR-0024/ADR-0043).
2. Its **strength is not advertised publicly** — the LK value and the seed number are dropped on every
   public wire, so the field does not broadcast how weak it is (ADR-0024, ADR-0044, enforced as a single
   wire decision by ADR-0048).

Sense 2 is now doing harm to the very people it protects. Two concrete failures, both raised from inside the
field:

- **The draw is not verifiable.** A Challenger draw is genuinely seeded by LK (ADR-0043) and the byes
  genuinely go to the seeds (§31), but the public reveal shows neither the seed numbers nor the LKs. „Nr. 1"
  is asserted, never checkable. For a draw the club runs live on a beamer and calls unriggable (ADR-0002),
  that is the wrong end to be opaque at — the championship fields, which _are_ checkable, set the standard
  the protected field silently fails.
- **A player cannot place their opponent.** The single most useful thing a recreational player reads off a
  draw is „this one is roughly my level, that one is a step up" — which requires an LK next to a name, in
  relation to their own. Redaction removes exactly that, and only for the field whose players are least
  likely to know everyone already.

The protection was also **weaker than it looked**. An LK is a public DTB rating: every player with a linked
nuLiga `player_id` is one search away on the nuLiga player lookup. Redaction never removed the information
from the world; it removed it from the one surface where it would have been useful and in context, while
leaving it in the one place where it appears bare and without it. And the field's public copy never promised
otherwise — „geschützt" says _„nur ab LK 20, Stärkere spielen im Hauptfeld"_ on every surface
(`field-explainers.ts`, `tournament.ts`); no surface has ever told a player their rating would be withheld.

What is emphatically **not** in question is sense 1, or the admission rule that grew out of it: the cap
stays, and the Challenger keeps its **first-come-first-served** cut and its registration-ordered list
(ADR-0043). Displaying strength is not admitting by it — the two axes ADR-0043 and ADR-0047 keep separating
(„the cut decides _who is in_, the seeding decides _where_") stay separate here too. A spot in the protected
field is still secure the moment it is taken; that, not silence about ratings, is the field's promise.

## Decision

**1. Seed numbers are public on the Challenger, because a draw must be checkable.** The seed number joins
the seed _rank_ that was already public (ADR-0047: which players sit on the seed lines has been a sanctioned
signal since ADR-0044 §2). This alone closes the verifiability gap: with the numbers shown, „Nr. 1 sits on
line 1, Nr. 2 on the last line, the byes went to the seeds" is a claim a spectator can check against DTB
§§30–32 rather than take on trust.

**2. LK values are public on the Challenger, because a player must be able to place an opponent.** This is
the half seed numbers cannot deliver: relative rank says who is stronger, not by how much, and never in
relation to the reader's own rating. It is deliberately stated as a separate decision — a future protected
field might want (1) without (2), and this ADR should not have to be re-read to see which half is which.

**3. Strength redaction survives as a dormant, per-field seam.** The concept, the wire flag, the two
redactors and ADR-0048's cross-projection invariant all stay; only the answer changes. The predicate moves
from `isChallengerField` (a structural rule about the field _type_) to `strengthRedacted` — an explicit list
of competitions, **empty today**. This is the point: redaction is an editorial decision about what a field's
audience should see, not a property of the field type. The Herren Challenger is protected _and_ public; a
future Damen Freizeit may want the opposite, and it becomes one list entry with zero client edits — the
extensibility ADR-0048 was built for, now used in the other direction. We deliberately do **not** decide
today what that field will want.

**4. It says so in the Reglement, and nowhere else.** The seeding row now reads „Nach Leistungsklasse — LK
und Setzung sind öffentlich einsehbar". The competition cards and the Challenger flip stay untouched: they
sell the _format_, and „we now show your LK" is at best neutral and at worst discouraging on a conversion
surface for a protected field — the original ADR-0024 concern, which this ADR narrows rather than dismisses.

**5. It takes effect for the running tournament.** The change exists to make _this_ draw verifiable, days
before it runs; deferring it to the next edition would serve nobody. No public copy promised the contrary,
so nothing is retracted — but the registered field is told before the deploy rather than discovering it,
which is an operator task (there is no player outreach channel in the app; `notify.ts` is operator-inbound
Telegram).

## Considered Options

- **Show the seed numbers only, keep the LKs redacted** — rejected: it serves verifiability (Decision 1)
  while leaving the placement motive (Decision 2) unserved, which is the half a recreational player asks
  for. Recorded as a real option because Decision 1 stands on its own if this is ever revisited.
- **Restrict the un-redacted view to the field's own players** — rejected: it needs an authentication
  concept the app does not have, for a ~8-player club field whose ratings are already public on nuLiga
  (ADR-0021).
- **Delete strength redaction entirely** — rejected: a fourth protected field is planned (CONTEXT
  „Competition"), and the machinery ADR-0048 built is ~50 lines with an enforcing test. Deleting it means
  rebuilding it, and re-scattering `isChallengerField` guards across four public projections.
- **Also make the Challenger cut LK-based, now that strength is visible** — rejected: that abolishes the
  Challenger format rather than changing what it displays (ADR-0043). Visibility and admission are separate
  axes; this ADR moves only the first.
- **Keep `isChallengerField` as the redaction predicate and simply return false for it** — rejected as
  dishonest naming: the predicate would no longer answer the question its name asks. `isChallengerField`
  still owns the _cap_ (its real job); redaction gets its own switch.

## Consequences

- `shared/redaction.ts` is the new single home for the concept: the `strengthRedacted` predicate (backed by
  an empty `STRENGTH_REDACTED_COMPETITIONS` list) plus the two pure redactors moved out of
  `worker/projections.ts`. The redactors are now unconditional — the caller pairs them with the predicate —
  so the mechanism has a test seam and stays correct while unused, instead of rotting as dead code inside a
  projection. Four call sites read the one predicate: the participant list projection, the reveal, and both
  live brackets.
- **No client edits.** Every public surface already renders the wire's `redacted` flag rather than deriving
  protection from the slug (ADR-0048 Decision 3) — the participant list, the pre-draw preview, the reveal
  and both bracket phases turn on together the moment the predicate says so. This is the concrete payoff of
  ADR-0048, and the reason this ADR is a small change rather than a sweep.
- ADR-0048's cross-projection invariant now enforces the **opposite** answer — every public projection's
  `redacted` must equal `strengthRedacted(competition)`, and its strength must agree with the flag. A
  projection that forgets to _publish_ fails exactly like one that forgot to redact. The `lk: null`
  de-overload („LK folgt" ≠ withheld) is unchanged and still tested.
- `GET /api/admin/draw/reveal` (ADR-0044 §1) is **functionally redundant today** — the public and operator
  reveals agree step for step. It stays: it is the seam a redacted field needs, and collapsing it would
  re-merge the operator and public projections that ADR-0044 split for good structural reasons (CONTEXT
  „Admin": every operator endpoint lives under `/api/admin/*`).
- **The cap becomes publicly checkable.** A confirmed entry stronger than `CHALLENGER_MIN_LK` — which the
  operator _may_ confirm, since before the seeding freeze the LK is provisional and the hint is deliberately
  soft (ADR-0024) — is now visible as such on the public list. Accepted, and mildly desirable: it pushes
  such a case to be resolved _before_ the draw, where the hard guard would otherwise block the field. The
  confirm-time hint stays a hint; nothing about the cap's binding moment changes.
- A player with **no nuLiga ID** already carries a real `lk` of `25.0` (`resolveSeedingBasis` writes
  `DEFAULT_LK` at confirm), so their line reads „LK 25.0" like any other — indistinguishable from a genuine
  25.0 rating. That is pre-existing behaviour on the championship fields, now inherited by the Challenger.
  Making the defaulted case legible („ohne LK · gesetzt wie 25") would need a new wire field; deliberately
  not done here (ADR-0021), and recorded as the open follow-up if it ever grates.
