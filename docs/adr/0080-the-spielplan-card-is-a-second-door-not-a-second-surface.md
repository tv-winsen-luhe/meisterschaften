# ADR-0080: The Spielplan card is a second door into the result drawer, not a second results surface

- Status: accepted
- Date: 2026-08-22
- Relates to: ADR-0038 (the schedule grid drags, with a tap fallback), ADR-0077 (the operator reads the plan —
  Ergebnisse gains the court reading and the planned time), ADR-0075 (the public match row becomes a card
  without becoming a destination), ADR-0079 (the live court is tracked; the status is a control), ADR-0016
  (shadcn for admin CRUD surfaces), ADR-0019 (the admin shell with surface navigation)

## Context

„Es wäre einfacher die Ergebnisse einzutragen bei Klick auf das jeweilige Spiel im Adminbereich Spielplan
statt eines eigenständigen Bereichs."

The desk currently works two admin surfaces over a weekend. **Spielplan** is the courts × time grid: event-wide,
all six courts and both days visible at once, cards dragged from a backlog onto cells. **Ergebnisse** is the
list: per-competition behind field tabs, grouped by round or by court, with the result drawer hanging off each
row. The organiser's instinct is that during the event the grid is the surface they are looking at — it is the
only place that shows the whole day — and having to change surface to type „6:3 6:4" is friction at the exact
moment there is a queue at the desk.

Two things make this less obvious than it sounds. **ADR-0038** made a tap on a card the fallback for picking it
up, because dnd-kit's drag needs a movement threshold and the desk runs on a tablet where a drag is not always
reliable — so the card's tap is already spoken for. And **ADR-0077**, one day earlier, moved the plan's court
and time _onto Ergebnisse_ so the operator could read the plan there; converging the two surfaces the other way
one day later would be a reversal, and it is worth being explicit about why it is not one.

## Decision

**The grid card gains a second door into the existing drawer. Both surfaces stay, and neither absorbs the
other.** Four rules.

1. **A placed card carries a small „Ergebnis" hit-target that opens the result drawer** — the same component
   Ergebnisse opens, with the same props, on the same match. Not a second entry form, not an inline score
   field on the card: **one drawer, two doors.** The result-entry grammar exists once, and every rule it
   enforces (ADR-0045's legal scores, the Zwischenstand path, the advancement cascade) is enforced identically
   whichever door was used.

2. **The card's tap still picks the card up.** ADR-0038's fallback is not spent on this. The reason it exists —
   a tablet, a drag threshold, a card that must be movable without a reliable drag — has not expired, and
   trading the _only_ placement gesture on a touch device for a shortcut to a form is the wrong side of that
   trade. The hit-target is a distinct element in the card's chrome, alongside the existing un-place „X" and
   the divergent-court reading from ADR-0079 rule 3.

3. **The card also carries the status control**, not only the result shortcut. This is what actually makes the
   grid usable as the weekend surface: during a suspension, or on an ordinary busy afternoon, the operator's
   question is „what is running where", and the grid is the only surface that answers it in one screen. A
   result shortcut without the status control would let them finish matches from the grid but not start them,
   which is the wrong half.

4. **Ergebnisse stays, and stays the surface it became yesterday.** The grid answers „what is where"; the list
   answers „what has happened in this round, in reading order", and it is the only surface with the bracket's
   own ordering. ADR-0077's court reading is not made redundant by a grid gaining buttons — a grid cell is
   sized by a 90-minute reservation, not by content, and a round's twelve matches read as a list far better
   than as twelve boxes scattered across two days.

## Considered and rejected

- **Let the whole card's tap open the drawer, and make placement drag-only.** What the ask literally describes,
  and it costs ADR-0038's tap fallback on the one device the desk actually uses. See rule 2.
- **Spielplan absorbs Ergebnisse.** The grid becomes _the_ weekend surface and the list goes away. It reads
  well until a round straddles two days and six courts, at which point „which quarter-finals are still out?"
  becomes a visual search across a two-dimensional canvas — the question the list answers by construction.
- **Ergebnisse absorbs the grid**, as a third grouping beside „Runde" and „Platz". The natural-looking next
  step after ADR-0077, and it fails on the same rule 5 that ADR-0077 already recorded: the grid is event-wide
  and Ergebnisse is per-competition behind field tabs. A grid reading would have to hide the tabs the way the
  court reading does, and it would then be the Spielplan surface living inside another surface's shell.
- **An inline score field on the grid card.** Two grammars for typing the same two numbers — rejected for the
  same reason the Zwischenstand rejected it (ADR-0032 Amendment 1), and worse here, because a grid cell has no
  room for the outcome pickers a result also needs.
- **A shared „match actions" popover invoked from both surfaces**, replacing the drawer on Ergebnisse too. A
  refactor of the surface that works, to serve the surface that does not have the feature yet.

## Consequences

- **The result drawer gains a second caller and therefore a real interface.** It currently takes a
  `ResultMatch` shaped by `results-grouping`, which the grid does not build. Either the grid builds one or the
  drawer's prop narrows to what it actually needs — a decision for the implementation, but it is the moment
  the drawer stops being a private part of `results-surface.tsx`.
- **The placed cell's chrome now holds three affordances** — un-place, result, status — inside a cell whose
  width is one court column on a grid that already scrolls horizontally on a phone. This is the tightest
  layout constraint in the admin, and if one of the three has to go, it is the un-place „X" (a match that must
  leave the grid can be dragged back to the backlog).
- **Two surfaces can now write the same match at the same time.** They already could, via two browser tabs;
  this makes it ordinary rather than theoretical, and neither surface holds a lock. The mitigation is the one
  already in place — a single operator, and every write being a full statement rather than a delta.
- **The grid is now a live surface, not only a planning one.** Taken together with ADR-0079 rule 3, the
  Spielplan surface reads the actual court, the status and the result. What it still refuses to be is the
  _lever_ for the actual court, which is the boundary that keeps the geometry meaning „reservation".
