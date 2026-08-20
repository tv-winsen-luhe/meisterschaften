# ADR-0032: The Live phase records reality at desk granularity — status is the live signal, not a score feed

- Status: accepted
- Date: 2026-06-28
- Builds on: ADR-0001, ADR-0005 (site owns the data; the Live phase includes scheduling)
- Amended: 2026-08-20 (see Amendment below — the Zwischenstand gets a surface; set-level stays the floor)

## Context

ADR-0005 established that the Live phase carries a schedule and a public live view. Epic #9 builds it,
and a wish surfaced: live in-match score updates while a match is going on. That wish collides with the
operating model. There is **one operator at the tournament desk, on a phone, with no per-court access**
(ADR-0001, ADR-0005), and therefore **no courtside data source**. The desk reliably knows only two
events per match: it **started** (players were sent out) and it **finished** (the result was reported
at the desk). A point- or game-level live score has nowhere to come from, and one person cannot keep
six concurrent live scores current on a phone.

Separately, execution diverges from the plan: a match often goes on whatever court frees up, not the
court it was planned on.

## Decision

The Live phase records **reality at the granularity a single desk can actually feed** — it is not a
live scoring feed.

- **The status transition _is_ the live signal.** The public live board, polling ~10–20s, shows a match
  move `planned` → `running` (auf Platz X) → `done` (with the result). For an off-site follower that
  transition is the live update, and it is genuinely valuable.
- **Set-level is the finest grain, and it is opportunistic.** Scores are stored per set, so the operator
  _may_ save a completed set ("Satz 1: 6:3") if they happen to learn it, and the board can then show
  "Satz 1: 6:3 · Satz 2 läuft." Best-effort, never promised, never finer than a completed set.
- **No game- or point-level live scoring.** It has no data source and would require per-court reporting,
  which ADR-0001/0005 deliberately ruled out. Recorded as an explicit no so it is not later "fixed."
- **The public always shows the current truth, never the stale plan.** A match's court is the **actual**
  court once it is running (captured at the `running` transition), falling back to the planned court only
  before it starts — a spectator is never sent to the wrong court. Published **times** stay static
  ("ca."); their drift is communicated through status (läuft/beendet), not by rescheduling. The model
  therefore carries the planned court/slot (the published plan, what the validator reasons over) **and** a
  separate live court set when the match goes on.
- **Scores are best-of-2-sets + Match-Tie-Break for every competition**, stored as a fixed, small set of
  columns (set1/set2/MTB per slot, plus the stored winner and an outcome enum) — no JSON, no child table.
  The shape never varies, so it is encoded directly (CLAUDE.md: simplest solution; ADR-0021: small N).

## Consequences

- `matches` gains: a planned court + planned slot (start), a live/actual court, a status
  (`planned`/`running`/`done`, English per ADR-0028), fixed set-score columns, and reuses `winnerRegId` /
  `outcome`.
- The public live board is **one event-wide page** (schedule + a "jetzt auf dem Platz" courts board);
  the brackets stay per-competition; everything reads the same match records.
- If courtside reporting ever appears (helpers phoning scores in), set-level entry already supports it
  additively. Point-level scoring would reopen this ADR.

## Amendment (2026-08-20): the Zwischenstand is an operator affordance — one write path, no implied start, `legalSet` throughout, no announcement

The wish this ADR refused came back in its narrow form: relay a running match's **set** score from the
grounds so the public surfaces show something close to a live score. That is not a reversal — it is the
opportunistic set-level entry §2 already allows, finally given a surface. **Point- and game-level scoring
stays refused** (§3): the desk still has no courtside data source, and a partial _set_ is not a coarse live
score, it is a completed set arriving early.

The datum needed no new model — `matches` already stores a null set as one not (yet) played, and
`POST /api/admin/match/set` already writes one set without resolving the match. What this amendment settles
is the four questions a surface for it raises.

- **One write path: the operator, in the admin.** No courtside reporting link, tokenised or open. A second
  writer on the `matches` aggregate buys a faster Zwischenstand and pays for it with an auth surface and the
  question „who entered 6:0 6:0 for the other player?" — the single desk stands (ADR-0001, §Context here).
  If helpers ever do phone scores in, they phone them to the desk.
- **It lives where a score is already typed.** The result drawer's Save is disabled with a reason whenever
  the score is legal but not yet decisive („der Sieger steht noch nicht fest"); in that exact state the
  action becomes **„Zwischenstand speichern"**, posting each changed set to `/api/admin/match/set`. A dead
  disabled button becomes the affordance, and the alternative — a second pair of score inputs inline in the
  results list — would be two grammars for typing the same two numbers. Clearing is the same act: empty the
  fields and save, which writes the set back to unplayed. One request per changed set, at most three; no
  batch endpoint for a maximum of three integer pairs (ADR-0021).
- **Saving a set never moves the status.** `/set` stays pure. The `running` transition carries the **actual
  court**, which only the operator knows; deriving it from a typed number would set the status _without_ a
  court and send a spectator to the planned one — the failure the current-truth bullet above exists to
  prevent. So the Zwischenstand is offered for `running` matches only: a `planned` match is started with
  „Läuft" (and its court) first, and a `done` match is corrected through `/result`.
- **`legalSet` binds on this path too.** The request schema gains the same predicate the result schema
  refines against (ADR-0045), which it was missing — it validated only the 0…99 typo bound, so a `3:2`
  passed. Since a saved set is by definition a _completed_ set, `3:2` is not a permitted coarse reading of a
  running set; it is an illegal set, and „an illegal score is impossible" has to stay true on every write
  path or it is not a closed space. **Contiguity is deliberately not enforced**: clearing set 1 to retype a
  mistyped digit leaves set 2 briefly standing alone, and that transient is legitimate.

**This supersedes one phrasing of §2.** That bullet imagined the board reading „Satz 1: 6:3 · Satz 2 läuft".
It does not. The score sits in the **score column** beside the „läuft" badge and says nothing else, because
a decisive score ends the match — so there are only ever **two** Zwischenstände, „one set stands" and „1:1,
the MTB is running", and which set is live is read off how many numbers there are. The sentence was a sketch
written before the surfaces existed; the surfaces turned out to need nothing added. Note what the score on a
running row costs: the assumption „a finished match says so with its score" (`shared/match-view.ts`) no
longer holds, and the distinction is carried instead by the „läuft" badge and by the **absent winner mark** —
a running match has no `winnerRegId`, so neither line is bold or checked.

**It is not announced.** No copy on the front door or the Schedule & results page promises live results. An
unannounced Zwischenstand that is sometimes there reads as a bonus; an announced one that is an hour old
reads as broken — and a busy Saturday will produce the second. The same restraint keeps „Scoreboard" out of
this project's vocabulary.

### Consequences

- Server, store and tests for the write already exist (`/api/admin/match/set`, `saveSet`,
  `test/store-result.test.ts`, `test/result.integration.test.ts`); no client had ever called it. What is
  missing is the drawer's second save path and `legalSet` in `matchSetRequestSchema`.
- **No public frontend change.** Both wires already carry a running match's score ungated as current truth,
  and the courts board and the schedule row share one contestant line, which already prints the score column
  — so a saved set appears on the Live board, the schedule row and the bracket cell at the next poll.
- Set-level stays the floor. Anything finer reopens §3, not this amendment.
