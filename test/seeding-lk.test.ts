import { describe, expect, it } from 'vitest'
import {
  createInMemoryRosterSource,
  createSeedingLk,
  findRosterMatch,
  parseClubRoster,
  type RosterEntry,
  type RosterSource
} from '../worker/seeding-lk'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations'
import type { RegistrationRow } from '../worker/db/schema'

const entry = (overrides: Partial<RosterEntry>): RosterEntry => ({
  playerId: '12345678',
  lk: '12.3',
  firstName: 'Max',
  lastName: 'Muster',
  ...overrides
})

describe('parseClubRoster', () => {
  it('parses id, current LK and the "Lastname, Firstname" anchor per row', () => {
    const html = `
      <table>
        <tr><th>Pos</th><th>LK</th><th>Name</th></tr>
        <tr><td>12345678</td><td>LK 12,3</td><td><a href="#" id="e_12345678">Muster, Max</a></td></tr>
        <tr><td>87654321</td><td>LK 9,0</td><td><a href="#" id="e_87654321">Schmidt, Tim Moritz</a></td></tr>
      </table>`
    expect(parseClubRoster(html)).toEqual([
      { playerId: '12345678', lk: '12.3', lastName: 'Muster', firstName: 'Max' },
      { playerId: '87654321', lk: '9.0', lastName: 'Schmidt', firstName: 'Tim Moritz' }
    ])
  })

  it('takes the first LK in a row and ignores later dated Stichtags-LK values', () => {
    const html = `<tr><td>12345678</td><td>LK 12,3</td><td>LK 14,0</td><td><a id="e_1">Muster, Max</a></td></tr>`
    expect(parseClubRoster(html)[0].lk).toBe('12.3')
  })

  it('skips rows without an id, an LK or a parseable name', () => {
    const html = `
      <tr><th>header only</th></tr>
      <tr><td>12345678</td><td>no lk here</td><td><a id="e_1">Muster, Max</a></td></tr>
      <tr><td>87654321</td><td>LK 9,0</td><td>no anchor</td></tr>`
    expect(parseClubRoster(html)).toEqual([])
  })
})

describe('findRosterMatch', () => {
  const roster = [
    entry({ playerId: '11111111', firstName: 'Max', lastName: 'Muster' }),
    entry({ playerId: '22222222', firstName: 'Tim Moritz', lastName: 'Schmidt' })
  ]

  it('matches an exact name', () => {
    expect(findRosterMatch(roster, 'Max', 'Muster')?.playerId).toBe('11111111')
  })

  it('matches a first-name prefix token ("Tim" → "Tim Moritz")', () => {
    expect(findRosterMatch(roster, 'Tim', 'Schmidt')?.playerId).toBe('22222222')
  })

  it('is insensitive to diacritics ("Muller" → "Müller")', () => {
    expect(
      findRosterMatch([entry({ playerId: '33333333', lastName: 'Müller', firstName: 'Max' })], 'Max', 'Muller')
        ?.playerId
    ).toBe('33333333')
  })

  it('returns null when no last name matches', () => {
    expect(findRosterMatch(roster, 'Max', 'Unbekannt')).toBeNull()
  })

  it('returns null when the match is ambiguous', () => {
    const ambiguous = [
      entry({ playerId: '44444444', firstName: 'Tim', lastName: 'Schmidt' }),
      entry({ playerId: '55555555', firstName: 'Tim', lastName: 'Schmidt' })
    ]
    expect(findRosterMatch(ambiguous, 'Tim', 'Schmidt')).toBeNull()
  })
})

const row = (overrides: Partial<RegistrationRow>): RegistrationRow => ({
  id: 1,
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
  status: 'new',
  ip: null,
  ...overrides
})

describe('seedingLk · lookup', () => {
  const rosterSource = createInMemoryRosterSource({
    'TV Winsen': [entry({ playerId: '11111111', lk: '12.3', firstName: 'Max', lastName: 'Muster' })]
  })

  it('returns the nuLiga identity + LK for a unique match', async () => {
    const seedingLk = createSeedingLk({ rosterSource, store: createInMemoryRegistrationsStore() })
    expect(await seedingLk.lookup({ club: 'TV Winsen', firstName: 'Max', lastName: 'Muster' })).toEqual({
      playerId: '11111111',
      lk: '12.3'
    })
  })

  it('returns null for an unknown club or no match', async () => {
    const seedingLk = createSeedingLk({ rosterSource, store: createInMemoryRegistrationsStore() })
    expect(await seedingLk.lookup({ club: 'Unknown', firstName: 'Max', lastName: 'Muster' })).toBeNull()
    expect(await seedingLk.lookup({ club: 'TV Winsen', firstName: 'Nobody', lastName: 'Here' })).toBeNull()
  })
})

describe('seedingLk · matchOnRegister', () => {
  const rosterSource = createInMemoryRosterSource({
    'TV Winsen': [entry({ playerId: '11111111', lk: '12.3', firstName: 'Max', lastName: 'Muster' })]
  })

  it('fills player_id + LK on the row and returns the matched LK', async () => {
    const store = createInMemoryRegistrationsStore([row({ id: 7 })])
    const seedingLk = createSeedingLk({ rosterSource, store })

    const lk = await seedingLk.matchOnRegister(row({ id: 7 }))

    expect(lk).toBe('12.3')
    const persisted = await store.findActiveRegistration({
      email: 'max@example.com',
      lastName: 'Muster',
      competition: 'mens'
    })
    expect(persisted).toMatchObject({ playerId: '11111111', lk: '12.3' })
  })

  it('reports the current LK for an already-linked row but keeps the stored linkage', async () => {
    const store = createInMemoryRegistrationsStore([row({ id: 7, playerId: '99999999', lk: '8.0' })])
    const seedingLk = createSeedingLk({ rosterSource, store })

    // Name still matches the roster (fresh LK 12.3), but the row already has a player_id.
    const lk = await seedingLk.matchOnRegister(row({ id: 7, playerId: '99999999', lk: '8.0' }))

    expect(lk).toBe('12.3') // notifier sees the current nuLiga LK…
    const persisted = await store.findActiveRegistration({
      email: 'max@example.com',
      lastName: 'Muster',
      competition: 'mens'
    })
    expect(persisted).toMatchObject({ playerId: '99999999', lk: '8.0' }) // …stored linkage untouched
  })

  it('falls back to the stored LK when an already-linked row has no roster match', async () => {
    const linked = row({ id: 7, firstName: 'Nobody', lastName: 'Here', playerId: '99999999', lk: '8.0' })
    const store = createInMemoryRegistrationsStore([linked])
    const seedingLk = createSeedingLk({ rosterSource, store })

    expect(await seedingLk.matchOnRegister(linked)).toBe('8.0')
  })

  it('returns null and leaves an unlinked row untouched when there is no match', async () => {
    const store = createInMemoryRegistrationsStore([row({ id: 7, firstName: 'Nobody', lastName: 'Here' })])
    const seedingLk = createSeedingLk({ rosterSource, store })

    const lk = await seedingLk.matchOnRegister(row({ id: 7, firstName: 'Nobody', lastName: 'Here' }))

    expect(lk).toBeNull()
    const persisted = await store.findActiveRegistration({
      email: 'max@example.com',
      lastName: 'Here',
      competition: 'mens'
    })
    expect(persisted?.playerId).toBeNull()
  })
})

describe('seedingLk · syncAll', () => {
  const rosterSource = createInMemoryRosterSource({
    'TV Winsen': [
      entry({ playerId: '11111111', lk: '12.3', firstName: 'Max', lastName: 'Muster' }),
      entry({ playerId: '22222222', lk: '9.0', firstName: 'Erika', lastName: 'Example' })
    ],
    'TSV Winsen': [entry({ playerId: '33333333', lk: '7.5', firstName: 'Tom', lastName: 'Tsv' })]
  })

  it('refreshes linked rows, name-matches active unlinked rows, and skips inactive ones', async () => {
    const store = createInMemoryRegistrationsStore([
      // Linked row: LK refreshed from the roster.
      row({ id: 1, playerId: '33333333', club: 'TSV Winsen', firstName: 'Tom', lastName: 'Tsv', lk: '8.0' }),
      // Active unlinked row: name-matched and linked.
      row({ id: 2, club: 'TV Winsen', firstName: 'Max', lastName: 'Muster', status: 'confirmed' }),
      // Cancelled unlinked row: skipped (only active rows are name-matched).
      row({ id: 3, club: 'TV Winsen', firstName: 'Erika', lastName: 'Example', status: 'cancelled' }),
      // Active unlinked row with no roster match: untouched.
      row({ id: 4, club: 'TV Winsen', firstName: 'Nobody', lastName: 'Here', status: 'new' })
    ])
    const seedingLk = createSeedingLk({ rosterSource, store })

    const updated = await seedingLk.syncAll()

    expect(updated).toBe(2)
    const byId = new Map((await store.listAll()).map(r => [r.id, r]))
    expect(byId.get(1)).toMatchObject({ playerId: '33333333', lk: '7.5' })
    expect(byId.get(2)).toMatchObject({ playerId: '11111111', lk: '12.3' })
    expect(byId.get(3)).toMatchObject({ playerId: null, lk: null })
    expect(byId.get(4)).toMatchObject({ playerId: null, lk: null })
  })
})

describe('seedingLk · resolveLkOnConfirm', () => {
  const rosterSource = createInMemoryRosterSource({
    'TV Winsen': [entry({ playerId: '11111111', lk: '12.3', firstName: 'Max', lastName: 'Muster' })]
  })

  it('fetches the linked id LK, persists it, and returns it', async () => {
    const store = createInMemoryRegistrationsStore([row({ id: 7, playerId: '11111111', lk: null })])
    const seedingLk = createSeedingLk({ rosterSource, store })

    const lk = await seedingLk.resolveLkOnConfirm(row({ id: 7, playerId: '11111111', lk: null }))

    expect(lk).toBe('12.3')
    expect((await store.findById(7))?.lk).toBe('12.3')
  })

  it('returns null and never clobbers a stored LK when nuLiga has no rating for the id', async () => {
    const store = createInMemoryRegistrationsStore([row({ id: 7, playerId: '99999999', lk: '6.0' })])
    const seedingLk = createSeedingLk({ rosterSource, store })

    const lk = await seedingLk.resolveLkOnConfirm(row({ id: 7, playerId: '99999999', lk: '6.0' }))

    expect(lk).toBeNull()
    expect((await store.findById(7))?.lk).toBe('6.0') // prior rating left untouched
  })

  it('is a no-op returning null for a row with no linked player_id', async () => {
    const store = createInMemoryRegistrationsStore([row({ id: 7, playerId: null, lk: null })])
    const seedingLk = createSeedingLk({ rosterSource, store })

    expect(await seedingLk.resolveLkOnConfirm(row({ id: 7, playerId: null, lk: null }))).toBeNull()
  })

  it('swallows a nuLiga outage and returns null', async () => {
    const throwingSource: RosterSource = {
      rosterFor: async () => {
        throw new Error('nuLiga unreachable')
      }
    }
    const store = createInMemoryRegistrationsStore([row({ id: 7, playerId: '11111111', lk: '6.0' })])
    const seedingLk = createSeedingLk({ rosterSource: throwingSource, store })

    const lk = await seedingLk.resolveLkOnConfirm(row({ id: 7, playerId: '11111111', lk: '6.0' }))

    expect(lk).toBeNull()
    expect((await store.findById(7))?.lk).toBe('6.0')
  })
})
