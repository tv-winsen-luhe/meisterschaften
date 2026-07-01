import { describe, expect, it } from 'vitest'
import { createDrawService } from '../worker/draw'
import { createProjections } from '../worker/projections'
import { createInMemoryAppStateStore } from '../worker/store/app-state'
import { createInMemoryDrawStore } from '../worker/store/draw.memory'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// The live-board result feed (issue #91): once play begins, the public schedule carries the current truth —
// a running match's **actual** live court (ADR-0032), and a finished match's winning slot, outcome, and set
// scores — so the board renders what happened without a second fetch. The by-day/by-court grouping and the
// competition filter are pure client-side views over this same feed, exercised in the browser; here we pin
// the wire the page reads.

const confirmed = (id: number): RegistrationRow => ({
  id,
  createdAt: `2026-06-0${id}T10:00:00.000Z`,
  updatedAt: null,
  competition: 'mens',
  firstName: `P${id}`,
  lastName: `Player${id}`,
  club: 'TV Winsen',
  email: `p${id}@x.de`,
  phone: null,
  note: null,
  playerId: null,
  lk: `${id}.0`,
  status: 'confirmed',
  ip: null
})

// A drawn 4-field (two semifinals + final), fully revealed and published, over the in-memory stores — the
// same setup as schedule.integration.test.ts, so the result assertions run against a real placed schedule.
const drawn = async () => {
  const drawStore = createInMemoryDrawStore()
  const registrationsStore = createInMemoryRegistrationsStore(Array.from({ length: 4 }, (_, i) => confirmed(i + 1)))
  const appStateStore = createInMemoryAppStateStore('tournament', true)
  const service = createDrawService({ registrationsStore, drawStore, randomSource: createFakeRandomSource([0]) })
  await service.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
  let r = await service.advance('mens', 'forward')
  while (r.ok && r.cursor < r.total) r = await service.advance('mens', 'forward')
  const projections = createProjections({ drawStore, registrationsStore, appStateStore })
  return { projections, drawStore }
}

describe('projections.schedule — live result (#91)', () => {
  it('switches a running match to its actual live court, not the planned one (ADR-0032)', async () => {
    const { projections, drawStore } = await drawn()
    const semi = (await drawStore.listMatches()).find(m => m.round === 1)!
    await drawStore.placeMatch(semi.id, { court: 2, day: 0, slot: 1 })
    // The match goes on a freed court (5), not the court it was planned on (2): the board must send the
    // spectator to where it is actually being played.
    await drawStore.setMatchStatus(semi.id, 'running', 5)

    const [row] = (await projections.schedule()).matches
    expect(row).toMatchObject({ court: 5, status: 'running' })
  })

  it('carries the winning slot, outcome, and set scores once a match is done', async () => {
    const { projections, drawStore } = await drawn()
    const semi = (await drawStore.listMatches()).find(m => m.round === 1)!
    await drawStore.placeMatch(semi.id, { court: 2, day: 0, slot: 1 })
    // Slot 1 wins in straight sets — the board bolds slot 1 and shows the score without a second fetch.
    await drawStore.recordResult(semi.id, {
      winnerRegId: semi.slot1RegId!,
      outcome: null,
      score: { set1: [6, 3], set2: [6, 4], mtb: null }
    })

    const row = (await projections.schedule()).matches.find(m => m.id === semi.id)!
    expect(row).toMatchObject({ status: 'done', winner: 1, outcome: null })
    expect(row.score).toEqual({ set1: [6, 3], set2: [6, 4], mtb: null })
  })

  it('reports a walkover as its outcome with no set scores', async () => {
    const { projections, drawStore } = await drawn()
    const semi = (await drawStore.listMatches()).find(m => m.round === 1)!
    await drawStore.placeMatch(semi.id, { court: 2, day: 0, slot: 1 })
    // Slot 2 advances by walkover — the winner is carried, the score stays all-null.
    await drawStore.recordResult(semi.id, {
      winnerRegId: semi.slot2RegId!,
      outcome: 'walkover',
      score: { set1: null, set2: null, mtb: null }
    })

    const row = (await projections.schedule()).matches.find(m => m.id === semi.id)!
    expect(row).toMatchObject({ status: 'done', winner: 2, outcome: 'walkover' })
    expect(row.score).toEqual({ set1: null, set2: null, mtb: null })
  })

  it('leaves winner null and the score empty for a not-yet-played match', async () => {
    const { projections, drawStore } = await drawn()
    const semi = (await drawStore.listMatches()).find(m => m.round === 1)!
    await drawStore.placeMatch(semi.id, { court: 2, day: 0, slot: 1 })

    const [row] = (await projections.schedule()).matches
    expect(row).toMatchObject({ status: 'planned', winner: null, outcome: null })
    expect(row.score).toEqual({ set1: null, set2: null, mtb: null })
  })
})
