import { describe, expect, it } from 'vitest'
import { MAX_PARALLEL_MATCHES } from '../shared/court-plan'
import { SCHEDULE, SLOT_SPAN, validatePlacement } from '../shared/schedule'
import { suggestSchedule } from '../shared/suggest-schedule'
import type { Placement } from '../shared/schedule'

// The parallel-limit soft rule (ADR-0068): each event day carries a cap on how many championship matches
// may run at the same moment — Saturday four (the courts also hold a youth fixture), Sunday two (the
// finals day is there to be watched, and a spectator cannot follow six courts at once). Soft, because it
// is an organiser's judgement about the day's shape rather than a physical impossibility: the operator
// overrides it whenever a placement match is worth the third court. Kept in its own file beside
// evening-window.test.ts and finals-day.test.ts (one validator rule per file).

interface MatchOpts {
  p?: [number | null, number | null]
  at?: Placement
}

// A placeable „mens" round-1 match — distinct players per id, so only the rule under test can trip.
const pm = (id: number, position: number, { p, at }: MatchOpts = {}) => ({
  id,
  competition: 'mens',
  bracket: 'main',
  round: 1,
  position,
  slot1RegId: p?.[0] ?? id * 10,
  slot2RegId: p?.[1] ?? id * 10 + 1,
  outcome: null,
  court: at?.court ?? null,
  day: at?.day ?? null,
  slot: at?.slot ?? null
})

const SUNDAY = SCHEDULE.days - 1
const SUNDAY_CAP = MAX_PARALLEL_MATCHES[SUNDAY]

// `n` matches already sharing one start on Sunday, on distinct courts, plus the unplaced candidate.
const runningTogether = (n: number) => [
  ...Array.from({ length: n }, (_, i) => pm(i + 1, i, { at: { court: i + 1, day: SUNDAY, slot: 0 } })),
  pm(99, 9)
]

describe('validatePlacement — soft parallel-limit rule (ADR-0068)', () => {
  // Only this rule's verdict — a lone round-1 bracket also trips the unrelated finals-day nudge, and this
  // file is about the cap.
  const parallel = (soft: { rule: string }[]) => soft.filter(v => v.rule === 'parallel-limit')
  const candidateAt = (slot: number, matches: ReturnType<typeof pm>[]) =>
    parallel(validatePlacement(matches, { id: 99, placement: { court: SCHEDULE.courts, day: SUNDAY, slot } }).soft)

  it('stays quiet while the candidate only fills the day’s cap', () => {
    const soft = candidateAt(0, runningTogether(SUNDAY_CAP - 1))
    expect(soft).toEqual([])
  })

  it('warns once the candidate would make one match too many run at once', () => {
    const soft = candidateAt(0, runningTogether(SUNDAY_CAP))
    expect(soft).toContainEqual({ rule: 'parallel-limit', count: SUNDAY_CAP + 1 })
  })

  it('counts a partial overlap — a match that merely runs *into* the candidate’s 90 minutes', () => {
    // Two matches started one 30-minute step earlier are still on court when the candidate starts, so all
    // three are running together even though no two share a start.
    const staggered = [
      pm(1, 0, { at: { court: 1, day: SUNDAY, slot: 0 } }),
      pm(2, 1, { at: { court: 2, day: SUNDAY, slot: 1 } }),
      pm(99, 9)
    ]
    expect(candidateAt(2, staggered)).toContainEqual({ rule: 'parallel-limit', count: 3 })
  })

  it('does not count a match that has finished before the candidate starts', () => {
    const cleared = Array.from({ length: SUNDAY_CAP + 1 }, (_, i) =>
      pm(i + 1, i, { at: { court: i + 1, day: SUNDAY, slot: 0 } })
    )
    expect(candidateAt(SLOT_SPAN, [...cleared, pm(99, 9)])).toEqual([])
  })

  it('is per day — Saturday carries the wider cap', () => {
    const [saturdayCap] = MAX_PARALLEL_MATCHES
    expect(saturdayCap).toBeGreaterThan(SUNDAY_CAP)
    const wave = Array.from({ length: saturdayCap - 1 }, (_, i) =>
      pm(i + 1, i, { at: { court: i + 1, day: 0, slot: 0 } })
    )
    const { soft } = validatePlacement([...wave, pm(99, 9)], {
      id: 99,
      placement: { court: SCHEDULE.courts, day: 0, slot: 0 }
    })
    expect(parallel(soft)).toEqual([])
  })
})

describe('suggestSchedule — the cap shapes the day into waves (ADR-0068)', () => {
  it('never puts more than the day’s cap on court at once', () => {
    // Eight independent Sunday matches: with the cap at two, the fill spreads them across waves instead
    // of opening six courts at once, because it prefers warning-free cells.
    const matches = Array.from({ length: 8 }, (_, i) => pm(i + 1, i))
    const placed = suggestSchedule(matches)
    expect(placed).toHaveLength(matches.length)

    const perDay = new Map<string, number>()
    for (const { placement } of placed) {
      // Count every 30-minute step the match occupies; the peak of that tally is the parallel count.
      for (let step = 0; step < SLOT_SPAN; step++) {
        const key = `${placement.day}:${placement.slot + step}`
        perDay.set(key, (perDay.get(key) ?? 0) + 1)
      }
    }
    for (const [key, count] of perDay) {
      const day = Number(key.split(':')[0])
      expect(count).toBeLessThanOrEqual(MAX_PARALLEL_MATCHES[day])
    }
  })
})
