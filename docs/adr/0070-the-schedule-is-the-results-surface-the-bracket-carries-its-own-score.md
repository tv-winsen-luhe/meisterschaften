# ADR-0070: The schedule is the results surface; the bracket carries its own score

- Status: accepted
- Date: 2026-08-19
- Refines: ADR-0046 (the public bracket is a two-phase projection, gated on full reveal only),
  ADR-0041 (the publish gate gates the _plan_, not results), ADR-0032 (the live phase records reality)
- Relates to: ADR-0045 (two sets + a Match-Tie-Break; the closed score space), ADR-0035 (the schedule
  slot degrades per slot), ADR-0004 (the consolation bracket), ADR-0008 (Astro + polling, no framework
  on public pages)

## Context

The Grand Slams split this into **three** surfaces — Draws, Order of Play, Results — and then partly
undo the split: Wimbledon renders the order-of-play slot and the result with the **same card component**
in two states, and Roland-Garros merges the two pages outright („Order of play & Results"). Nobody
maintains two representations of a match.

We have two surfaces, and the split falls in a different place: `/spielplan` shows scores, the public
bracket does not. `LiveBracketMatch` carries `winner` but no `score` and no `outcome`, so a played match
appears on the bracket only as a bold name against a faded one (`slotState`), and the score never reaches
the `/api/draw` wire. That is the one Grand Slam convention our bracket is missing — the Australian Open
prints full sets in every bracket cell, and at our field sizes (four rounds, not seven) there is no
space argument for Wimbledon's names-only cell.

The score is fully modelled and has a single formatter already: `matchScoreSchema` (`{set1, set2, mtb}`,
ADR-0045) and `slotGames(score, slot)`, read today by `/spielplan`, the courts board and the admin
results list.

**The obvious shortcut is wrong, and that is the point of this ADR.** The bracket **already joins** the
schedule feed to build its „Platz 3 · Sa ca. 14:00" caption (`indexScheduleByNode` → `NodeSchedule
{court, day, time}`), so carrying the score along that same join is a few lines. But `publicSchedule()`
is gated on `schedule_published` (ADR-0041), while the bracket is gated on the reveal cursor and
**explicitly never on the publish flag** — ADR-0046, verbatim: „never the schedule publish flag, because
a result is reality (ADR-0032), not the plan (ADR-0041)". A score joined off the schedule feed would
vanish from the bracket the moment the operator reset the plan, while the result it reports stayed true.

## Decision

**One public surface owns the schedule and the results together; the bracket carries results on its own
wire.**

1. **`/spielplan` becomes „Spielplan & Ergebnisse" — one surface, three states per row.** A row moves
   `geplant → läuft → beendet mit Score` in place over the weekend. No third „Ergebnisse" page: at ~35
   matches across two days it would be the same content with a different heading. The route stays
   `/spielplan` (a German route slug, ADR-0028) because it is linked and printed.

2. **`LiveBracketMatch` gains `score` and `outcome`, projected by `publicDraws()`.** The bracket gets the
   result from the draw wire, which is gated on full reveal only — so a recorded result reaches the
   bracket whether or not the plan is published, which is what ADR-0046 already requires of the winner
   and now also of the score that explains it.

3. **The gate asymmetry is deliberate and is the rule to remember:** on the bracket the **result** comes
   from `/api/draw` (ungated beyond the reveal cursor), the **court and planned time** stay joined from
   `/api/schedule` (gated). So the „Platz 3 · Sa ab 14:00" caption disappearing when the plan is reset is
   **correct** — the plan is gated — while the score staying put is equally correct. Two facts about one
   match with two different visibility rules, and they must not be collapsed for tidiness.

4. **`slotGames` stays the single formatter.** The bracket cell, the schedule row, the courts board and
   the admin list all read it. A non-standard ending renders as a terse token in the score position —
   „Aufg." after the sets actually played, „w.o." in their place — not as prose in a meta line.

## Considered and rejected

- **Join the score off the schedule feed.** The cheap change, and it silently couples a result to the
  plan gate. Recorded and named here precisely so a future reader does not „simplify" the second wire
  away: the duplication is the invariant, not an oversight.
- **Ungate `publicSchedule()` so one feed can serve both.** Inverts ADR-0041 to save a field. The gate
  exists because a half-built plan shown publicly is misleading; results have no such problem.
- **A third „Ergebnisse" surface, mirroring the Grand Slam three-page split.** Their split is driven by
  volume — fifteen days, hundreds of matches, a day strip of fifteen chips. Ours would be two chips and a
  duplicate page.
- **Keep the bracket names-only (the Wimbledon cell) and let the schedule own every score.** Defensible
  at 128 lines, where the cell has no room and a match page exists to click through to. At a 12-entry
  field the whole bracket is visible at once and the score is the thing a reader is looking for; we have
  no match page to send them to.
- **Tiebreak points as superscript on set scores** (`7⁷ 6²`), the one convention all three references
  share. Not available: the score space is closed at `7:6` with no tiebreak detail stored (ADR-0045), so
  this would need a model change to a permanent archive for a typographic gain. The Match-Tie-Break does
  carry its points and keeps showing them (`10:8`).
- **Match duration in the card header** (`3h 1m`), which all three print on a completed match instead of a
  start time. We store status transitions, not timestamps — not available without new state.

## Consequences

- The `/api/draw` wire grows by two fields per live match; the redaction seam (ADR-0048, dormant per
  ADR-0061) gains nothing to redact — a score is not strength.
- Polling is unchanged: the public draw page already polls `/api/draw` and `/api/schedule` together.
- **The two public surfaces now share a vocabulary** — the same player line (club crest, full name, seed
  token) and the same score column — and on a phone a bracket round renders as the same row shape as a
  schedule row. That shared row therefore lives once, in a shared render module, rather than being
  reimplemented in each of the two monolithic `.astro` files. The Astro + inline-script + polling
  architecture (ADR-0008) is unchanged; no framework arrives on the public pages.
- The bracket becomes readable as a results archive after the event (ADR-0007), which it was not: a
  finished bracket previously recorded who won without recording how.
