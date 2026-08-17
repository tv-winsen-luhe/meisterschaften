// How the organiser wants the six courts *used* (ADR-0067) — as distinct from `schedule.ts`, which owns
// what the courts physically are (how many, how long a match is, when the light runs out). Two decisions
// live here, both about the shape of a day rather than its physics, and both feeding soft rules the
// operator may override: which courts an audience can actually watch from, and how many matches should be
// on court at one moment. Split out so `schedule.ts` keeps within its line budget — the same discipline
// `suggest-schedule.ts` came from — and the dependency runs one way (schedule → court-plan): the peak
// arithmetic takes the match span as an argument instead of importing it back.
import type { SoftViolation } from './placement-violation'

/**
 * The courts ranked by how well spectators can follow a match from the grounds, best first: 2, 3 and 6
 * watch well, 4 and 5 are acceptable, 1 is the hardest to see. A venue fact like the floodlights, not a
 * scheduling rule — the auto-suggest reads it to choose *which* free court a match takes, and nothing
 * else in the system treats a court differently because of it.
 */
export const COURT_VIEWING_ORDER: readonly number[] = [2, 3, 6, 4, 5, 1]

/**
 * How many championship matches may run at the same moment, per event day. **Saturday four**: the club's
 * courts also carry a youth fixture that morning, so the championship plans on four of the six. **Sunday
 * two**: the finals day exists to be watched, and a spectator cannot follow six courts at once — two
 * matches side by side on the best-watched courts is the day's shape. A soft bound, not the structural
 * court cap: the courts themselves already make "more matches than courts" impossible (`court-taken`),
 * while this is the organiser's judgement about the day and stays overridable.
 */
export const MAX_PARALLEL_MATCHES: readonly number[] = [4, 2]

/**
 * The peak number of matches on court at once while a candidate starting at `slot` is playing, itself
 * included — `starts` are the other same-day matches' start slots and `span` the number of slots a match
 * occupies. Every match is the same length on the same cadence, so sampling the candidate's own steps is
 * exact rather than an estimate. Counting *moments* is the point: pairwise overlap would over-count, since
 * two matches can each overlap the candidate without the three ever being on court together.
 */
export const peakParallelMatches = (starts: readonly number[], slot: number, span: number): number => {
  let peak = 0
  for (let step = 0; step < span; step++) {
    const moment = slot + step
    peak = Math.max(peak, starts.filter(s => s <= moment && moment < s + span).length + 1)
  }
  return peak
}

/**
 * The whole parallel-limit rule: the soft violation a candidate earns by making one match too many run at
 * once on `day`, or none. The rule lives here rather than in `validatePlacement` because the cap and the
 * arithmetic it is compared against are the same decision — a day with no configured cap is unbounded.
 */
export const parallelLimitViolation = (
  starts: readonly number[],
  day: number,
  slot: number,
  span: number
): SoftViolation | null => {
  const cap = MAX_PARALLEL_MATCHES[day]
  const peak = peakParallelMatches(starts, slot, span)
  return cap !== undefined && peak > cap ? { rule: 'parallel-limit', count: peak } : null
}
