# ADR-0005: The Live phase includes match scheduling and a live public schedule

- Status: accepted
- Date: 2026-06-25

## Context

We considered making the Live phase results-only (the bracket updates as winners are entered, but the
site never owns courts or times). The organizer rejected that: after the Auslosung the tournament
director has to plan which match is on which court at roughly what time, the way nuTurnier does it.
Participants need to know which day and roughly when they play (9:00 is very different from 12:30),
and showing which matches are currently on which court is central to communication during the
weekend — including for people who are not on site but want to follow along.

This expands the Live scope beyond the "thin result entry" framing of ADR-0001, but stays within its
single-operator model: the tournament director does the planning; there is still no per-court access.

## Decision

The site provides tournament scheduling, not just result recording:

- Each match has a default planned length of **90 minutes**.
- After the Auslosung, matches are assigned to a **court** and a **planned start** (day + time). Times
  are explicitly **approximate** — a plan, communicated as "ca.", not a guarantee.
- Matches are scheduled by **bracket position**: a not-yet-decided match shows its feeders ("Sieger
  M3 vs Sieger M4") until results fill in the names.
- Each match carries a **live status** (geplant → läuft auf Platz X → beendet). The operator updates
  it; the public site reflects it in near-real-time so off-site followers can track what is on now and
  where.

## Consequences

- The data model needs courts, a per-match planned day/time, and a match status — on top of the
  bracket graph from the draw.
- The public Live view is two things at once: a schedule (who plays when/where) and a live board
  (what is on court right now), both derived from the same match records.
- Because durations are unpredictable, planned times drift during the day. **Resolved:** published
  planned times are static ("ca."); the real-time truth is the Match-Status (läuft/beendet) on the
  Live-Board, which followers reconcile against. Manual reschedule via the grid stays available for
  big disruptions (e.g. rain); a global delay-offset is a possible later nicety, not core.
- **Resolved:** the operator places matches by hand on a courts×time grid; the system does not
  auto-generate the plan. The system's role is live validation — it enforces the hard rules and warns
  on the soft one:
  - hard: a match cannot be placed before its feeder matches' slots end (round dependency);
  - hard: no time slot may hold more matches than there are courts (6);
  - soft (warn): a player should not have back-to-back matches with no rest gap.
  - This is tractable because each member is in exactly one Konkurrenz (a confirmed invariant —
    registration enforces one active entry per person, see CONTEXT.md), so a player is never in two
    matches simultaneously and the scheduler never has to resolve cross-field player clashes.
  - An "auto-fill" helper (e.g. lay out round 1 from 9:00) may be added later on top of the manual
    grid, but is explicitly not part of the core.
