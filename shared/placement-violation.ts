// The vocabulary a placement check speaks: what can be wrong with putting a match in a grid cell, and in
// which of the two registers — hard (block the impossible) or soft (warn the unwise), ADR-0033. Its own
// module because it is a *contract* rather than arithmetic: `validatePlacement` produces it, the admin grid
// and its warning list render it, the place endpoint enforces the hard half, and a per-rule module
// (court-plan.ts) returns one. Readers that only need the shape can depend on this instead of the whole
// validator, and schedule.ts stays within its line budget. Type-only, so it adds no runtime import edge.
import type { Placement } from './schedule'

// A **hard** violation — a physically impossible state the placement endpoint blocks (ADR-0033).
//  - `feeder-order`: the candidate would start before a match it depends on by round has finished — a
//    feeder whose 90 minutes are not yet over, or a successor it must finish before. `otherMatchId` is
//    the conflicting match.
//  - `court-taken`: the candidate's 90-minute interval overlaps another match already on its court — two
//    matches cannot share one court at one time. Occupancy is **interval overlap** (starts fewer than
//    SLOT_SPAN steps apart), not a shared cell (ADR-0040). `otherMatchId` is the match already there.
//    With `court` bounded to the six courts, this also makes "more matches running at once than courts"
//    structurally impossible (ADR-0033 — the grid's court rows make the court cap structural).
//  - `court-window`: the candidate's 90 minutes would run past its court's evening window — the four dark
//    courts must finish by ~20:00 daylight, the floodlit pair by the 22:00 curfew (ADR-0040). It is about
//    the candidate's own cell, not a clash with another match, so it carries no `otherMatchId`.
//  - `player-overlap`: a player in the candidate would be in two time-overlapping matches at once — one
//    person, two courts, physically impossible (ADR-0040). Now expressible thanks to the interval model;
//    it bites when a round-1 loser drops into the consolation bracket the same day. `regId` is the shared
//    player, `otherMatchId` the match they already hold.
export type HardViolation =
  | { rule: 'feeder-order'; otherMatchId: number }
  | { rule: 'court-taken'; otherMatchId: number }
  | { rule: 'court-window' }
  | { rule: 'player-overlap'; regId: number; otherMatchId: number }

// A **soft** violation — a player-comfort or scheduling-shape concern the operator may override (ADR-0033).
//  - `player-load`: the player would hold more than 2 matches on the candidate's day. `count` is the total.
//  - `short-rest`: the player's rest between two same-day matches (`nextStart − previousEnd`) would be under
//    `minRestMinutes` (ADR-0040). It only covers non-overlapping matches — an actual overlap is the hard
//    `player-overlap` block, not a rest nudge. `otherMatchId` is the player's other match.
//  - `finals-day`: a main-bracket semifinal or final placed off Sunday (the last event day). Sunday is
//    finals day (ADR-0040), so an earlier placement is nudged — never blocked; a final *may* be played on
//    Saturday. `round` is the candidate's round (the surface phrases the reminder from it). The rule value
//    is English (CLAUDE.md — wire/data values); the German term survives only in the user-facing copy.
//  - `social-mixer-block`: the candidate's 90 minutes would run into the Social mixer's reserved court-time
//    (CONTEXT: Mixer block, ADR-0063). An organiser agreement rather than a physical impossibility, so the
//    operator may override it. Like `court-window` it is about the candidate's own cell, not a clash with
//    another match, so it carries no `otherMatchId`.
//  - `parallel-limit`: more matches would be on court at one moment than the day's cap allows (ADR-0067) —
//    Saturday shares the grounds with a youth fixture, Sunday is there to be watched. `count` is the peak
//    number running together, the candidate included. It is about the day's shape rather than any one other
//    match, so it names no `otherMatchId`.
export type SoftViolation =
  | { rule: 'player-load'; regId: number; count: number }
  | { rule: 'short-rest'; regId: number; otherMatchId: number }
  | { rule: 'finals-day'; round: number }
  | { rule: 'social-mixer-block' }
  | { rule: 'parallel-limit'; count: number }

export interface PlacementValidation {
  hard: HardViolation[]
  soft: SoftViolation[]
}

// The match being placed: its `id` (it must appear in the `matches` set so its bracket position and
// players are known) and the proposed grid cell.
export interface PlacementCandidate {
  id: number
  placement: Placement
}
