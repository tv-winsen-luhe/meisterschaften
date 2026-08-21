# ADR-0077: The operator reads the plan, the public reads the announcement

- Status: accepted
- Date: 2026-08-21
- Relates to: ADR-0070 (the schedule is the results surface), ADR-0069 / ADR-0071 (the planned time is a
  reservation; the hedge moves behind the number), ADR-0032 (status is the live signal, and the running
  match captures its actual court), ADR-0027 (a manual flag over a derived state), ADR-0028 (English
  everywhere except user-facing copy), ADR-0075 (the court heading owns its column)

## Context

The ask was two sentences from the operator: the admin's **Ergebnisse** surface should show a match's
planned start time, and a view grouped by court would be useful.

Both halves are display-only. Every fact is already in the surface's hands: `/api/admin/draws` returns full
match rows, so `day`, `slot`, `court`, `liveCourt` and `status` are all present in the `Match` the row is
rendered from (`shared/admin.ts:129`), and `slotTime(day, slot) → "HH:MM"` has existed in
`shared/schedule.ts:114` since the grid was built. `results-surface.tsx` imports `COURT_NUMBERS` and
`slotLabel` but never reads `day` or `slot`, and reads `court` only as the gate on the „Läuft" button. The
surface has been holding the answer and not printing it.

What makes this worth recording is not the two features but the boundary they cross. **ADR-0070 is titled
„the schedule is the results surface"** — publicly. `/spielplan` merged the two: one page, grouped day →
court, a row moving `geplant → läuft → beendet` in place. The admin deliberately did not: **Spielplan** is a
6×22 placement grid with a „Nicht geplant" backlog tray, **Ergebnisse** is a per-competition, round-grouped
list of rows with a result drawer. Asking Ergebnisse for a court reading pulls the admin toward the merge
the public page already made, and the honest question is whether the admin should finish that merge or state
where it stops.

The second boundary is the **time**. Every public surface hedges: a **Published time** reads „14:00" when
nothing in front of it can push it and „ca. 14:00" when its reservation abuts the one before, and ADR-0071
spent a whole decision on where the hedge sits relative to the number. A shared projection for that already
exists — `scheduleView()` in `shared/match-view.ts:453` builds `DayGroup → CourtGroup → MatchRow` with the
chain computed over the whole feed. Reusing it for the admin is the obvious move, and it is the wrong one
(below).

## Decision

**Ergebnisse gains the court reading and the planned time; it does not become the Spielplan, and it does not
inherit the public hedge.** Six rules.

1. **The admin states a plain clock time; the hedge is a public device.** The row reads „Sa 14:00", never
   „ca. 14:00". The hedge is a statement to a reader about what can still move a start — and the operator
   _is_ what moves it. „ca." answers a question the desk does not have, and printing it would put the one
   surface that authors the plan at the same remove from it as a spectator on the grounds.

2. **The day travels with the time, always.** Both event days share one slot numbering and both open at
   10:00 (ADR-0071), so „14:00" alone names two different afternoons. A round can straddle days — the soft
   „more than 2 matches per day" warning exists precisely to spread a deep run — so the day cannot be
   inferred from the round heading. `dayLabel` already exists; two characters beat an ambiguity.

3. **The court is shown always, and it is the court the match is actually on.** Before the start that is the
   planned court; from the `running` transition it is `liveCourt`, which ADR-0032 captures exactly because
   reality diverges. Where the two disagree the row reads **`Platz 3 (geplant 5)`** — the shortest form that
   names both without saying „Platz" twice, and legible on the tablet the desk actually runs. This is the
   public rule („the court always reflects reality") applied to the operator, with the divergence _visible_
   rather than resolved silently, because on this surface a mis-started match is something to notice. It
   also makes „no court at all" legible instead of silent.

4. **The court view is a grouping toggle, not a surface, and the grouping is day → court →
   chronological.** `Gruppierung: Runde | Platz` on Ergebnisse: the same rows, the same drawer, one
   different `groupBy`. The hierarchy is the public page's fixed one (ADR-0071 §5), so the operator and the
   grounds read the same shape. Empty courts and empty days are dropped entirely, as `scheduleView()` drops
   them — six „frei" headings per day is scroll spent before the content starts, the same instinct as the
   Live board's presence rule. Default is **Runde**, the status quo, held in plain component state and
   forgotten on reload.

5. **In the court view the surface goes event-wide and the field tabs go away.** A bracket belongs to a
   competition, so the round view is necessarily per-field; a court, on the grounds, holds matches from every
   field, and „was läuft auf Platz 3" has no per-competition answer. The tabs are **hidden**, not disabled,
   because the dimension genuinely changed. Its population is the **Spielplan surface's** gate —
   `bracket !== 'main' || isFullyRevealed(draw)` (`schedule-surface.tsx:151`) — one predicate rather than the
   tab gate's main-plus-matching-consolation pairing, and the same rule as the surface that creates the
   placements it displays. Matches with no placement collect in a trailing **„Nicht geplant"** group, so
   nothing vanishes; the round view grows no such group, because a round section is already a home for a
   match without a court.

6. **Each view's row carries what its own headings do not.** In the court view the headings say the day and
   the court, so the row reads `M7 · 14:00 · Viertelfinale · Herren` — the competition becomes **required**
   there, being the one thing a court group cannot tell you once the tabs are gone. In the round view the
   heading says the round, so the row reads `M7 · Sa 14:00 · Platz 3`. Not one identical meta line in both:
   the duplication would be loudest exactly where the surface is densest.

## Considered and rejected

- **Reusing `scheduleView()` for the admin grouping.** The strongest-looking option and the one that fails on
  inspection: the shared projection is built to _exclude_ precisely what the admin must show — unplaced
  matches (its row type has `court/day/slot` **non-nullable**, since only placed matches ship), the
  unpublished plan, and reveal-gated competitions — and to _add_ what the admin must not have, the hedge and
  finished German strings without the row identity the drawer needs. Lifting it to accept both row types
  would couple the public announcement to the operator's worksheet at the one seam where the two disagree
  about what a schedule _is_. The admin groups locally over the `Match[]` it already holds and borrows only
  `slotTime`, `dayLabel` and `COURT_NUMBERS` — a dozen lines against a permanent coupling.
- **Fetching `/api/schedule` into the admin and rendering the public projection.** Worse than the above: the
  surface that builds the unpublished plan would read a publication-gated feed to do it, and would go blind
  the moment the operator has not published yet — which is the whole pre-event window.
- **Putting result entry on the Spielplan grid instead, finishing ADR-0070's merge in the admin.** The honest
  alternative, and it loses on the shape of the two jobs rather than on principle. Publicly one surface works
  because the public row is **read-only**; the admin row carries two contestant lines and three controls, and
  the grid's cell is a drag-and-tap placement target in a 6×22 matrix. **Placement is one job, recording is
  another**, and this decision gives Ergebnisse the court _reading_ without giving it the grid. Recorded
  because the pull toward one admin surface will come back.
- **A new „Plätze" sidebar surface.** The same rows and the same drawer wiring, duplicated, plus a context
  switch mid-weekend and a longer sidebar. The axis changed, not the work.
- **Grouping running matches under their planned court and marking the divergence in the row.** Consistent
  with „the plan is what the plan said", and wrong for the one question the view exists to answer: a card
  under „Platz 5" for a match being played on 3 sends the operator to the wrong court, which is the exact
  failure the public surface's live-court rule was written to prevent.
- **Defaulting to `Platz` during the live phase and `Runde` otherwise.** Inferring the operator's intent from
  the phase, which this project refuses on principle (ADR-0027): a grouping is a reading preference, and the
  phase does not know which question is being asked.
- **Remembering the toggle in `localStorage`.** A stored preference is a thing to be wrong about across two
  event days and two devices; the toggle is one tap and the default breaks no muscle memory.
- **„angesetzt" as the German for the planned start**, the operator's own word in the request. Refused on
  ADR-0028's one-term rule: the shipped German is **„geplant"** — the `planned` status label and the
  Spielplan's „Nicht geplant" tray — and „angesetzt" would put two words for one concept on adjacent
  surfaces.
- **A right-aligned time column, or a second line under the match badge.** The public **Match row** already
  treats „round · match number · competition" as one meta line, and a new column would be un-invented by
  the court view, where the time is the only varying part of the line.
- **A marker glyph with the planned court in a `title`.** Unreadable on a tablet at the results desk.
- **Rendering all six court headings per day** so a court's shape is visible even when empty. Worth seeing
  across eighteen courts, not across six — the same reasoning ADR-0075 used to reject dimming filtered
  matches.
- **A new glossary term.** Every concept here — Court, Schedule, Published time, Match status, Match row —
  is already in `CONTEXT.md`. What is new is the boundary in rule 1, which is a decision, not a word.

## Consequences

- **Two court groupings now exist in one application**, and they are deliberately different code: the
  public `scheduleView()` over the gated feed, and the admin's local grouping over the draws response. The
  difference is not an oversight to be refactored away — rule 1 and the nullable placement are the reasons,
  and anyone merging them re-opens both.
- **„Published time" is now explicitly a public-only concept.** Before this, „the planned start, hedged" was
  simply what a time looked like in this codebase. The hedge is now scoped: `publishedTime` is for the
  announcement, `slotTime` is for the plan.
- **The court view is the first admin surface that is event-wide.** Ergebnisse, Spielplan and the brackets
  are all per-competition or per-cell; a grouping that spans fields means the competition is load-bearing in
  a row's meta line for the first time (rule 6), and the next thing added to that line has to earn its place
  against it.
- **The divergence form in rule 3 is a third state for the court cell** — planned, actual, actual-with-planned
  — where the surface previously had two (hidden, or `liveCourt` while running). The court is no longer
  absent as a way of saying „not started".
- **Nothing about the schedule, the validator, the feed or the public page changes.** No schema work, no new
  endpoint, no wire-contract change: `day`, `slot`, `court` and `liveCourt` were already on the wire, and
  this decision only prints them.
