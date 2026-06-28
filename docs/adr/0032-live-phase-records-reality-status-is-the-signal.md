# ADR-0032: The Live phase records reality at desk granularity — status is the live signal, not a score feed

- Status: accepted
- Date: 2026-06-28
- Builds on: ADR-0001, ADR-0005 (site owns the data; the Live phase includes scheduling)

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
