# ADR-0067: Equal LK is undecided until the lot — for the seeding and for the cut

- Status: accepted
- Date: 2026-08-17
- Amends: ADR-0065 (one LK order for every field — confirmed; only its `createdAt` tie-break is replaced,
  and its "considered and rejected" entry on the lot is reversed)
- Relates to: ADR-0003 (the draw record snapshots the frozen state), ADR-0020 (the LK is derived, never
  operator-entered), ADR-0024 (the cap binds at the draw), ADR-0047 (seed rank is LK-derived, never read
  off a row's position), ADR-0058 (unseededness is a slug-suffix trait), ADR-0066 (the public participant
  list is a seeding board)

## Context

Two players in the Herren field sat at nuLiga LK 10,5. The list put one ahead of the other, and their
`LK-Begleitwert` — the background value nuLiga keeps with three decimals — ordered them the other way
round. The reported symptom was "the database has the wrong LK".

It does not. The nuLiga club ranking page we scrape (`clubRankinglistLK`) publishes **one** decimal; both
rows read literally `LK10,5`, and `parseClubRoster` stores exactly what the page says. What decided the
order was `bySeedingLk`'s tie-break, `createdAt` — registration time. The page's own row order does not
help either: it is LK, then alphabetical, not the fine value.

The three-decimal value is the **LK-Begleitwert**. tennis.de describes it as a value maintained _in the
background_, onto which LK improvements and the motivation bonus are booked; the publicly displayed
LK — one decimal — is the one that is "maßgeblich für Turniermeldungen und Mannschaftsaufstellung". It is
reachable only from the tennis.de/mybigpoint player profile, not from the roster page we sync.

And the DTB Turnierordnung 2026 (Stand 09.11.2025) settles the question directly. § 26 Ziffer 1, on
Feststellung der Spielstärke:

> „Nachfolgend gilt das LK-System. **Bei gleicher LK mehrerer Spieler wird die Reihenfolge gelost.**"

§ 30 Ziffer 2 derives the seeding order from § 26. § 25 Ziffer 1 defines Direktannahmen — who is admitted
— as "nach ihrer Spielstärke", i.e. § 26 again. So on equal LK the order is not decided by a finer number
and not by registration time: it is **not decided at all** until a lot decides it, and that holds for the
seeding _and_ for admission.

The real defect was therefore not a wrong rating. It was that three surfaces — the public seeding board,
the operator Setzliste, the cut — presented a settled order where the rules have none.

ADR-0065 saw this coming. It listed "a lot as the tie-break instead of `createdAt`" under _considered and
rejected_, with two objections: the lot must be persisted, and without persistence the list reorders on
every read. Both were correct and both are now answered — by a stable display order that is not a ranking,
and by a draw record that already snapshots resolved state.

## Decision

**On equal LK the order is undecided, and the lot decides it — for the seeding order and for the field
cut alike.** `createdAt` is removed as an ordering criterion.

1. **The publicly displayed LK is the only strength key.** The LK-Begleitwert is not read, not synced and
   not used as a tie-break. It is nuLiga's internal arithmetic, not a tournament criterion (§ 26), and
   adopting it would mean a second sync path against a JS-rendered, login-gated profile page for a number
   no player recognises as "their LK".
2. **Equal LK forms a lot group** (de: Losgruppe) — the term the seeding preview already uses for the
   §30.5b seed pairings, now carrying its general meaning: a set of entries whose relative order the lot
   owns. Its internal order is not a rank.
3. **The lot binds admission, not just placement.** When a lot group straddles the cut line, the lot
   decides who is in the field and who is a reserve. When it straddles the seed line, the lot decides who
   is seeded.
4. **Within a lot group, rows display alphabetically by last name.** Stable across reads, reproducible,
   and — unlike `createdAt` — it does not look like a ranking, which is what made the original defect
   invisible. `createdAt` remains a data field; it stops being an ordering statement.
5. **The lot is drawn at the seeding freeze and persisted as the resolved order** in the draw record's
   existing `seeding` snapshot. Not as an RNG seed: a seed makes a finished tournament's result depend on
   the call order inside `drawBracket` staying untouched forever, and ADR-0003 already records frozen
   state rather than a recipe for recomputing it.
6. **It is drawn silently, and reported openly.** It is not a reveal step: it falls before any position
   exists, and whoever loses a cut lot has no line to be revealed on. Instead the participant list states
   afterwards that the order was drawn. A lot that decides participation may be undramatic, but it may not
   be invisible.
7. **A line that runs through a lot group is shown as unsharp.** The group is rendered whole, above the
   line, with how many places or seedings it is contested for — never split so that one member appears
   settled above it and another settled below.
8. **The Social mixer is cut by registration order, as its own stated rule.** It is unrated by
   construction, so every entry weighs `defaultLk` 25,0 and would, under this ADR, become one field-wide
   lot. First-come is the promise a Freizeit format actually makes, the DTB Turnierordnung does not govern
   it (no LK effect, no seeding, no draw), and ADR-0065 already recorded that it was "only nominally
   LK-cut, in effect registration order" — this states it instead of letting it fall out of a comparison
   against a field that has no LKs.
9. **The `defaultLk` sentinel is an ordinary LK.** Two entries explicitly marked „keine nuLiga-ID" both
   weigh 25,0 and form a lot group like any other. The operator's explicit click makes it a decision, not
   a gap — and `lk: null` is unaffected, since the ADR-0065 draw blocker already refuses that field.

## Considered and rejected

- **Adopt the LK-Begleitwert as the key, or as the tie-break under the LK.** It would have resolved this
  exact pair with no lot at all. Rejected on all three axes: it is not a § 26 criterion, it is not on the
  page we sync (a second, login-gated source with its own outage mode), and it is a hidden second strength
  measure — precisely what § 26 replaces with the lot.
- **Keep `createdAt`, and document that it is not a strength claim.** ADR-0065's position, and the cheapest
  option. Rejected: the documentation was already there and did not stop the surface from being read as a
  ranking — because the surface _is_ a ranking everywhere else. It also gets least defensible exactly where
  it matters most, at the cut, where "you registered later" silently becomes "you are out".
- **Let the lot order the seeding but leave the cut on registration time.** The soft version, and it keeps
  admission feeling earned. Rejected: it re-forks the one comparator ADR-0065 unified, and § 25 Ziffer 1
  routes admission through § 26 anyway — the tie-break would be wrong in the one place it decides most.
- **Persist an RNG seed instead of the resolved order.** Compact and reproducible on paper. Rejected: see
  §5 — reproducibility that depends on code not changing is not reproducibility.
- **Make the cut lot a reveal step in the show.** Tempting for transparency, and lots are the show's whole
  point. Rejected: the show reveals placements, and the cut lot precedes every placement. Its loser has no
  position; revealing them would mean staging an absence.
- **Randomise the within-group display order per read.** The most honest rendering of "undecided".
  Rejected: it reorders on every reload, makes screenshots and shared links inconsistent, and is exactly
  the objection ADR-0065 raised.

## Consequences

- **The public seeding board shows less certainty than it did yesterday, and correctly so.** Players who
  saw a definite position will see a shared „5/6 · wird gelost" label instead. The board keeps its existing
  visual language for this — ADR-0066's „Platzierung wird bei der Auslosung gelost" divider and the
  preview's „3/4 · wird gelost" group are the same idea, now applied one level earlier.
- **A spot can now be lost to a lot.** A player admitted in the provisional cut can end up a reserve on a
  drawn tie. ADR-0065 already removed the guarantee ("a spot is not secure once taken"); this makes the
  remaining uncertainty explicit rather than resolving it by an unrelated criterion.
- **Equal LKs are common at this scale (ADR-0021), so lot groups will be the normal case**, not an edge
  case — a 16-field of club players clusters heavily. The rendering must therefore be a first-class state,
  not an exception path.
- **ADR-0065 stands.** One order still governs the seeding, the cut, the reserve order, the Setzliste and
  the public list, on every field. Only what happens _inside_ an equal-LK run changes.
- **The draw becomes non-deterministic one step earlier.** `drawBracket`'s non-decreasing-order check is
  unaffected — a lot group is equal, not out of order — but the field handed to it is now itself a drawn
  outcome, so tests that fixed the cut by registration time must fix the lot instead.
- Timing: accepted and implemented **before** the 22./23.08.2026 draw. After the freeze the draw record is
  final (ADR-0026) and the decision would have been unreachable for this event.
