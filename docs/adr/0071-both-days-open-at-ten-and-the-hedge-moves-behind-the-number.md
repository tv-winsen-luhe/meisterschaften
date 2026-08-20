# ADR-0071: Both days open at 10:00, and the hedge moves behind the number

- Status: accepted
- Date: 2026-08-20
- Revises: ADR-0069 (§2 — the public floor „ab HH:MM" / „im Anschluss · nicht vor ca. HH:MM"; §4 — the
  reasoning that removed the day/court toggle), ADR-0068 (the Saturday 10:30 first start)
- Keeps: ADR-0069 §1 (the 90 minutes is a **reservation width**, an average from experience) — untouched,
  and the reason this ADR is a wording change and not a model change
- Relates to: ADR-0040 (the 30-minute cadence, per-day starts, per-court evening windows), ADR-0032 (the
  live phase records reality), ADR-0028 (English everywhere except user-facing copy)

## Context

Two organiser corrections, a day apart, and they meet in the same place — the schedule row.

**The Saturday start.** ADR-0068 set `dayStartMinutes = [10:30, 10:00]` because the grounds carry a youth
fixture on Saturday morning and the championship was assumed to start after it. That assumption was one
step too coarse: the youth fixture occupies **two courts (5 & 6) from 9:00 to 10:30**, then doubles on
court 6 — and the championship needs **four**. Courts 1–4 are free from 10:00. Waiting until 10:30 buys
nothing and costs half an hour on the day that carries the most matches.

**The published time.** ADR-0069 replaced „ca. HH:MM" per row with a floor — „ab HH:MM" for a court's first
match, „im Anschluss · nicht vor ca. HH:MM" for everything chained behind it — on the reasoning that a
chained start can only be missed in one direction, and the Grand Slams say so too. The reasoning holds. The
**sentence** does not: it puts the hedge in front of the number, so the reader meets two qualifiers („im
Anschluss", „nicht vor ca.") before reaching the one piece of information they came for. The organiser asked
for the times back. What is actually wanted is not the removal of the hedge — the hedge is true — but the
number in front of it, where it can be read.

Nothing was scheduled yet when this was decided, so the first start moves as a pure configuration change
with no placements to migrate.

## Decision

**Both event days open at 10:00, and a published time is always a clock time — hedged with „ca." exactly
where something in front of it can push it.**

1. **`dayStartMinutes` becomes `[10:00, 10:00]`.** The youth fixture's two courts are **deliberately not
   modelled** — not even as a blocked morning window. Saturday's parallel cap is already **4**
   (ADR-0068, sized to the results desk), and four is exactly how many courts the youth leave over. The
   count the desk can carry and the courts physically free coincide, so a per-court morning window would add
   a rule the cap already enforces in effect. The per-day mechanism stays expressible even though the two
   values now agree, so the days can diverge again without code change (ADR-0040).

2. **The row states a clock time, and the hedge follows it.**
   - **„HH:MM"**, plain, for a court's first match of the day and for every match that opens a fresh block
     after a **gap** in that court's reservation chain. Nothing in front of it can push it, so it carries no
     hedge — the absence of „ca." _is_ the claim.
   - **„ca. HH:MM"** for every match whose reservation directly abuts the one before it on that court.

   „ca." says what „nicht vor" said, in two characters instead of nine, and it says it **after** the number.
   A player reading down court 3 for their own match finds a time first and a caveat second.

3. **The chain arithmetic is untouched.** Abutting is still `previousSlot + SLOT_SPAN` exactly; a gap still
   breaks the chain; the chain is still built over the **whole feed** before the competition filter narrows
   the rows, so hiding one field's match cannot promote the match behind it from „ca." to a plain time; the
   projection still reads no clock. Only the two strings change. This is the payoff of ADR-0069 having
   separated the reservation width from what a surface may say about it: the correction lands entirely in
   the label.

4. **A match behind a gap gets a plain time, not a hedged one.** The match in front of it finished long
   before — a mixer block or an empty afternoon is real air — so there is nothing to hedge against. Hedging
   it anyway would water down an honest time for symmetry.

5. **The „Nach Tag" / „Nach Platz" toggle stays gone.** ADR-0069 removed it because „im Anschluss" is false
   outside a court's column; absolute times make a day-wide list _coherent_ again. Coherent is not the same
   as wanted: the court is the column a player reads down to find their own afternoon, and „what is on right
   now" is answered better by the „Jetzt auf dem Platz" board. The reason for the removal expiring is not a
   reason for the feature returning.

6. **The bracket cell says exactly what the schedule row says.** Both already read `publishedTimes`, so
   this costs nothing and a divergence would simply be a bug.

## Considered and rejected

- **A full revert to „ca. HH:MM" on every row.** The obvious reading of the request, and it throws away the
  one distinction worth keeping: which rows can be pushed and which cannot. A court's 10:00 match is not an
  estimate, and marking it as one makes every time on the page equally soft.
- **„ca. 14:00 · im Anschluss"** — number first, follow-on note behind it. Keeps strictly more information,
  and the information is not worth the second clause: „ca." already means „because something is in front of
  it", the column position already shows _what_ is in front of it, and the sentence gets long on a phone.
- **A blocked Saturday-morning window for courts 5 & 6.** The correct model of the venue, and unnecessary
  (§1). It would also encode a fixture that is not this tournament's to know about, in the file that owns
  this tournament's grid.
- **Keeping Saturday at 10:30 and letting the operator start early by hand.** Not expressible: the first
  start defines slot 0, so „earlier than the day's start" is not a placement the grid has a cell for.
- **Shifting Saturday placements by +1 slot to preserve their clock times.** Moot — nothing is scheduled —
  and the wrong instinct anyway: the point is to start earlier, not to gain an unused row at the front.

## Consequences

- Saturday gains a usable 30-minute row at the front of the day, and both days' 22 slots now run 10:00 →
  20:30 identically. The per-court evening windows still gate which of those rows each court may take.
- `TOURNAMENT_START` and the derived `startTime` copy move to 10:00. Every public sentence that promises a
  start time reads it from the grid (ADR-0068), so this is one number.
- The schedule's time column narrows: „ca. 14:00" fits on one line where the floor needed two, and the
  contestant names get the width back.
- `followsOn` survives as a fact on the row and keeps its quieter styling. With „im Anschluss" gone, „ca."
  is the only word carrying the distinction, and two characters do not survive a phone in bright sunlight —
  the dimming states it a second time. Same redundancy as the winner being stated twice. (That second statement was the `✓`; ADR-0072 deletes the glyph and has the winner own the higher scores on its own line instead — the redundancy principle here is untouched, only its illustration.)
- ADR-0069 keeps its text and gains a `Revised by` pointer (the ADR-0044 → ADR-0048 pattern). Its §1 and §3
  are still the operative decisions; only its §2 sentence and its §4 reasoning are superseded here.
- **ADR-0069's real consequence still stands:** the order within a court is load-bearing. „ca. 14:00" on the
  fourth row of a court is a claim about a queue, not just a clock, and reordering that queue is still done
  by moving placements on the grid.
