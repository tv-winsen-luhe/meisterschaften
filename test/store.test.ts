import { describe, expect, it } from 'vitest'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import { createInMemoryDrawStore } from '../worker/store/draw'
import type { MatchSlots } from '../shared'
import type { RegistrationRow } from '../worker/db/schema'

let nextId = 1
const reg = (overrides: Partial<RegistrationRow>): RegistrationRow => {
  return {
    id: nextId++,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    competition: 'mens',
    firstName: 'Max',
    lastName: 'Muster',
    club: 'TV Winsen',
    email: 'max@example.com',
    phone: null,
    note: null,
    playerId: null,
    lk: null,
    status: 'confirmed',
    ip: null,
    ...overrides
  }
}

describe('in-memory registrations store · listConfirmed', () => {
  it('returns only confirmed entries, projected to the public contract shape', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ status: 'new', firstName: 'New' }),
      reg({ status: 'cancelled', firstName: 'Gone' }),
      reg({ status: 'confirmed', firstName: 'Real', lk: '12.0' })
    ])

    const list = await store.listConfirmed()

    expect(list).toEqual([
      { firstName: 'Real', lastName: 'Muster', club: 'TV Winsen', competition: 'mens', lk: '12.0' }
    ])
  })

  it('orders by competition, then seeding LK (null = 25.0), then created_at', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ competition: 'womens', lk: '9.0', firstName: 'W' }),
      reg({ competition: 'mens', lk: null, firstName: 'MensNoLk' }),
      reg({ competition: 'mens', lk: '11.5', firstName: 'MensStrong' }),
      reg({ competition: 'mens-challenger', lk: '22.0', firstName: 'Chall' })
    ])

    const order = (await store.listConfirmed()).map(p => `${p.competition}:${p.firstName}`)

    expect(order).toEqual(['mens:MensStrong', 'mens:MensNoLk', 'mens-challenger:Chall', 'womens:W'])
  })
})

describe('in-memory registrations store · write + lookup ops', () => {
  it('insert persists a new row with an id and status "new"', async () => {
    const store = createInMemoryRegistrationsStore()
    const inserted = await store.insert({
      createdAt: '2026-06-01T10:00:00.000Z',
      competition: 'mens',
      firstName: 'Max',
      lastName: 'Muster',
      club: 'TV Winsen',
      email: 'max@example.com',
      phone: null,
      note: null,
      ip: '1.2.3.4'
    })
    expect(inserted.id).toBeGreaterThan(0)
    expect(inserted).toMatchObject({ status: 'new', playerId: null, lk: null })
    const found = await store.findActiveRegistration({
      email: 'max@example.com',
      lastName: 'Muster',
      competition: 'mens'
    })
    expect(found?.id).toBe(inserted.id)
  })

  it('findActive / findCancelled distinguish by status and match case-insensitively', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ status: 'cancelled', email: 'a@x.de', lastName: 'Alpha' }),
      reg({ status: 'new', email: 'b@x.de', lastName: 'Beta' })
    ])
    expect(
      await store.findCancelledRegistration({ email: 'A@X.DE', lastName: 'alpha', competition: 'mens' })
    ).not.toBeNull()
    expect(await store.findActiveRegistration({ email: 'A@X.DE', lastName: 'alpha', competition: 'mens' })).toBeNull()
    expect(
      await store.findActiveRegistration({ email: 'b@x.de', lastName: 'Beta', competition: 'mens' })
    ).not.toBeNull()
  })

  it('revive flips a cancelled row to new, refreshes contact fields, keeps the linkage', async () => {
    const cancelled = reg({
      status: 'cancelled',
      firstName: 'Old',
      club: 'TSV Winsen',
      playerId: '12345678',
      lk: '15.0'
    })
    const store = createInMemoryRegistrationsStore([cancelled])
    const revived = await store.revive(cancelled.id, {
      createdAt: '2026-06-03T08:00:00.000Z',
      firstName: 'New',
      lastName: 'Muster',
      club: 'TV Winsen',
      phone: null,
      note: null,
      ip: null
    })
    expect(revived).toMatchObject({
      status: 'new',
      firstName: 'New',
      club: 'TV Winsen',
      playerId: '12345678',
      lk: '15.0'
    })
  })

  it('setMatch links player id + LK on a single row', async () => {
    const r = reg({ status: 'new', playerId: null, lk: null })
    const store = createInMemoryRegistrationsStore([r])
    await store.setMatch(r.id, '12345678', '11.5')
    const found = await store.findActiveRegistration({
      email: r.email,
      lastName: r.lastName,
      competition: r.competition
    })
    expect(found).toMatchObject({ playerId: '12345678', lk: '11.5' })
  })

  it('countRecentByIp counts only this IP after the cutoff', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ ip: '1.1.1.1', createdAt: '2026-06-01T10:00:00.000Z' }),
      reg({ ip: '1.1.1.1', createdAt: '2026-06-01T11:00:00.000Z' }),
      reg({ ip: '1.1.1.1', createdAt: '2026-06-01T08:00:00.000Z' }),
      reg({ ip: '2.2.2.2', createdAt: '2026-06-01T11:00:00.000Z' })
    ])
    expect(await store.countRecentByIp('1.1.1.1', '2026-06-01T09:00:00.000Z')).toBe(2)
  })
})

describe('in-memory registrations store · admin ops', () => {
  it('listAll returns every row regardless of status, ordered by status/competition/createdAt', async () => {
    const store = createInMemoryRegistrationsStore([
      reg({ status: 'new', competition: 'womens', createdAt: '2026-06-02T10:00:00.000Z', firstName: 'B' }),
      reg({ status: 'new', competition: 'mens', createdAt: '2026-06-01T10:00:00.000Z', firstName: 'A' }),
      reg({ status: 'cancelled', competition: 'mens', createdAt: '2026-06-01T09:00:00.000Z', firstName: 'C' })
    ])
    const order = (await store.listAll()).map(r => `${r.status}:${r.firstName}`)
    expect(order).toEqual(['cancelled:C', 'new:A', 'new:B'])
  })

  it('findById returns the row or null', async () => {
    const r = reg({ status: 'new' })
    const store = createInMemoryRegistrationsStore([r])
    expect((await store.findById(r.id))?.id).toBe(r.id)
    expect(await store.findById(999999)).toBeNull()
  })

  it('setFields applies only the given fields and returns the updated row', async () => {
    const r = reg({ status: 'new', competition: 'mens', club: 'TV Winsen', playerId: null, lk: null })
    const store = createInMemoryRegistrationsStore([r])
    const updated = await store.setFields(r.id, { competition: 'womens', club: 'TSV Winsen', lk: '12.0' })
    expect(updated).toMatchObject({ competition: 'womens', club: 'TSV Winsen', lk: '12.0', status: 'new' })
  })

  it('setStatus moves a row and returns it', async () => {
    const r = reg({ status: 'new' })
    const store = createInMemoryRegistrationsStore([r])
    expect((await store.setStatus(r.id, 'confirmed')).status).toBe('confirmed')
    expect((await store.findById(r.id))?.status).toBe('confirmed')
  })

  it('setLk sets or clears the LK in place', async () => {
    const r = reg({ status: 'confirmed', lk: '15.0' })
    const store = createInMemoryRegistrationsStore([r])
    await store.setLk(r.id, '11.5')
    expect((await store.findById(r.id))?.lk).toBe('11.5')
    await store.setLk(r.id, null)
    expect((await store.findById(r.id))?.lk).toBeNull()
  })

  it('remove deletes the row and reports the count', async () => {
    const r = reg({ status: 'new' })
    const store = createInMemoryRegistrationsStore([r])
    expect(await store.remove(r.id)).toBe(1)
    expect(await store.findById(r.id)).toBeNull()
    expect(await store.remove(r.id)).toBe(0)
  })
})

describe('in-memory draw store · schedule placement', () => {
  // A tiny 4-draw's worth of matches: two semifinals (round 1) + the final (round 2). The draw record
  // fields are irrelevant to placement, so they are minimal.
  const semis: MatchSlots[] = [
    { round: 1, position: 0, slot1RegId: 1, slot2RegId: 2, winnerRegId: null, outcome: null },
    { round: 1, position: 1, slot1RegId: 3, slot2RegId: 4, winnerRegId: null, outcome: null },
    { round: 2, position: 0, slot1RegId: null, slot2RegId: null, winnerRegId: null, outcome: null }
  ]
  const drawn = async () => {
    const store = createInMemoryDrawStore()
    await store.save({
      competition: 'mens',
      bracket: 'main',
      size: 4,
      seeding: [],
      revealSequence: [],
      matches: semis,
      challengerMinLk: null,
      createdAt: 'now'
    })
    return store
  }

  it('lists freshly drawn matches as unscheduled and planned', async () => {
    const store = await drawn()
    const all = await store.listMatches()
    expect(all).toHaveLength(3)
    expect(all.every(m => m.court === null && m.day === null && m.slot === null && m.status === 'planned')).toBe(true)
  })

  it('placeMatch sets the court + slot of one match, leaving the others untouched', async () => {
    const store = await drawn()
    const [first] = await store.listMatches()
    await store.placeMatch(first.id, { court: 3, day: 0, slot: 1 })

    const placed = (await store.listMatches()).find(m => m.id === first.id)
    expect(placed).toMatchObject({ court: 3, day: 0, slot: 1 })
    const others = (await store.listMatches()).filter(m => m.id !== first.id)
    expect(others.every(m => m.court === null)).toBe(true)
  })

  it('placeMatch moves a placed match to another cell', async () => {
    const store = await drawn()
    const [first] = await store.listMatches()
    await store.placeMatch(first.id, { court: 3, day: 0, slot: 1 })
    await store.placeMatch(first.id, { court: 5, day: 1, slot: 4 })
    expect((await store.listMatches()).find(m => m.id === first.id)).toMatchObject({ court: 5, day: 1, slot: 4 })
  })

  it('placeMatch with null clears a match back to the backlog', async () => {
    const store = await drawn()
    const [first] = await store.listMatches()
    await store.placeMatch(first.id, { court: 3, day: 0, slot: 1 })
    await store.placeMatch(first.id, null)
    expect((await store.listMatches()).find(m => m.id === first.id)).toMatchObject({
      court: null,
      day: null,
      slot: null
    })
  })
})
