import { describe, expect, it } from 'vitest'
import { indexScheduleByNode, scheduleNodeKey } from '../shared/schedule'

// The public draw ↔ schedule join (#159): `indexScheduleByNode` keys placed matches by bracket topology
// — (competition, bracket, round, position) — so the public draw can annotate each matchup with its court
// and approximate time. Split from schedule.test.ts to stay under the file-length cap (one concern per
// file, the schedule.integration split's pattern). Pure, no deps.

// A scheduled bracket node: its topology address (competition+bracket+round+position) plus the grid cell
// it sits on — the wire `ScheduleMatch`'s shape, minus the fields the index does not read.
interface Cell {
  court: number
  day: number
  slot: number
}
const node = (competition: string, bracket: string, round: number, position: number, cell: Cell) => ({
  competition,
  bracket,
  round,
  position,
  ...cell
})

describe('indexScheduleByNode', () => {
  it('keys court + derived ca. time by (competition, bracket, round, position)', () => {
    // Court 3, Saturday slot 10 → 14:00 — the issue's „Platz 3 · Sa 14:00".
    const index = indexScheduleByNode([node('mens', 'main', 1, 0, { court: 3, day: 0, slot: 10 })])
    expect(index.get(scheduleNodeKey('mens', 'main', 1, 0))).toEqual({ court: 3, day: 0, time: '14:00' })
  })

  it('resolves multiple rounds, each at its own (round, position)', () => {
    // Two semifinals feed the final on the next day — a later round indexes the same way as round 1.
    const index = indexScheduleByNode([
      node('mens', 'main', 1, 0, { court: 1, day: 0, slot: 0 }), // 09:00
      node('mens', 'main', 1, 1, { court: 2, day: 0, slot: 2 }), // 10:00
      node('mens', 'main', 2, 0, { court: 5, day: 1, slot: 6 }) // Sunday 12:00
    ])
    expect(index.get(scheduleNodeKey('mens', 'main', 1, 0))).toMatchObject({ court: 1, time: '09:00' })
    expect(index.get(scheduleNodeKey('mens', 'main', 1, 1))).toMatchObject({ court: 2, time: '10:00' })
    expect(index.get(scheduleNodeKey('mens', 'main', 2, 0))).toMatchObject({ court: 5, day: 1, time: '12:00' })
  })

  it('yields no entry for a node the feed does not carry (unplaced or withheld)', () => {
    const index = indexScheduleByNode([node('mens', 'main', 1, 0, { court: 3, day: 0, slot: 10 })])
    expect(index.get(scheduleNodeKey('mens', 'main', 1, 1))).toBeUndefined() // a position never placed
    expect(index.get(scheduleNodeKey('womens', 'main', 1, 0))).toBeUndefined() // another competition
    expect(index.get(scheduleNodeKey('mens', 'consolation', 1, 0))).toBeUndefined() // another bracket
  })

  it('separates the same (round, position) across competitions and brackets', () => {
    const index = indexScheduleByNode([
      node('mens', 'main', 1, 0, { court: 1, day: 0, slot: 0 }),
      node('mens', 'consolation', 1, 0, { court: 2, day: 0, slot: 4 }),
      node('womens', 'main', 1, 0, { court: 3, day: 1, slot: 8 })
    ])
    expect(index.get(scheduleNodeKey('mens', 'main', 1, 0))).toMatchObject({ court: 1 })
    expect(index.get(scheduleNodeKey('mens', 'consolation', 1, 0))).toMatchObject({ court: 2 })
    expect(index.get(scheduleNodeKey('womens', 'main', 1, 0))).toMatchObject({ court: 3 })
  })
})
