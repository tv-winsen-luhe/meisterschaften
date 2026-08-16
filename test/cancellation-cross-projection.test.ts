import { describe, expect, it } from 'vitest'
import { COMPETITION_SLUGS, type CompetitionSlug, type ParticipantsResponse, type PhaseResponse } from '../shared'
import { createApp } from '../worker/app'
import type { RegistrationRow } from '../worker/db/schema'
import { createInMemoryAppStateStore } from '../worker/store/app-state'
import { createInMemoryDrawStore } from '../worker/store/draw.memory'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import { createFakeRandomSource } from './fake-random'
import { createTestDeps } from './test-deps'

// The cross-projection invariant for competition cancellation (CONTEXT: Competition cancellation;
// ADR-0062 §4, ADR-0048). A cancelled competition is removed from **every** public wire server-side —
// this file seeds one that carries data on all of them at once (registrations, a drawn and fully
// revealed bracket, placed matches) and then asserts it is missing from each. Client-side hiding is how
// a surface gets forgotten, so the assertion is made against the served JSON, never a component.
//
// It is the same shape as the strength-redaction invariant, and it is here for the same reason: one
// signal every projection *reads* rather than re-derives cannot drift only if something checks all of
// them together. The endpoint-coverage guard at the bottom is the other half — it fails when a new
// public endpoint appears that this file does not drive.

const ENV = { PUBLIC_LIST_ENABLED: 'true' } as const
const JSON_HEADERS = { 'content-type': 'application/json' }

const confirmed = (id: number, competition: CompetitionSlug): RegistrationRow => ({
  id,
  createdAt: `2026-06-${String(id).padStart(2, '0')}T10:00:00.000Z`,
  updatedAt: null,
  competition,
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

// Both fields fully live: 4 confirmed entries each, drawn through the real admin routes, revealed to the
// end, every match placed on the grid and the plan published — so each competition is present on all four
// public wires before anything is cancelled. The cancellation is then set **on the store**, not through
// POST /api/admin/competition/cancel: that route refuses a drawn field (the operator's path is draw reset
// first, ADR-0062). Seeding the flag directly is what makes this a test of the *projections* — they must
// read the flag, not lean on the write-side guard that usually keeps the two apart.
const bothFieldsLive = async (cancelled: readonly CompetitionSlug[] = []) => {
  const registrationsStore = createInMemoryRegistrationsStore([
    ...[1, 2, 3, 4].map(id => confirmed(id, 'mens')),
    ...[5, 6, 7, 8].map(id => confirmed(id, 'womens'))
  ])
  const drawStore = createInMemoryDrawStore()
  const appStateStore = createInMemoryAppStateStore('tournament', true)
  const deps = createTestDeps({
    registrationsStore,
    drawStore,
    appStateStore,
    randomSource: createFakeRandomSource(Array<number>(40).fill(0))
  })
  const app = createApp(() => deps)
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }, ENV)

  for (const competition of ['mens', 'womens'] as const) {
    expect((await post('/api/admin/draw', { competition })).status).toBe(200)
    // Advance past the last step (the cursor is clamped at total) so the field reaches the live phase.
    for (let i = 0; i < 12; i++) await post('/api/admin/draw/advance', { competition, direction: 'forward' })
  }

  // Every match onto its own cell, so the schedule feed carries both competitions.
  const matches = await drawStore.listMatches()
  let cell = 0
  for (const m of matches) {
    await drawStore.placeMatch(m.id, { court: (cell % 4) + 1, day: 0, slot: Math.floor(cell / 4) })
    cell++
  }

  for (const competition of cancelled) await appStateStore.setCompetitionCancelled(competition, true)

  const get = async <T>(path: string): Promise<T> => {
    const res = await app.request(path, {}, ENV)
    expect(res.status).toBe(200)
    return (await res.json()) as T
  }

  return {
    app,
    participants: () => get<ParticipantsResponse>('/api/participants'),
    phase: () => get<PhaseResponse>('/api/phase'),
    draw: () => get<{ brackets: { competition: string }[] }>('/api/draw'),
    schedule: () => get<{ published: boolean; matches: { competition: string }[] }>('/api/schedule')
  }
}

describe('a cancelled competition is missing from every public wire (ADR-0062 §4)', () => {
  it('drops it from the participant list, the draws and the schedule feed at once', async () => {
    const wires = await bothFieldsLive(['womens'])

    // Teilnehmerliste: no name for a field that does not take place.
    const participantCompetitions = (await wires.participants()).participants.map(p => p.competition)
    expect(participantCompetitions).not.toContain('womens')
    expect(participantCompetitions).toContain('mens')

    // Public draws: the whole bracket is gone, in both of its phases.
    const drawCompetitions = (await wires.draw()).brackets.map(b => b.competition)
    expect(drawCompetitions).not.toContain('womens')
    expect(drawCompetitions).toContain('mens')

    // Spielplan / Live board: not one placed match survives.
    const scheduled = await wires.schedule()
    expect(scheduled.matches.map(m => m.competition)).not.toContain('womens')
    expect(scheduled.matches.some(m => m.competition === 'mens')).toBe(true)
  })

  it('carries the cancelled set on /api/phase — the one signal the surfaces read', async () => {
    const wires = await bothFieldsLive(['womens'])
    const phase = await wires.phase()
    expect(phase).toEqual({ phase: 'tournament', cancelledCompetitions: ['womens'] })
  })

  it('takes the whole event off the public wires when every competition is cancelled', async () => {
    // The degrade ADR-0062 accepts rather than special-cases: nothing left to show is a valid answer,
    // and it proves no projection keeps a field alive through some other join.
    const wires = await bothFieldsLive([...COMPETITION_SLUGS])
    expect((await wires.participants()).participants).toEqual([])
    expect((await wires.draw()).brackets).toEqual([])
    expect((await wires.schedule()).matches).toEqual([])
  })

  it('counter-proof: without a cancellation every wire is served unchanged', async () => {
    const wires = await bothFieldsLive()

    const { participants } = await wires.participants()
    expect(participants).toHaveLength(8)
    expect(new Set(participants.map(p => p.competition))).toEqual(new Set(['mens', 'womens']))

    const { brackets } = await wires.draw()
    expect(new Set(brackets.map(b => b.competition))).toEqual(new Set(['mens', 'womens']))

    const scheduled = await wires.schedule()
    expect(scheduled.published).toBe(true)
    expect(new Set(scheduled.matches.map(m => m.competition))).toEqual(new Set(['mens', 'womens']))

    expect(await wires.phase()).toEqual({ phase: 'tournament', cancelledCompetitions: [] })
  })
})

// The half that catches the *next* surface: the invariant above can only assert what it knows to drive.
// This enumerates the app's own public GET routes and fails when one appears that is not in the covered
// list — the moment a new public endpoint is added, someone has to decide whether a cancelled competition
// may travel on it, instead of it quietly shipping the field the other three wires withhold.
//
// Deliberately the **read** routes only: removal is a projection decision (ADR-0062 §4), so what this
// guards is what a visitor is served. The public write path is a separate question — a registration into
// a cancelled field is out of reach in practice, because cancelling belongs to the phases after signup and
// `signupOnly` already refuses POST /api/register there.
describe('every public endpoint is covered by the invariant', () => {
  const COVERED = ['/api/participants', '/api/phase', '/api/draw', '/api/schedule']

  it('knows every public GET route the app serves', async () => {
    const wires = await bothFieldsLive()
    const publicGets = [
      ...new Set(
        wires.app.routes
          .filter(r => r.method === 'GET' && r.path.startsWith('/api/') && !r.path.startsWith('/api/admin/'))
          .map(r => r.path)
      )
    ]
    expect(publicGets.sort()).toEqual([...COVERED].sort())
  })
})
