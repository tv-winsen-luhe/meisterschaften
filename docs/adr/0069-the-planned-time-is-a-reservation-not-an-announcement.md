# ADR-0069: The planned time is a reservation, not an announcement

- Status: accepted
- Date: 2026-08-19
- Refines: ADR-0040 (the 90-minute interval, the 30-minute start cadence, per-day starts, per-court
  evening windows), ADR-0005 (planned times are approximate, „ca."), ADR-0068 (the grid carries the
  organiser's day shape)
- Relates to: ADR-0041 (the publish gate is a plan gate), ADR-0032 (the live phase records reality),
  ADR-0035 (the feed degrades per slot), ADR-0028 (English everywhere except user-facing copy)

## Context

Aligning the public schedule with the Grand Slam order-of-play convention turned up a fact the model had
been asserting wrongly. All three reference tournaments (Wimbledon, Roland-Garros, Australian Open)
express time **relatively**: only the first match on a court gets a clock time („Starts at 14:00", „From
2:00am"), and everything after it reads **„Followed by"** or **„Not before 15:30"**. The obvious reading
was that they do this out of necessity — a Grand Slam match has no known length — and that we should
_not_ copy it, because our matches run a fixed 90 minutes and we therefore know more than they do.

The organiser corrected that: **the 90 minutes is an average from experience, not a fixed length, and
there are no real start times.** A match takes as long as it takes.

The docs said otherwise, in the load-bearing places:

- `CONTEXT.md` („Match"): „Default planned length: **90 minutes**." — and („Schedule"): „The match length
  is a **fixed 90 minutes**, but the **start** is set on a **30-minute** cadence."
- ADR-0040 („Decision"): „The match length stays a fixed **90 minutes**; only the **start** becomes
  granular."
- `src/data/tournament.ts`: „at the fixed 90 min per match a court turns ~6 matches in a ~9 h playing day".

So one number carried **two different roles** under one word:

1. **The width the operator plans in** — what a placement reserves on the grid, and what the validator
   reasons about (interval overlap for `court-taken`, the feeder chain, the player-overlap block, the
   evening windows). Here 90 minutes is right, and is right _because_ it is the best available estimate:
   an occupancy rule needs _some_ width, and the average of the real thing is the honest choice.
2. **What the spectator is told** — „ca. 14:00" on a schedule row. Here 90 minutes is a guess wearing the
   clothes of a clock time, and it degrades over the day: every match that overruns pushes every later
   match on that court, so the fourth row on a court is systematically wrong in one direction only.

The Grand Slams separate exactly these two. Their internal running order is not their published promise.

## Decision

**The planned time is a reservation the operator makes, never an announcement to the spectator — and the
public surface says so in the only terms that stay true: the order on the court, and a floor.**

1. **The 90 minutes keeps its planning role, unchanged and unapologetic.** `SLOT_SPAN`, interval-overlap
   occupancy, the feeder-chain block, the player-overlap block, the evening windows, the parallel limit
   and the auto-suggest are all correct as they stand (ADR-0040, ADR-0068) and are **not touched**. What
   changes is the word: it is the **reservation width**, an estimate, not the match length. Nothing in the
   validator depends on it being a promise — a planning grid needs a width, not a guarantee.

2. **Public time is a floor, never a point.** On the public schedule a row reads:
   - **„ab HH:MM"** — the first match on a court that day, and every match that opens a fresh block after
     a gap;
   - **„im Anschluss · nicht vor ca. HH:MM"** — every match whose reservation directly abuts the one
     before it on that court.

   „nicht vor ca. 14:00" is honest in both directions where „ca. 14:00" was honest in neither: the match
   can only start later, never earlier, and that is the truth about a tournament day. It also keeps the
   planning number visible, which a bare „im Anschluss" throws away — a player who drives home between
   matches needs a floor to plan against.

3. **„Im Anschluss" only where the reservations actually abut.** The operator plans **gaps** — the mixer
   block, an evening window, plain air. A blind „first match gets a time, the rest follow" rule would
   write „im Anschluss" across a four-hour hole. The rule is therefore mechanical on the grid the operator
   already built: the next match on a court continues the chain when its start equals the previous start
   plus `SLOT_SPAN`; otherwise the chain breaks and the row re-anchors with its own „ab HH:MM". This uses
   the raster information we have rather than importing the convention blind.

4. **The public schedule therefore groups Tag → Platz as a fixed hierarchy, and the day/court toggle
   goes.** „Im Anschluss" only means something inside one court's column: in a day-wide list sorted by
   time it points at the row above, which is on a different court, and the sentence becomes false. The
   court is therefore the **innermost** grouping, not an alternative to grouping by day. The „what is on
   right now" need the toggle partly served is answered better by the „Jetzt auf dem Platz" board, which
   stays and moves to the top of the page.

## Considered and rejected

- **Keep „ca. HH:MM" per row.** The status quo, and the thing the organiser's correction rules out: it
  presents an estimate as a time, and it is wrong in a predictable direction that grows through the day.
  Retaining it would also have made the „ca." prefix the only hedge on a number nobody can keep.
- **Pure „im Anschluss" (the Wimbledon form), with no floor.** Maximally honest and materially worse for
  this event. Wimbledon's audience is in the grounds all day; ours drives home and comes back for its
  match. A player with the fourth match on court 3 learns nothing from „im Anschluss" about whether to
  turn up at noon or at four.
- **Have the operator enter real start times as matches actually begin.** There is already a truthful
  live signal — the `running` status with `liveCourt` (ADR-0032) — and it is surfaced on the courts board.
  Asking the single results desk to also timestamp starts adds work on the busiest surface of the weekend
  to improve a number the spectator has already stopped reading by then.
- **Make the reservation width editable per match, so the estimate can be sharpened.** This treats the
  wrong number as the problem. A per-match width would multiply the operator's planning decisions and
  still not produce a real start time; the average is the best estimate available before the match is
  played, and after it is played the status is the truth.
- **Rewrite ADR-0040's prose.** ADRs are the record of what was decided when, not living documentation.
  ADR-0040 gets a `Revised by` pointer (the ADR-0044 → ADR-0048 pattern) and keeps its text; the
  correction lands in `CONTEXT.md`, which is the living glossary, and in the code comments.

## Consequences

- **The order within a court becomes load-bearing.** It is derived today as a by-product of slot ordering;
  once „im Anschluss" is published, the sequence _is_ the statement. Whether the operator needs to reorder
  a court's queue directly, without negotiating clock times, is a real follow-up — not a blocker, because
  moving a placement on the grid already reorders it.
- **A public affordance is removed on purpose.** The „Nach Tag" / „Nach Platz" toggle disappears. It is
  not collateral damage: decision 2 devalues it, and keeping both would leave one grouping in which the
  time copy is a lie.
- **The admin grid is untouched**, deliberately (ADR-0068 has just calibrated it against the real venue).
  This is a projection decision; the planning model was never wrong, only the word for its width.
- **The court-load gauge is unaffected.** Its number is already known to be overstated for a different
  reason (ADR-0068, „the court budget is now overstated"), and this ADR neither fixes nor worsens that.
- `CONTEXT.md` („Match", „Schedule", „Court") and the module comments in `shared/schedule.ts` and
  `src/data/tournament.ts` drop „fixed" in favour of „reservation width" / „planning estimate". The
  occurrences that describe **occupancy** („two same-court matches whose 90-minute intervals overlap")
  are correct as they stand and keep their wording.

### Settled while building it (#308)

- **The chain is a fact about the court, not about the reader.** It is built from every match on a court
  **before** the competition filter narrows the rows. Otherwise hiding one field's match would promote the
  match behind it from „im Anschluss" to „ab" — the filter would be rewriting the plan.
- **The projection reads no clock.** `now` is not a parameter of it and is never consulted: the floor falls
  out of day, slot and chain alone, and „läuft" comes from the match status (ADR-0032). This is what lets
  the whole rule be tested as a pure function, with no fake clock and no time-dependent test.
- **Abutting is `previousSlot + SLOT_SPAN` exactly, and an overlap is not a follow-on.** On a valid plan
  no closer pair exists — occupancy is interval-based and server-enforced. One can still reach the page:
  a **running** match reports its _actual_ court (ADR-0032), so moving a live match onto a busy court drops
  it into that court's chain. There the previous reservation is still covering this start, so „nicht vor
  ca. HH:MM" would state a floor already known to be broken. Such a row anchors with „ab" instead — the
  weaker, and therefore safe, claim.
