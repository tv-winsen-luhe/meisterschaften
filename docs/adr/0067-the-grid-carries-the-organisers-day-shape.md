# ADR-0067: The grid carries the organiser's day shape

- Status: accepted
- Date: 2026-08-17
- Builds on: ADR-0040 (per-day first starts, per-court evening windows, interval occupancy, the
  auto-suggest), ADR-0033 (block the impossible, warn the unwise), ADR-0005 (the operator places, the
  system validates)
- Relates to: ADR-0064 (the mixer block's stored placement is a grid slot), ADR-0023 (court budget),
  ADR-0004 (the consolation bracket), ADR-0028 (English everywhere except user-facing copy)

## Context

Planning the 2026 weekend by hand — walking the real fields (twelve Herren, eight Challenger, nine in the
Social mixer) through a wave-by-wave schedule — surfaced three facts about the event that the grid could
not express, and that the auto-suggest therefore could not propose:

1. **The days do not start at 9:00.** `dayStartMinutes` has been per-day since ADR-0040, but held
   `[9:00, 9:00]` because nobody had asked otherwise. The organiser starts **Saturday at 10:30** (the
   courts carry a youth fixture that morning) and **Sunday at 10:00**. Every suggestion therefore opened
   four waves too early, and the operator would have re-placed the whole plan by hand.
2. **Court 1 is the worst court to watch from, and the auto-suggest filled it first.** The fill scanned
   `court 1..6` ascending — a numbering accident, not a preference. On the ground the ranking is 2, 3, 6
   (good), 4, 5 (acceptable), 1 (poor): a final proposed on court 1 is the showpiece on the one court
   nobody can see.
3. **Six matches at once is not a plan the day can hold.** Saturday shares the grounds with the youth
   fixture, so the championship works four courts; Sunday exists to be watched, and two matches side by
   side is as much as a spectator — or a single organising desk — can follow. Nothing expressed this, so
   the fill opened every court it legally could.

None of the three is a new capability. Each is a fact about _this_ event that the model had no place to
put, so the suggestion the operator got was legal but not the plan they wanted.

## Decision

**The grid carries the organiser's shape of a day, and the auto-suggest reads it — as configuration and
soft rules, never as new hard blocks.**

1. **Each day opens at its own first start.** `dayStartMinutes` becomes `[10:30, 10:00]`. Slot 0 is a
   different clock time on each day, which is what the per-day array was for. `slotsPerDay` drops 24 → 22,
   sized by the **earliest-starting** day's reach to the last curfew start (20:30): the grid offers every
   row some court can take and none beyond, and the later-opening day's last rows fall out of every
   court's evening window on their own rather than needing a shorter column.
2. **Courts carry a viewing order.** `COURT_VIEWING_ORDER = [2, 3, 6, 4, 5, 1]`, a venue fact beside the
   floodlights. The auto-suggest reaches courts in that order within a slot instead of by number, so the
   main bracket lands where an audience can watch. The **consolation bracket takes the order reversed** —
   it is the weekend's lowest-billing tennis, so it settles on the courts spectators are least drawn to
   and leaves the good ones for the title matches. It is a preference, not a restriction: every court
   stays legal and a full wave still fills all six. The operator's finer ruling — a **main-bracket
   third-place match outranks a consolation final**, because it is two of the field's best four — falls
   out of this split rather than needing a per-match importance order, and is pinned by a test so a future
   re-ordering of the fill cannot quietly swap them.
3. **Each day carries a parallel cap.** `MAX_PARALLEL_MATCHES = [4, 2]` — Saturday four, Sunday two —
   enforced as the **soft** `parallel-limit` rule. Soft is the whole point: this is the organiser's
   judgement about a day's shape, not a physical impossibility (the courts already make "more matches than
   courts" structurally impossible via `court-taken`), so the operator keeps the override for the day a
   placement match is worth a third court. Because the auto-suggest prefers warning-free cells, the wave
   rhythm falls out of the cap without `suggestSchedule` knowing the rule exists — the same indirection
   the mixer block already uses (ADR-0063 §2).

The peak is counted in **moments, not pairs**: at each 30-minute step the candidate occupies, count the
same-day matches still on court. Pairwise overlap would over-count — two matches can each overlap the
candidate without the three ever being on court together.

**Two modules come out of `schedule.ts`**, which sat exactly at its 300-line budget: `court-plan.ts` (how
the organiser wants the courts _used_ — the viewing order, the cap, and the rule that reads them) beside
`schedule.ts` (what the courts physically _are_), and `placement-violation.ts` (the violation vocabulary,
a contract its readers can depend on without the validator). `schedule.ts` re-exports the violation types,
so no import site moves.

## Considered and rejected

- **A hard parallel cap.** Miscategorises an organiser's judgement as a physical impossibility and takes
  away the override on exactly the day it is needed — the ADR-0033 line.
- **Sorting matches by importance so the marquee ones claim the best courts first.** The fill order is
  round-ascending because that is what keeps feeder chains placeable; reordering it to chase court quality
  would trade a correctness property for a cosmetic one. Slot ordering already does the work: a final sits
  in a later slot than its semifinals, so the best court is free again when it is placed.
- **Leaving the first start at 9:00 and teaching the auto-suggest an "earliest slot to fill".** A second
  concept for the one `dayStartMinutes` already names.
- **A cap that widens once the youth fixture is over.** The fixture is a Saturday-morning affair, so a
  time-varying cap would hand the championship six courts from midday. Rejected because it is not what the
  operator asked for: they plan the **whole** Saturday on four courts, which is also the desk's capacity,
  not only the courts'. Saturday therefore takes both the later start and the narrower cap on purpose. If
  that proves too tight on the day, the rule is soft — the operator places the fifth match and confirms
  past the warning, no code change.
- **A per-court parallel cap, or one derived from the youth fixture's courts.** The fixture is a
  reservation, not a cap — the honest model is a second reservation beside the mixer block, which
  ADR-0063 already names as its own revisit trigger. That trigger has now fired and is tracked separately;
  the flat per-day number is the smaller thing that is true today, and it does not pretend to be the
  reservation.

## Consequences

- The Social mixer's stored placement is a grid slot, so moving Sunday's first start moves the block:
  the planned 12:00 goes from slot 6 to slot 4. The column default follows, and migration `0013` shifts
  every stored placement back by its day's step count so the block keeps the **clock time** it was chosen
  as rather than silently sliding an hour later.
- Tests that pinned clock times to slot indices now derive the index from the day's own first start.
  That is the better test either way: the rules are clock bounds, and a moved start should re-aim them
  rather than break them.
- The auto-suggest now proposes something close to the hand-built plan: waves that open at the right
  hour, finals on court 2, the consolation on courts 1 and 4, and at most two matches at once on Sunday.
  It remains a greedy first-fit, not an optimiser — a plan to edit, not to accept blindly.
- **The court budget is now overstated and is deliberately left alone here.** `matchSlotsPerWeekend` is
  72 (6 courts × ~6 matches/court/day × 2 days, ADR-0023) and the admin's court-load gauge measures
  against it. With the caps and the later starts the _plannable_ ceiling is roughly 24 on Saturday
  (4 parallel × 6 waves from 10:30) plus 12 on Sunday (2 × 6 from 10:00) — about 36, half the figure the
  gauge shows. The gauge therefore reads far more headroom than the weekend has. Redefining it belongs to
  ADR-0023, whose number means „what the courts could physically run", not „what this day's shape allows";
  making the gauge read the caps is a separate decision about which of the two the operator should see.
  Tracked, not silently changed.
- The three values are event configuration, not operator state. Changing them for a future year is a code
  change and a redeploy, deliberately: the day's shape is settled long before the weekend, unlike the
  mixer block, which had to move on the day (ADR-0064).
