# ADR-0069: The planned time is a reservation, not an announcement

- Status: accepted
- Date: 2026-08-19
- Builds on: ADR-0040 (interval occupancy on a 30-minute cadence, per-day first starts, per-court evening
  windows), ADR-0032 (the live status is the truth; the plan is never rewritten to match it), ADR-0005
  (the operator places, the system validates)
- Relates to: ADR-0068 (the grid carries the organiser's day shape), ADR-0063/ADR-0064 (the mixer block is
  a configuration reservation the operator places), ADR-0035 (an unresolved slot degrades to „offen"),
  ADR-0028 (English everywhere except user-facing copy), ADR-0008 (public pages are Astro + inline script)

## Context

A placement on the grid reserves its court for 90 minutes. The public schedule has been printing the start
of that reservation as `ca. HH:MM` — one number per row, qualified only by „ca.".

The 90 minutes is **an average from experience, not a match length**. A best-of-two-sets match with a
Match-Tie-Break third (ADR-0045) runs anywhere from about 50 minutes to well over two hours; 90 is the
figure the organiser plans a court's throughput with. Several places in the older prose call it „the fixed
match length", and that wording is wrong — the occurrences that describe court **occupancy** are correct
and keep their wording, because a reservation genuinely is a fixed 90-minute interval.

The consequence is one-sided and compounds down a court. A match cannot start before the one in front of
it finishes, so an over-run pushes everything behind it later, while an under-run does **not** pull the
next match earlier — the players are not there yet, and the organiser will not start a match ahead of its
announced time. The fourth match on a court is therefore systematically late and only ever late. Nothing
on the page said so: `ca. 14:00` reads as a clock time with a shrug attached, so a player plans to arrive
at 13:45 and waits an hour, or reads „ca." as noise in both directions and misses their match.

The reference tournaments the organiser pointed at (Wimbledon, Roland-Garros, the Australian Open) all
solve this the same way, and have for decades: a court's order of play states one real time — the first
match — and every match after it reads **„not before"** or **„followed by"**. A tennis spectator reads that
fluently. We were the only ones claiming a number we could not keep.

## Decision

**A planned time is stated as a floor, never as a point, and the floor is derived from the court's own
chain of reservations.**

1. **„ab HH:MM"** — for a court's first match of the day, and for every match that opens a new block after
   a **gap** in that court's reservation chain. Nothing is reserved to run into it, so its time holds.
2. **„im Anschluss · nicht vor ca. HH:MM"** — for every match whose reservation **abuts** the previous one
   on the same court. „Im Anschluss" is the honest sentence; the clock time stays beside it because a bare
   „im Anschluss" leaves a player with nothing to plan against — they want to know whether they can drive
   home between matches.

A gap **breaks the chain**. This is where the reference convention is deliberately not copied blindly: the
Grand Slams say „followed by" down a whole column because their order of play is a list, whereas we have
the grid. A planned hole — the mixer block (ADR-0063), an evening window, or plain air the operator left —
is real information, and a row after a hole re-anchors with its own clock time rather than describing a
four-hour wait as „im Anschluss".

**The chain is a fact about the court, not about the reader.** It is built from every match on that court
before the competition filter applies, so hiding a men's match never promotes the women's match behind it
from „im Anschluss" to „ab".

**Therefore the public schedule groups day → court, fixed, and the „Nach Tag" / „Nach Platz" toggle is
removed.** This is a consequence, not collateral damage: „im Anschluss" only means anything inside one
court's column. In a day list ordered by time the sentence points at the row above, which is on a different
court, and it is simply false. The question the toggle's day view answered — „what is on right now" — is
the „Jetzt auf dem Platz" board's question, and the board keeps it.

**The status stays the live signal (ADR-0032).** „läuft" comes from the match status, never from comparing
a planned time against the clock. So the projection that derives all of this reads **no clock at all**:
`now` is not a parameter of it and is never consulted. The published time falls out of day, slot and chain
alone. Anything that later answers „is this running?" with `Date.now()` breaks both testability and this
ADR.

**Nothing about planning changes.** The grid, the validator, the auto-suggest, the 30-minute cadence, the
90-minute occupancy interval, the publish gate and the reset are untouched. The planning rules were never
wrong — only the word the public surface used for their width.

## Considered and rejected

- **Keeping `ca. HH:MM` and explaining „ca." in a note.** The number is not approximate, it is a lower
  bound; a note asking the reader to reinterpret every row is worse than rows that read correctly.
- **A bare „im Anschluss", as the references print it.** Correct and useless: a player who cannot plan
  against it stays on the grounds all day. The floor is the whole value of having a grid.
- **Saying „im Anschluss" down a whole court column regardless of gaps.** Cheaper, and wrong about every
  planned hole — including the mixer block, which is the most visible gap of the weekend.
- **Recomputing a live estimate from the running match's elapsed time.** Needs match timestamps we do not
  store, puts a clock inside the projection, and would replace one confident number with another. ADR-0032
  already settled that the live truth is the status, not a rewritten plan.
- **Widening the reservation to 120 minutes so the number is usually right.** Costs about a quarter of the
  weekend's court capacity to buy a cosmetic property, and the fourth match would still be late.
- **Keeping the grouping toggle and only changing the wording.** The day view would carry a sentence that
  is false in it. A control the page cannot make honest is not a control worth keeping.

## Consequences

- The public schedule reads day → court, each court's column top to bottom being the order of play on that
  court — which is what a player standing on the grounds actually wants.
- A public affordance is removed on purpose. Anyone looking for „what is on right now" is served better by
  the courts board, which is first on the page and reads live truth.
- The floor rule, the chain, the gap detection, the grouping, the ordering, the labels and the degradation
  to „offen" live behind one pure projection (`shared/match-view`), which is where they are tested. The
  renderer sorts nothing and concatenates no display string.
- **The operator cannot reorder a court's queue without moving a placement**, and now it matters more:
  the order of the column is the order the page announces. Moving a placement already reorders it, so this
  is a follow-up rather than a gap — named here so it is not rediscovered as a bug.
- Anyone reading older prose that calls the 90 minutes a „fixed match length" should read it as
  „reservation width". The occurrences that describe court occupancy are correct as written.
