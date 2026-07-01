import { describe, expect, it } from 'vitest'
import { createDrawService } from '../worker/draw'
import { createProjections } from '../worker/projections'
import { createInMemoryAppStateStore } from '../worker/store/app-state'
import { createInMemoryDrawStore } from '../worker/store/draw.memory'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { MatchScore } from '../shared'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// The public bracket's second phase (ADR-0046): once a competition is fully revealed, publicDraws stops
// shipping reveal steps and projects the **resolved matches aggregate** — winners advancing round by round
// to the champion (ADR-0025), the „Spiel um Platz 3", and the consolation bracket. The gate is full-reveal
// **only**, never the schedule publish flag: a recorded result is reality (ADR-0032), so it advances the
// bracket even with the plan unpublished (ADR-0041). The reveal half is owned by draw-reveal.test.ts; this
// file pins the live half of the switch.

const confirmed = (id: number, overrides: Partial<RegistrationRow> = {}): RegistrationRow => ({
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
  ip: null,
  ...overrides
})

const field = (n: number) => Array.from({ length: n }, (_, i) => confirmed(i + 1))
const EMPTY_SCORE: MatchScore = { set1: null, set2: null, mtb: null }

// A drawn, fully-revealed 8-field over the in-memory stores. `published` toggles the schedule publish flag
// — the live bracket must ignore it (ADR-0046), so tests can prove advancement with the plan withheld.
const drawn8 = async (published = false) => {
  const drawStore = createInMemoryDrawStore()
  const registrationsStore = createInMemoryRegistrationsStore(field(8))
  const appStateStore = createInMemoryAppStateStore('tournament', published)
  const svc = createDrawService({
    registrationsStore,
    drawStore,
    randomSource: createFakeRandomSource(Array<number>(20).fill(0))
  })
  await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
  let r = await svc.advance('mens', 'forward')
  while (r.ok && r.cursor < r.total) r = await svc.advance('mens', 'forward')
  const projections = createProjections({ drawStore, registrationsStore, appStateStore })
  return { projections, drawStore, svc }
}

const decideRound = async (drawStore: Awaited<ReturnType<typeof drawn8>>['drawStore'], round: number) => {
  const matches = (await drawStore.listMatches()).filter(
    m => m.bracket === 'main' && m.round === round && !m.thirdPlace && m.slot1RegId !== null && m.slot2RegId !== null
  )
  for (const m of matches)
    await drawStore.recordResult(m.id, { winnerRegId: m.slot1RegId!, outcome: null, score: EMPTY_SCORE })
}

describe('projections.publicDraws — live phase (ADR-0046)', () => {
  it('projects a fully-revealed field as a resolved live bracket, not reveal steps', async () => {
    const { projections } = await drawn8()
    const [live] = await projections.publicDraws()
    expect(live.phase).toBe('live')
    if (live.phase !== 'live') return
    expect(live.main).toMatchObject({ size: 8, totalRounds: 3 })
    // Not yet drawn: the consolation is absent (it appears the moment it is drawn, ADR-0004).
    expect(live.consolation).toBeNull()
    // Round 1 is the full field — every line a resolved player.
    const r1 = live.main.matches.filter(m => m.round === 1)
    expect(r1).toHaveLength(4)
    expect(r1.every(m => m.slot1.kind === 'player' && m.slot2.kind === 'player')).toBe(true)
    // Deeper rounds are undecided feeders („Sieger M{n}"), not the old hardcoded „?".
    const final = live.main.matches.find(m => m.round === 3 && !m.thirdPlace)
    expect(final?.slot1.kind).toBe('feeder')
    // The „Spiel um Platz 3" rides the main list, waiting on the semifinal *losers* („Verlierer M{n}").
    const third = live.main.matches.find(m => m.thirdPlace)
    expect(third?.slot1.kind).toBe('loser')
  })

  it('advances a recorded winner into the next round', async () => {
    const { projections, drawStore } = await drawn8()
    const target = (await drawStore.listMatches()).find(m => m.bracket === 'main' && m.round === 1)!
    await drawStore.recordResult(target.id, { winnerRegId: target.slot1RegId!, outcome: null, score: EMPTY_SCORE })

    const [live] = await projections.publicDraws()
    if (live.phase !== 'live') throw new Error('expected live phase')
    // The decided match flags its winning slot …
    const decided = live.main.matches.find(m => m.round === 1 && m.position === target.position)
    expect(decided?.winner).toBe(1)
    // … and the winner is now a resolved player in the parent slot (by position parity), no longer a feeder.
    const parent = live.main.matches.find(
      m => m.round === 2 && m.position === Math.floor(target.position / 2) && !m.thirdPlace
    )
    const advanced = target.position % 2 === 0 ? parent?.slot1 : parent?.slot2
    expect(advanced?.kind).toBe('player')
  })

  it('fills the third-place match with the two semifinal losers once the semis resolve', async () => {
    const { projections, drawStore } = await drawn8()
    await decideRound(drawStore, 1)
    await decideRound(drawStore, 2) // semifinals decided → each loser routed into „Spiel um Platz 3"

    const [live] = await projections.publicDraws()
    if (live.phase !== 'live') throw new Error('expected live phase')
    const third = live.main.matches.find(m => m.thirdPlace)
    expect(third?.slot1.kind).toBe('player')
    expect(third?.slot2.kind).toBe('player')
    // The final, too, now carries both semifinal winners.
    const final = live.main.matches.find(m => m.round === 3 && !m.thirdPlace)
    expect(final?.slot1.kind).toBe('player')
    expect(final?.slot2.kind).toBe('player')
  })

  it('advances even when the schedule is unpublished — the gate is full-reveal only, never the plan', async () => {
    const { projections, drawStore } = await drawn8(false)
    const target = (await drawStore.listMatches()).find(m => m.bracket === 'main' && m.round === 1)!
    await drawStore.recordResult(target.id, { winnerRegId: target.slot1RegId!, outcome: null, score: EMPTY_SCORE })

    const [live] = await projections.publicDraws()
    if (live.phase !== 'live') throw new Error('expected live phase')
    const parent = live.main.matches.find(
      m => m.round === 2 && m.position === Math.floor(target.position / 2) && !m.thirdPlace
    )
    const advanced = target.position % 2 === 0 ? parent?.slot1 : parent?.slot2
    // The winner advanced with the schedule still private — a result is reality (ADR-0032), not the plan.
    expect(advanced?.kind).toBe('player')
  })

  it('projects the consolation bracket once it is drawn (public immediately, no gate, ADR-0004)', async () => {
    const { projections, drawStore, svc } = await drawn8()
    await decideRound(drawStore, 1) // opens the consolation gate (every first match decided)
    expect((await svc.drawConsolation({ competition: 'mens', now: 'now' })).ok).toBe(true)

    const [live] = await projections.publicDraws()
    if (live.phase !== 'live') throw new Error('expected live phase')
    expect(live.consolation).not.toBeNull()
    expect(live.consolation?.size).toBe(4)
    // Its round-1 lines are the four first-round losers, resolved as players — and it carries no playoff.
    const cr1 = live.consolation!.matches.filter(m => m.round === 1)
    expect(cr1).toHaveLength(2)
    expect(cr1.every(m => m.slot1.kind === 'player' && m.slot2.kind === 'player')).toBe(true)
    expect(live.consolation!.matches.some(m => m.thirdPlace)).toBe(false)
  })
})
