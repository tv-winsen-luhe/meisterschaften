# ADR-0040: Granular start times on a per-court grid with evening windows

- Status: accepted
- Date: 2026-06-29
- Refines: ADR-0005 (fixed 90-minute slots), ADR-0033 (court-taken cell occupancy, back-to-back rest rule)

## Context

ADR-0005 modelled the schedule as a courts×time grid of **fixed 90-minute slots**, where one `slot`
index meant two things at once: _when a match starts_ and _the unit a court is booked in_. ADR-0033's
`court-taken` rule leaned on that identity — occupancy was plain cell-equality (`court+day+slot` taken).

The organizer needs three things that identity cannot express:

1. **Granular start times.** Matches still run a fixed 90 minutes, but the operator wants to set the
   _start_ on a 30-minute cadence (9:00, 9:30, 10:00) — to stagger finishes so the single results desk
   is not slammed by six simultaneous endings, and to fit the day more tightly.
2. **Per-day starts.** Each event day carries its own first start — `slotTime` was day-independent and
   cannot say this. (The organizer has since confirmed both days open at the earliest **9:00**; the
   per-day mechanism stays so the two can diverge again without code change.)
3. **A real evening.** The hall must clear by ~20:00, **nothing** may be played after **22:00**
   (Ruhestörung / quiet hours), and only **two of the six courts are floodlit** — so the four dark
   courts must finish in daylight while the two lit ones can carry the overflow to the curfew.

## Decision

The match length stays a fixed **90 minutes**; only the **start** becomes granular, at a **30-minute**
cadence. `slot` is now a 30-minute index (a 90-minute match spans three steps), so a placement reserves
its court for the interval `[start, start+90)`.

- **Court occupancy is interval overlap, not a shared cell.** Two same-court matches conflict when their
  90-minute intervals overlap (their starts are < 90 min apart) — superseding ADR-0033's cell-equality
  `court-taken`. The validator is still the server-side authority.
- **Per-day start.** Each event day carries its own first start — so `slotTime` becomes day-aware. Both
  days currently open at the earliest **9:00** (organizer-confirmed); the per-day start stays expressible
  for when they diverge. The day _labels_ stay in `src/data/tournament.ts`.
- **Per-court evening windows (hard upper bounds).** Courts 1–4 must **finish by 20:00** (last start
  18:30, comfortably before the ~20:25 late-August sunset). Courts **5 & 6 are floodlit** and may run to
  the **22:00 curfew** (last start 20:30). The grid is therefore lopsided — two courts have more rows —
  and the floodlit pair is the overflow valve for a packed Saturday.
- **A player in two time-overlapping matches is now a _hard_ block.** Granularity makes "on two courts
  at once" physically expressible for the first time; it is impossible, so it blocks (it bites when a
  main-bracket round-1 loser drops into the consolation bracket the same day). The old soft "back-to-back
  / adjacent slot" rule is replaced by a **rest gap**: `nextStart − previousEnd` under **60 minutes** is a
  **soft** warning. `>2 matches per day` stays **soft** (ADR-0033 unchanged on that).
- **Sunday is Finaltag — a soft preference, not a hard rule.** The auto-suggest packs Saturday through
  the **quarterfinals** (plus the consolation bracket) and reserves **semifinals → finals → third-place**
  for Sunday; placing a semifinal/final on Saturday raises a soft, overridable warning. It is never a
  hard block — you _could_ play a final on Saturday, it is just not the plan.

## Consequences

- `SCHEDULE` gains 30-minute slot steps, per-day start times, a `floodlit` court set (5, 6), and per-court
  last-start bounds; `slotTime` takes the day. The `matches.slot` column's meaning narrows to a 30-minute
  index (a migration concern if any rows already carry the old 90-minute index).
- `court-taken` and the rest rule in `validatePlacement` are rewritten for intervals; the new player-overlap
  hard rule and the Finaltag soft warning are added. The structural feeder-order guard (ADR-0033 amendment)
  carries over unchanged — it already reasons in absolute slots.
- The DB unique index ADR-0033 left as a future backstop on `(court, day, slot)` would no longer suffice
  on its own (it catches identical starts, not overlapping different ones); interval overlap stays a
  validator concern, consistent with the single-desk-operator assumption.
