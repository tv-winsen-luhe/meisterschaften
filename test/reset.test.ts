import { describe, expect, it } from 'vitest'
import { createInMemoryDrawStore, type SaveDrawInput } from '../worker/store/draw'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import { createInMemoryAppStateStore } from '../worker/store/app-state'
import { createResetService } from '../worker/reset'
import type { RegistrationRow } from '../worker/db/schema'

// The debug-reset machinery (ADR-0029): the store teardown ops and the orchestration that wires them
// into the three levers. Driven through the in-memory stores (no D1), like the draw service tests —
// the wiring (cascade vs guard, dependency order) is what is under test, not SQL.

// A minimal saved draw for one competition: one round-1 match, enough to prove the rows are written
// and then torn down. bracket defaults to 'main' (the only one this epic writes).
const drawInput = (competition: string, bracket: 'main' | 'consolation' = 'main'): SaveDrawInput => ({
  competition,
  bracket,
  size: 8,
  seeding: [{ seed: 1, playerId: 1, lk: '1.0' }],
  revealSequence: [{ kind: 'seed-fixed', position: 0, playerId: 1, seed: 1 }],
  matches: [{ round: 1, position: 0, slot1RegId: 1, slot2RegId: 2, winnerRegId: null, outcome: null }],
  challengerMinLk: null,
  createdAt: '2026-08-22T10:00:00.000Z'
})

let nextId = 1
const confirmed = (overrides: Partial<RegistrationRow> = {}): RegistrationRow => ({
  id: nextId++,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  competition: 'mens',
  firstName: 'Max',
  lastName: 'Muster',
  club: 'TV Winsen',
  email: `p${nextId}@x.de`,
  phone: null,
  note: null,
  playerId: null,
  lk: '10.0',
  status: 'confirmed',
  ip: null,
  ...overrides
})

describe('in-memory draw store · teardown', () => {
  it('deleteByCompetition removes the draw record + its matches and returns the count', async () => {
    const store = createInMemoryDrawStore()
    await store.save(drawInput('mens'))
    await store.save(drawInput('womens'))

    const removed = await store.deleteByCompetition('mens')

    expect(removed).toBe(1)
    expect(await store.getDraw('mens', 'main')).toBeNull()
    // The other competition is untouched — undraw is surgical, per competition.
    expect(await store.getDraw('womens', 'main')).not.toBeNull()
  })

  it('deleteByCompetition removes every bracket of the competition (main + consolation)', async () => {
    const store = createInMemoryDrawStore()
    await store.save(drawInput('mens', 'main'))
    await store.save(drawInput('mens', 'consolation'))

    expect(await store.deleteByCompetition('mens')).toBe(2)
    expect(await store.listDraws()).toEqual([])
  })

  it('deleteByCompetition on an undrawn competition is a no-op returning 0', async () => {
    const store = createInMemoryDrawStore()
    expect(await store.deleteByCompetition('mens')).toBe(0)
  })

  it('after deleteByCompetition the field can be drawn again (the unique index is freed)', async () => {
    const store = createInMemoryDrawStore()
    await store.save(drawInput('mens'))
    await store.deleteByCompetition('mens')
    // Re-saving would throw on the one-draw invariant if the row survived.
    await expect(store.save(drawInput('mens'))).resolves.toBeUndefined()
  })

  it('deleteAll clears every draw and match, returning the number of draws removed', async () => {
    const store = createInMemoryDrawStore()
    await store.save(drawInput('mens'))
    await store.save(drawInput('womens'))

    expect(await store.deleteAll()).toBe(2)
    expect(await store.listDraws()).toEqual([])
  })
})

describe('in-memory registrations store · readmitAllConfirmed', () => {
  it('moves every confirmed entry back to new and leaves new/cancelled untouched', async () => {
    const store = createInMemoryRegistrationsStore([
      confirmed({ status: 'confirmed', firstName: 'A' }),
      confirmed({ status: 'confirmed', firstName: 'B' }),
      confirmed({ status: 'new', firstName: 'C' }),
      confirmed({ status: 'cancelled', firstName: 'D' })
    ])

    const readmitted = await store.readmitAllConfirmed()

    expect(readmitted).toBe(2)
    const all = await store.listAll()
    const byName = (n: string) => all.find(r => r.firstName === n)!.status
    expect(byName('A')).toBe('new')
    expect(byName('B')).toBe('new')
    expect(byName('C')).toBe('new')
    expect(byName('D')).toBe('cancelled')
  })

  it('returns 0 when nothing is confirmed', async () => {
    const store = createInMemoryRegistrationsStore([confirmed({ status: 'new' })])
    expect(await store.readmitAllConfirmed()).toBe(0)
  })
})

describe('createResetService', () => {
  const service = (rows: RegistrationRow[] = []) => {
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(rows)
    const appStateStore = createInMemoryAppStateStore('tournament')
    return { svc: createResetService({ drawStore, registrationsStore, appStateStore }), drawStore, appStateStore }
  }

  it('undraw tears down one competition and reports the count', async () => {
    const { svc, drawStore } = service()
    await drawStore.save(drawInput('mens'))

    const result = await svc.undraw('mens')

    expect(result).toEqual({ ok: true, undrawn: 1 })
    expect(await drawStore.getDraw('mens', 'main')).toBeNull()
  })

  it('readmit refuses while any draw exists (the dependency guard)', async () => {
    const { svc, drawStore } = service([confirmed({ status: 'confirmed' })])
    await drawStore.save(drawInput('mens'))

    const result = await svc.readmit()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('DrawsExist')
  })

  it('readmit moves confirmed → new once no draw exists', async () => {
    const { svc } = service([confirmed({ status: 'confirmed' }), confirmed({ status: 'confirmed' })])

    const result = await svc.readmit()

    expect(result).toEqual({ ok: true, readmitted: 2 })
  })

  it('back-to-signup cascades an undraw, un-publishes the schedule, then sets the phase', async () => {
    const { svc, drawStore, appStateStore } = service([confirmed({ status: 'confirmed' })])
    await drawStore.save(drawInput('mens'))
    await drawStore.save(drawInput('womens'))
    // A schedule was published over the now-doomed draw; the teardown must clear the flag so the next
    // draw's placements do not leak past the publish gate (ADR-0041).
    await appStateStore.setSchedulePublished(true)

    const result = await svc.backToSignup()

    expect(result).toEqual({ ok: true, phase: 'signup', undrawn: 2 })
    expect(await drawStore.listDraws()).toEqual([])
    expect(await appStateStore.getPhase()).toBe('signup')
    expect(await appStateStore.getSchedulePublished()).toBe(false)
  })

  it('back-to-signup does not touch registration status (confirmed entries stay confirmed)', async () => {
    const rows = [confirmed({ status: 'confirmed' })]
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(rows)
    const appStateStore = createInMemoryAppStateStore('tournament')
    const svc = createResetService({ drawStore, registrationsStore, appStateStore })

    await svc.backToSignup()

    expect((await registrationsStore.listAll()).every(r => r.status === 'confirmed')).toBe(true)
  })
})
