import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { scheduleResponseSchema, type ScheduleResponse } from '../shared'
import { app } from '../worker/app'
import { createDrawService } from '../worker/draw'
import { createInMemoryDrawStore } from '../worker/store/draw'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// The schedule path (issue #88): the placement write + the public feed, end-to-end. The grid
// affordance is exercised in the React surface; here we prove the orchestration — draw, place, and the
// feed's name-join / feeder resolution — plus the HTTP wiring over a real local D1.

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

// ── Service over the in-memory stores ────────────────────────────────────────────────────────────
describe('createDrawService.schedule', () => {
  // A drawn 4-field (two semifinals + final) over the in-memory stores, plus the store so the test can
  // place matches directly. The full unseeded fill of a 4-draw is one lot step. By default the reveal is
  // played to the end (`cursor >= total`) so the schedule feed will emit the field at all (ADR-0036) —
  // these tests are about the placed/revealed schedule, not the suspense gate; pass `{ reveal: false }`
  // to hold the draw mid-reveal.
  const drawn = async ({ reveal = true } = {}) => {
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(field(4))
    const service = createDrawService({ registrationsStore, drawStore, randomSource: createFakeRandomSource([0]) })
    await service.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    if (reveal) {
      let r = await service.advance('mens', 'forward')
      while (r.ok && r.cursor < r.total) r = await service.advance('mens', 'forward')
    }
    return { service, drawStore, registrationsStore }
  }

  it('is empty until a match is placed', async () => {
    const { service } = await drawn()
    expect(await service.schedule()).toEqual([])
  })

  it('emits a placed semifinal with both players joined by name', async () => {
    const { service, drawStore } = await drawn()
    const semi = (await drawStore.listMatches()).find(m => m.round === 1)!
    await drawStore.placeMatch(semi.id, { court: 2, day: 0, slot: 1 })

    const schedule = await service.schedule()
    expect(schedule).toHaveLength(1)
    expect(schedule[0]).toMatchObject({
      court: 2,
      day: 0,
      slot: 1,
      status: 'planned',
      slot1: { kind: 'player' },
      slot2: { kind: 'player' }
    })
  })

  it('shows a placed final as feeders until its semifinals are decided', async () => {
    const { service, drawStore } = await drawn()
    const final = (await drawStore.listMatches()).find(m => m.round === 2)!
    await drawStore.placeMatch(final.id, { court: 1, day: 1, slot: 0 })

    const [row] = await service.schedule()
    // The final (M3) is fed by the two semifinals (M1, M2) — both undecided, so both slots are feeders.
    expect(row.slot1).toEqual({ kind: 'feeder', matchNumber: 1 })
    expect(row.slot2).toEqual({ kind: 'feeder', matchNumber: 2 })
  })

  it('serves an unresolvable feeder as „offen", and the whole feed still parses (ADR-0035)', async () => {
    const { drawStore, registrationsStore } = await drawn()
    const drawn1 = await drawStore.listMatches()
    const final = drawn1.find(m => m.round === 2)!
    const semi1 = drawn1.find(m => m.round === 1 && m.position === 0)! // feeds the final's slot 1
    await drawStore.placeMatch(final.id, { court: 1, day: 1, slot: 0 })

    // Simulate a feeder row hard-deleted under a frozen draw: the final is placed, but the semifinal
    // feeding its slot 1 no longer resolves. Pre-ADR-0035 this surfaced `matchNumber: 0` and the
    // schema parse 500'd the whole response; now the slot degrades to `unknown` and the feed serves.
    const holed = {
      ...drawStore,
      listMatches: async () => (await drawStore.listMatches()).filter(m => m.id !== semi1.id)
    }
    const service = createDrawService({
      registrationsStore,
      drawStore: holed,
      randomSource: createFakeRandomSource([0])
    })

    const matchesOut = await service.schedule()
    expect(matchesOut.find(m => m.id === final.id)!.slot1).toEqual({ kind: 'unknown' })
    // The strict wire contract still accepts the whole feed — the 500 is gone.
    expect(() => scheduleResponseSchema.parse({ matches: matchesOut })).not.toThrow()
  })

  it('serves a hard-deleted player as „offen", not the misleading „Freilos" line (ADR-0035)', async () => {
    const { drawStore, registrationsStore } = await drawn()
    const semi = (await drawStore.listMatches()).find(m => m.round === 1)!
    await drawStore.placeMatch(semi.id, { court: 2, day: 0, slot: 1 })

    // Simulate a confirmed player's registration hard-deleted under a frozen draw: the slot is filled by a
    // real regId, but the name no longer resolves. It must degrade to the same `unknown` („offen") as a
    // vanished feeder — never „Freilos", which in a later round would read as a free pass into it.
    const holed = {
      ...registrationsStore,
      revealPlayers: async (ids: number[]) => {
        const players = await registrationsStore.revealPlayers(ids)
        players.delete(semi.slot1RegId!)
        return players
      }
    }
    const service = createDrawService({
      registrationsStore: holed,
      drawStore,
      randomSource: createFakeRandomSource([0])
    })

    const [row] = await service.schedule()
    expect(row.slot1).toEqual({ kind: 'unknown' })
    expect(row.slot2).toMatchObject({ kind: 'player' }) // the surviving player still resolves
  })

  // The reveal-cursor gate (ADR-0036, issue #104): the public schedule must not leak a pairing ahead of
  // the on-stage reveal, the same suspense invariant publicDraws() enforces by slicing to the cursor.
  describe('honors the reveal cursor (ADR-0036)', () => {
    it('hides a placed main match while its draw is mid-reveal (cursor < total)', async () => {
      const { service, drawStore } = await drawn({ reveal: false })
      const semi = (await drawStore.listMatches()).find(m => m.round === 1)!
      await drawStore.placeMatch(semi.id, { court: 2, day: 0, slot: 1 })

      // Placed on the grid, but the draw show has not finished — the pairing stays server-side.
      expect(await service.schedule()).toEqual([])
    })

    it('hides a placed main match after its reveal is rewound below total', async () => {
      const { service, drawStore } = await drawn() // fully revealed
      const semi = (await drawStore.listMatches()).find(m => m.round === 1)!
      await drawStore.placeMatch(semi.id, { court: 2, day: 0, slot: 1 })
      expect(await service.schedule()).toHaveLength(1) // shown while fully revealed

      // The operator rewinds one lot — the bracket drops below `total` and its placed matches vanish again.
      await service.advance('mens', 'back')
      expect(await service.schedule()).toEqual([])
    })

    it('never gates the consolation bracket — it has no reveal show (ADR-0004)', async () => {
      // Main mid-reveal, with a placed main match (must hide) and a placed consolation match (must show).
      const { registrationsStore, drawStore } = await drawn({ reveal: false })
      const semi = (await drawStore.listMatches()).find(m => m.round === 1)!
      const placedMain = { ...semi, court: 2, day: 0, slot: 1 }
      const conso = { ...semi, id: 999, bracket: 'consolation' as const, court: 1, day: 0, slot: 0 }
      const holed = { ...drawStore, listMatches: async () => [placedMain, conso] }
      const service = createDrawService({
        registrationsStore,
        drawStore: holed,
        randomSource: createFakeRandomSource([0])
      })

      // The unrevealed main match is withheld; the consolation match — born public — is served.
      expect((await service.schedule()).map(m => m.id)).toEqual([999])
    })
  })
})

// ── HTTP integration over a real local D1 ────────────────────────────────────────────────────────
const JSON_HEADERS = { 'content-type': 'application/json' }
const req = (path: string, init: RequestInit = {}) => app.request(path, init, env)

const seedConfirmed = (i: number) =>
  env.DB.prepare(
    `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, status, lk)
     VALUES (?, 'mens', ?, ?, 'TV Winsen', ?, 'confirmed', ?)`
  )
    .bind(`2026-06-0${i}T10:00:00Z`, `P${i}`, `Player${i}`, `p${i}@x.de`, `${i}.0`)
    .run()

const setPhase = (phase: string) =>
  req('/api/admin/phase', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ phase }) })

const place = (body: unknown) =>
  req('/api/admin/match/place', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })

describe('POST /api/admin/match/place + GET /api/schedule', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM registrations')
    await env.DB.exec('DELETE FROM matches')
    await env.DB.exec('DELETE FROM draws')
    await env.DB.exec('DELETE FROM app_state')
  })

  // Play the reveal to the end so the schedule feed will emit the field at all (ADR-0036, #104).
  const revealFully = async (competition: string) => {
    let r = { cursor: 0, total: Number.POSITIVE_INFINITY }
    do {
      const res = await req('/api/admin/draw/advance', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ competition, direction: 'forward' })
      })
      r = (await res.json()) as { cursor: number; total: number }
    } while (r.cursor < r.total)
  }

  // Draw a 4-field over the real D1 so the test has real match rows to place, then reveal it fully so the
  // public schedule serves placed matches (the gate is exercised directly in the service tests above).
  const drawField = async () => {
    for (let i = 1; i <= 4; i++) await seedConfirmed(i)
    await setPhase('tournament')
    await req('/api/admin/draw', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ competition: 'mens' })
    })
    await revealFully('mens')
  }

  it('places a match, persists it, and serves it on the public schedule', async () => {
    await drawField()
    const matchId = (await env.DB.prepare('SELECT id FROM matches WHERE round = 1 ORDER BY position LIMIT 1').first<{
      id: number
    }>())!.id

    const res = await place({ id: matchId, placement: { court: 3, day: 0, slot: 2 } })
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT court, day, slot, status FROM matches WHERE id = ?').bind(matchId).first<{
      court: number
      day: number
      slot: number
      status: string
    }>()
    expect(row).toMatchObject({ court: 3, day: 0, slot: 2, status: 'planned' })

    const feed = (await (await req('/api/schedule')).json()) as ScheduleResponse
    expect(feed.matches).toHaveLength(1)
    expect(feed.matches[0]).toMatchObject({ id: matchId, court: 3, day: 0, slot: 2 })
  })

  it('moves a placed match to another cell', async () => {
    await drawField()
    const matchId = (await env.DB.prepare('SELECT id FROM matches WHERE round = 1 ORDER BY position LIMIT 1').first<{
      id: number
    }>())!.id
    await place({ id: matchId, placement: { court: 3, day: 0, slot: 2 } })
    await place({ id: matchId, placement: { court: 5, day: 1, slot: 4 } })

    const feed = (await (await req('/api/schedule')).json()) as ScheduleResponse
    expect(feed.matches[0]).toMatchObject({ court: 5, day: 1, slot: 4 })
  })

  it('clears a placed match back to the backlog (all null)', async () => {
    await drawField()
    const matchId = (await env.DB.prepare('SELECT id FROM matches WHERE round = 1 ORDER BY position LIMIT 1').first<{
      id: number
    }>())!.id
    await place({ id: matchId, placement: { court: 3, day: 0, slot: 2 } })
    const res = await place({ id: matchId, placement: null })
    expect(res.status).toBe(200)

    const feed = (await (await req('/api/schedule')).json()) as ScheduleResponse
    expect(feed.matches).toEqual([])
  })

  it('rejects a half-placement (court without day/slot) at the contract', async () => {
    await drawField()
    const matchId = (await env.DB.prepare('SELECT id FROM matches WHERE round = 1 ORDER BY position LIMIT 1').first<{
      id: number
    }>())!.id
    const res = await place({ id: matchId, placement: { court: 3 } })
    expect(res.status).toBe(400)
  })

  it('rejects an out-of-range court (only 6 courts)', async () => {
    await drawField()
    const matchId = (await env.DB.prepare('SELECT id FROM matches WHERE round = 1 ORDER BY position LIMIT 1').first<{
      id: number
    }>())!.id
    const res = await place({ id: matchId, placement: { court: 7, day: 0, slot: 0 } })
    expect(res.status).toBe(400)
  })

  // The hard guard (ADR-0033, #89): a placement that breaks the round dependency is rejected server-side
  // as the authority, and the match stays unplaced. Soft warnings (player load) are the grid's affordance
  // and never block here. (The pure rule set is exercised in test/schedule.test.ts.)
  it('rejects a final placed at or before its semifinal (round dependency), leaving it unplaced', async () => {
    await drawField()
    const semi = (await env.DB.prepare('SELECT id FROM matches WHERE round = 1 ORDER BY position LIMIT 1').first<{
      id: number
    }>())!.id
    const final = (await env.DB.prepare('SELECT id FROM matches WHERE round = 2 LIMIT 1').first<{ id: number }>())!.id

    await place({ id: semi, placement: { court: 1, day: 0, slot: 2 } })
    const res = await place({ id: final, placement: { court: 2, day: 0, slot: 2 } }) // same slot as its feeder
    expect(res.status).toBe(409)

    const row = await env.DB.prepare('SELECT court FROM matches WHERE id = ?')
      .bind(final)
      .first<{ court: number | null }>()
    expect(row?.court).toBeNull()
  })

  // Court occupancy is the other hard rule (ADR-0033): the server refuses a second match onto a
  // court+day+slot another match already holds, so the public schedule never shows two on one court.
  it('rejects a second match on an already-occupied court+day+slot', async () => {
    await drawField()
    const semis = await env.DB.prepare('SELECT id FROM matches WHERE round = 1 ORDER BY position').all<{ id: number }>()
    const [a, b] = semis.results.map(r => r.id)

    await place({ id: a, placement: { court: 4, day: 0, slot: 1 } })
    const res = await place({ id: b, placement: { court: 4, day: 0, slot: 1 } }) // same cell
    expect(res.status).toBe(409)

    const row = await env.DB.prepare('SELECT court FROM matches WHERE id = ?').bind(b).first<{ court: number | null }>()
    expect(row?.court).toBeNull()
  })
})
