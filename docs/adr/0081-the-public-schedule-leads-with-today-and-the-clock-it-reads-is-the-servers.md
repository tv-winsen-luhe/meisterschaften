# ADR-0081: The public schedule leads with today, and the clock it reads is the server's

- Status: accepted
- Date: 2026-08-22
- Builds on: ADR-0005 (the schedule grid), ADR-0032 (the live phase records reality; the plan is not
  rewritten), ADR-0071 (both days open at 10:00; the day/court toggle stays gone)
- Relates to: ADR-0077 (the operator reads the plan, the public reads the announcement), ADR-0069 (the
  planned time is a reservation, not an announcement), ADR-0078 (a suspension is reality, not a message —
  and the day heading stands down while the band is up), ADR-0073 (the mixer block names its courts in
  public), ADR-0028 (English everywhere except user-facing copy)

## Context

`/spielplan` groups the weekend **day → court** and has always emitted the days in wire order: Samstag
22.08., then Sonntag 23.08. On Saturday that is exactly right. On Sunday it means the reader standing on
the grounds opens the page and meets **yesterday** — a full day of finished matches across six courts —
and has to scroll past all of it to reach the day they are actually in. The organiser's request was one
sentence: der aktuelle Tag sollte immer als erstes angezeigt werden.

The sentence is small; the thing underneath it is not. **This page has never known what time it is.** The
Live board's presence rule says so in the source (`shared/match-view.ts`): „the rule reads the running
status alone and admits no clock". Times on rows are a plan, hedged with „ca.", never rewritten against a
clock (ADR-0032, ADR-0069). Everything the page asserts is either operator-set state or arithmetic on the
grid. „Which day is it" is the first question it cannot answer that way — a calendar date is not a
placement, not a status, and not a switch.

There is one honest counter-example, and it belongs in the record: the suspension band already compares
`resumesAt` against `Date.now()` in the browser (`spielplan.astro`). So the device clock is not virgin
territory here. The difference is the blast radius. A skewed device clock makes the resume countdown
wrong by minutes and the next poll corrects it; the same skew makes the **day identity** wrong by an
entire section, and nothing ever corrects it — the reader simply sees a different page from everyone else
standing next to them, with a heading that says „heute" over the wrong day.

## Decision

**On an event day the public schedule orders that day's section first; the day it calls „heute" is
decided by the server's clock, and by nothing else.**

1. **Reorder, do not navigate and do not hide.** The current day's section comes **first**; the other day
   follows it, complete and open. No auto-scroll, no anchor jump, no collapsing of the finished day — the
   only thing that changes is the order of two sections. Saturday's results stay fully readable on Sunday,
   which they must: the consolation bracket is fed from them.

2. **The order is decided in `scheduleView()`.** `days` comes back already in reading order. The board's
   DOM layer sorts nothing and joins no string (`schedule-board.render.ts` says as much about itself) —
   an order is a decision, and decisions live behind the view.

3. **`shared/` stays calendar-free.** `scheduleView` receives a finished fact — the current day index or
   `null` — the same way it already receives `socialMixer` and `suspended`. The date arithmetic lives in
   `src/data/tournament.ts`, which owns the event's dates (`TOURNAMENT_START`), as a helper that maps a
   server timestamp to `0 | 1 | null`.

4. **`DayCopy` stays copy.** It carries „Samstag" and „22.08." because those are words on a page. A
   machine-readable ISO date is data, and putting one in the copy object to save passing a parameter
   would blur the one line ADR-0028 draws.

5. **The server's time rides on `/api/schedule`.** The response grows a `now`. It goes on the wire that
   carries the days, not on `/api/phase` — that endpoint is the operator's switchboard (phase, cancelled
   fields, mixer, suspension), and the wall clock is nobody's switch.

6. **Fail-open to chronological.** A missing, unparseable or absent `now` yields no current day, and no
   current day yields the plain Samstag → Sonntag order. The page degrades to exactly what it has always
   done, which is the failure mode with no wrong claim in it.

7. **Turnover is calendar midnight, Europe/Berlin.** Not „when Saturday has finished playing", not a fixed
   evening hour. The heading says „heute", and „heute" has one meaning; buying three hours of anticipation
   by making that word false would cost a second word („morgen") and a second state.

8. **The leading day's heading names itself: „Sonntag · 23.08. · heute".** Without it, a day out of
   chronological order reads as a bug to anyone who saw the page yesterday. One word, in the heading, at
   the exact place the surprise happens — and not a badge: the day heading is sticky and already stands
   down under a suspension band (ADR-0078), so that layer takes no new inhabitants.

9. **Recomputed on every render.** The board is rebuilt on each 15s poll anyway; freezing the day at load
   would be the only piece of state on this page that has to remember a decision it already made. A page
   left open across midnight reorders under its reader — once per event, for whoever is still looking.

10. **The rule stops at the public page.** The admin's „Spielplan & Ergebnisse" court view stays
    chronological. The operator reads the **plan** (ADR-0077), and a plan whose days reorder themselves
    while placements are being dragged is a trap, not a service.

## Considered and rejected

- **The device clock (`Date.now()`).** Free, no contract change, and consistent with how the suspension
  countdown already works. Rejected on blast radius (see Context): a wrong device clock is a whole wrong
  section, permanently, for that one reader.
- **Derive the day from the running matches.** Attractive because it needs no clock at all and would keep
  the „admits no clock" line intact. It answers a different question: at 08:30 on Sunday nothing is
  running, and it is still Sunday. A rule that only works once play has started is not a rule about days.
- **An operator switch, like the suspension and the live court.** Consistent with how this site decides
  most things — and it asks a volunteer to flip a toggle at midnight. Every operator control we have
  exists because a human is the only one who knows the fact; here the calendar knows it.
- **Carrying `now` on `/api/phase`.** It is already polled and already assembles „four facts on one wire".
  But those four are all operator-set, and the day order should fall out of the same response as the days.
- **Auto-scroll or an anchor to today's section.** Keeps chronological order, and fights everything: the
  sticky day heading, back-navigation, and the poll (each re-render would have to remember whether it had
  already scrolled once).
- **Collapsing the finished day into a `<details>`.** Hides results that are still read on Sunday, and
  turns a reordering into a new interaction.
- **Rolling over when Saturday finishes, or at a fixed evening hour.** See §7.

## Consequences

- This is the **first clock the public schedule admits**, and it is admitted deliberately and narrowly:
  one server timestamp, one derived index, one ordering. The Live board's presence rule is untouched — it
  still reads the running status alone, and „no match running ⇒ no board" stays a clock-free rule.
- `scheduleResponseSchema` grows a field, so the public feed's shape changes. It is already `NO_STORE`, so
  no cache layer can serve a stale `now`.
- The mixer band needs no work: `placeMixerBand()` re-inserts it behind its own day's heading on every
  render, so when Sunday leads, the band leads with it (ADR-0073).
- The boundary is a test, not a hope: 22.08. 23:59:59 → day 0, 23.08. 00:00:00 → day 1, both Europe/Berlin.
  August has no DST edge, which is luck rather than design — the comparison is done in the zone regardless.
- Deliberately **not** in scope, each its own decision: the „ca." hedge on a day that is over, a „vorbei"
  treatment for the trailing section, and any per-day collapsing. The request was an order; this is an
  order.
