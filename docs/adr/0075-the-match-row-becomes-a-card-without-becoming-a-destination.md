# ADR-0075: The match row becomes a card without becoming a destination

- Status: accepted (rule 3 amended by ADR-0076)
- Date: 2026-08-20
- Refines: ADR-0069 / ADR-0071 (the published time, its hedge, and the day → court hierarchy), ADR-0072
  (the weekend surfaces are scanned, not read)
- Relates to: ADR-0070 (the schedule is the results surface), ADR-0032 (status is the signal), ADR-0074
  (the competition filter), ADR-0028 (English everywhere except user-facing copy)

## Context

The prompt was a comparison: Roland-Garros' Order of Play groups its matches by court, and `/spielplan`
should perhaps do the same. Checking the build answered that before it could be designed — **it already
does.** `shared/match-view` projects `DayGroup → CourtGroup → MatchRow`, ADR-0071 §5 states the hierarchy as
fixed, and the „Nach Tag / Nach Platz" toggle that once offered the alternative was removed there with a
standing refusal to bring it back.

So the borrowed idea was not the axis. Reading the two surfaces side by side, what Roland-Garros has and
`/spielplan` did not is the **weight** given to a hierarchy both of them share:

- Its court heading is a full-ink banner that goes sticky on a phone. Ours was 12px at **55% navy** — a
  whisper, with a code comment justifying the whisper („the court is the quieter of the two headings on
  purpose"). The grouping existed in the projection and had to be inferred on the screen.
- Its matches are **cards**. Ours were rows separated by a hairline, which reads as one continuous list, so
  the boundary between two matches and the boundary between two courts had comparable strength.

Two structural facts from the same reading matter because they bound how much of the reference is
transferable. **Roland-Garros' court block subdivides**, into `matchSchedulers` — one court carried „Start at
11:00" with three matches and „Not before 20:15" with one, the night session, under a single court heading.
And **its follow-on matches print no time at all**: only the first match of a block has one, order is carried
by vertical position, with no „followed by" text and no ordinal.

That second fact is the hinge. It is what lets Roland-Garros put the time **inside** the card, next to the
round label — there is at most one time per block to place. Every card here carries a time, because ADR-0071
decided the number stays in front of the hedge for a player planning around it. Two models of the same
weekend, and only one of them can spend the card's interior on a clock.

One thing the reading also found: the sentence in the page's foot note explaining „ca." ended „Früher fängt
also nichts an, später schon." Checked against how the weekend is actually run, that is **false** — a match
can be called early when its court comes free. The planned time is the point the organisers aim at, not a
floor under it.

## Decision

**The row becomes a card, and the card is a boundary rather than a destination.** Four rules, and each one
is a place where the borrowing stops.

1. **The court heading owns its column.** Full navy ink, a rule under it, real spacing — the loudest thing
   between two courts, so the hierarchy the projection has always had is finally the one the eye reads. The
   loudness is bought with **ink and a rule, never with size**: it keeps the day heading's 12px, because a
   court heading that outgrew its day would invert the hierarchy this rule exists to state. What keeps it a
   rank below is everything else — no uppercase, a 1px rule against the day's 2px — and it **stays out of
   the sticky stack**: the reason recorded for that in ADR-0072's implementation, three pinned layers being
   most of a phone viewport, has not expired.

2. **The card wraps the contestants, the sets and the meta line. The time stays outside it.** The card is
   `.sched-match__players`, the grid that already existed; the time keeps the left gutter and „läuft" keeps
   the right one. This is the direct inversion of the reference and it follows from ADR-0071: because every
   card here has a time, a straight edge of times to read down a court is worth more than a tidier card. A
   card that swallowed the time would be the first half of an argument whose second half is dropping the
   follow-on times — and that was considered and rejected (below).

3. **The card promises nothing.** A border; no fill, no shadow, no hover lift, no link. Cards
   are the language of tappability, most of all on a phone, and there is nowhere for a tap to go: this
   project has no match detail page. A flat frame states „this match ends here" and claims nothing else.

   > **Amended by ADR-0076 (2026-08-20).** This rule originally read „a border **and a radius**", and the
   > radius was its one exception — a rounded rectangle being the strongest tappability cue in the
   > stylesheet, the single property the rule kept was the one arguing against it. The radius is gone; the
   > rule's intent is unchanged and better served without it.

4. **The block boundary is carried by the gap and the weight, not by a second divider.** Within a court, a
   card whose time is anchored — the first of the day there, or the first after a gap in the reservation
   chain — opens a fresh block and gets a wider gap in front of it, with the hedged „ca." times around it a
   weight lighter. It gets **no rule across the column**: a divider inside a court would compete with the
   court heading rule 1 just made loud, and tear up the grouping this whole change exists to state. It also
   costs the hedged time **no ink** — fading it was tried and reverted, because a follow-on time is the
   common case on a court and most of the column's times would have paid for one boundary. The fact is read
   off `.sched-match__time--follows` with `:has`, rather than the renderer emitting a second hook — the
   stance the „läuft" rail already established in this stylesheet.

**Separately, and not a presentation decision: the foot note's claim about direction is corrected.** „Früher
fängt also nichts an, später schon" becomes „Die Turnierleitung orientiert sich dabei an den geplanten Zeiten — es
kann aber auch etwas früher losgehen." A reader who is promised „never earlier" and arrives on that promise
has already missed their match, which is the one failure this page must not cause. `CONTEXT.md`'s **Published
time** gains the same fact as vocabulary: a planned start is an **anchor, not a floor**, which is also why
the hedge has always read „ca." and not „nicht vor".

## Considered and rejected

- **Grouping by court.** Already the shipped hierarchy (ADR-0071 §5). Recorded so the next reader who opens
  the reference page and has the same thought finds it answered rather than re-opening the toggle.
- **A „nach Platz" / „nach Zeit" toggle.** Removed once, with a standing refusal in ADR-0071 §5. Nothing in
  the reference argues for it: Roland-Garros has no such switch either — its filters never change the
  grouping.
- **Dropping the time on follow-on matches, the way the reference does.** The honest end of the „chained, not
  gridded" argument, and it loses to ADR-0071 on who is reading: a club player asks „when do I have to be
  there", not „where in the chain am I". „im Anschluss" answers the second question only. Also already
  rejected once — it is close to ADR-0069's superseded „im Anschluss · nicht vor ca. HH:MM".
- **A time-block group inside a court**, mirroring `matchSchedulers` and its „Not before 20:15" heading. A
  fourth grouping level for six sand courts. Roland-Garros needs it because tickets are sold per session;
  the equivalent here — an evening match on floodlit court 5 or 6 after a gap — already falls out of rule 4
  as an anchored time and a wider gap, without a name.
- **The court heading carrying a start time** („Platz 2 · ab 10:00"). Not what the reference does either: its
  heading is the court name alone and the „11:00" lives in a sponsor's clock widget below it. Here the same
  number is already the first card's plain time, so the heading would be repeating the row beneath it.
- **The court heading carrying its properties** — a name, „Flutlicht", or its rank in `COURT_VIEWING_ORDER`.
  Everyone at this club knows where court 3 is; a name would be borrowed grandeur. Floodlighting and
  viewability are **planning** attributes — the operator's inputs on the admin grid — and putting them on the
  public board would state a constraint as though it were an invitation.
- **Courts side by side as columns**, one day as six columns. The reference stacks its courts too, and this
  page has a print stylesheet for the posted sheet where columns break differently anyway.
- **Dimming finished matches**, as the reference does with `end-matches`. Rejected on ADR-0070: the schedule
  **is** the results surface, and the finished match is what a reader comes back for in the evening.
  Roland-Garros can de-emphasise a completed match because its result lives on its own page. Emphasis stays
  where ADR-0072 rule 2 put it — on „läuft", the only badge — and everything else stays equal.
- **Greying filtered matches out** (`opacity: 0.3`) instead of removing them, as the reference does. It
  preserves the shape of a court's day, which is worth seeing across eighteen courts and not across six. And
  the reason to want it here is already covered: ADR-0071 §3 builds the „ca." chain over the whole feed
  **before** the competition filter, so hiding a field can never promote the match behind it to a time it
  does not own.
- **Keeping the card on paper.** Six frames per court is white space the sheet at the results desk cannot
  spend, and a hairline says „this match ends here" just as well on a page that does not scroll. The print
  stylesheet already takes this line — it drops the Live board outright as „stale before the page leaves the
  printer".
- **Only making the court heading louder, and leaving the rows as rows.** The cheap half of the change, and
  it was the recommendation until the card was asked for specifically. Recorded because it remains the
  fallback if the cards prove too tall on a phone: rules 1 and 4 stand without rule 2.

## Consequences

- **The change is CSS only.** `matchRow` and `playerLine` in `src/components/schedule-board.render.ts` are
  untouched, so every assertion in `test/schedule-board-render.test.ts` about which cells a contestant line
  occupies (#343) holds by construction. The card is a border on a grid that was already there.
- **`.sched-match__time--follows` becomes a layout dependency.** It was a typographic weakening of a hedged
  time; rule 4 hangs the block boundary off it as well. `test/schedule-board-render.test.ts` gains a guard
  for it, because losing the class would silently flatten every court into one stack rather than fail
  anything.
- **The „läuft" badge moves out of flow, into the card.** It was a grid item in an implicit third column —
  correct while rows were separated by hairlines, because an unbadged row simply did not open the track.
  Seen in a built page, the card turned that into **a narrower card on the one running match**: a ragged
  right edge down the column, and the row a reader is hunting for clipping its name earlier than its
  neighbours. So the badge is positioned into the card's bottom-right corner, where the meta line leaves
  space, and the meta reserves room for it on that row only. Recorded because it is the general shape of
  what the card costs: **anything conditional beside the row was invisible as a hairline row and is a width
  difference as a card.** The next thing added beside a row has to answer this.
- **The three vertical gaps inside a day are now a ranked set** — 8px between cards, 22px at a block
  boundary, 36px between courts — and the numbers only mean anything against each other. A first attempt put
  the block boundary at 28px against a court's 26px, which said the chain matters more than the column: the
  exact inversion rule 1 exists to undo. Changing one of the three is changing all three.
- **The „läuft" rail is unchanged and stays outside the card.** It is drawn out of flow at `left: -8px` on
  `.sched-match`, so it spans the row including both gutters and moves nothing — the property ADR-0072 rule 3
  wanted from it. A rail on the card's own edge would have been the tidier drawing and would have shortened
  the one signal on the page that has to survive greyscale.
- **The print path diverges from the screen for the first time in the row's anatomy.** Until now „the same
  DOM as the screen" meant the same shape; the card makes that a screen shape with a paper counterpart. The
  print block states the reversal explicitly so the next change to the row knows there are two answers.
- **This ADR does not revisit ADR-0072's open items.** `✓` is still emitted from `playerLine` although
  ADR-0072 deletes it, and `.sched-match__name` still ends in an ellipsis on screen although rule 1 there
  says a name wraps instead. Both are inside the row this change frames and neither is fixed here — they are
  ADR-0072's to finish, and folding them in would let this decision inherit an argument it did not make.
- **The admin is untouched.** Nothing here argues about the operator's grid.
