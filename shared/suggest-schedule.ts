import {
  DAY_INDICES,
  isFinalsDayMatch,
  type Placement,
  SCHEDULE,
  type SchedulableMatch as PlacedMatch,
  validatePlacement
} from './schedule'

// The schedule auto-suggest (#122, ADR-0040, ADR-0033): a finals-day-shaped greedy fill of the backlog,
// built entirely on the shared `validatePlacement` authority so a suggestion can never commit a hard-
// invalid plan. Split from schedule.ts (the validator + grid math) so each stays within the file budget;
// it reads the very same `isFinalsDayMatch` predicate the validator's soft finals-day rule does, so the
// plan it builds and the warnings it raises can never disagree.

// One newly-suggested placement (a named interface — the lint rule forbids the inline `{…}[]` return).
export interface Suggestion {
  id: number
  placement: Placement
}

// The day a match targets first (ADR-0040): Sunday — the last event day, the finals day — for a main
// bracket's semifinals and final; Saturday for everything earlier and the whole consolation bracket. The
// fill tries this day first; only if it has no legal cell does it spill to the other day, so the
// finals-day shape holds without ever hard-blocking a day.
const targetDay = (match: PlacedMatch, matches: readonly PlacedMatch[]): number =>
  isFinalsDayMatch(match, matches) ? SCHEDULE.days - 1 : 0

// The first cell that takes a match, scanning the given days in order then slot-ascending, court-
// ascending. A warning-free cell (zero soft violations) wins outright; otherwise the first merely-legal
// cell is the fallback. Returns null when no day in `dayOrder` has a legal cell. Because the finals day
// is scanned first, even the fallback lands on the target day unless it is wholly full.
const firstValidPlacement = (
  working: readonly PlacedMatch[],
  id: number,
  dayOrder: readonly number[]
): Placement | null => {
  let fallback: Placement | null = null
  for (const day of dayOrder) {
    for (let slot = 0; slot < SCHEDULE.slotsPerDay; slot++) {
      for (let court = 1; court <= SCHEDULE.courts; court++) {
        const placement: Placement = { court, day, slot }
        const { hard, soft } = validatePlacement(working, { id, placement })
        if (hard.length > 0) continue
        if (soft.length === 0) return placement
        fallback ??= placement
      }
    }
  }
  return fallback
}

/**
 * Auto-suggest a finals-day-shaped draft schedule: fill unplaced matches into grid cells, respecting all
 * hard constraints (via `validatePlacement`) and preferring cells without soft warnings. Already-placed
 * matches are treated as fixed — never moved. Deterministic (no clock, no randomness): same input → same
 * plan. Returns only the newly suggested placements (the caller applies them as a draft).
 *
 * Algorithm: each unplaced match (round asc, position asc) targets a day — Saturday through the
 * quarterfinals plus the consolation bracket, Sunday for the semifinals/final (`targetDay`) — and is
 * placed in the first valid cell of that day (then the other day as a spill), preferring a warning-free
 * cell. The finals-day *soft* rule and this day ordering reinforce each other: a final scanned on Saturday
 * is never warning-free (the finals-day nudge), so it settles on Sunday on its own. A simple greedy fill,
 * not a global optimizer — per the issue spec (ADR-0040, ADR-0033).
 */
export const suggestSchedule = (matches: readonly PlacedMatch[]): Suggestion[] => {
  const result: Suggestion[] = []

  // Mutable working copy: as we suggest placements, we apply them so subsequent candidates see them.
  const working: PlacedMatch[] = matches.map(m => ({ ...m }))

  // Unplaced matches, sorted for deterministic greedy fill: round 1 first, then by position.
  const unplaced = working
    .filter(m => m.court === null && m.outcome !== 'bye')
    .sort((a, b) => a.round - b.round || a.position - b.position)

  for (const match of unplaced) {
    // The target day first, then the rest as a spill — so the finals-day shape holds but a full day never
    // strands a match in the backlog.
    const first = targetDay(match, working)
    const dayOrder = [first, ...DAY_INDICES.filter(d => d !== first)]
    const placement = firstValidPlacement(working, match.id, dayOrder)
    if (!placement) continue

    // Apply to the working set so subsequent matches see this cell as occupied.
    const idx = working.findIndex(m => m.id === match.id)
    working[idx] = { ...working[idx], court: placement.court, day: placement.day, slot: placement.slot }
    result.push({ id: match.id, placement })
  }

  return result
}
