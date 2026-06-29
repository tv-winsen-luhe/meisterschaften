import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ScheduleResponse } from '../shared'
import { app } from '../worker/app'
import { createDrawService } from '../worker/draw'
import { createProjections } from '../worker/projections'
import { createInMemoryAppStateStore } from '../worker/store/app-state'
import { createInMemoryDrawStore } from '../worker/store/draw'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// The schedule publish gate + reset (ADR-0041): the planned schedule is private until the operator
// publishes, and reset wipes placements back to the backlog while auto-unpublishing. The gate is a *plan*
// gate — a running/done match's live truth is served regardless. Split from schedule.integration.test.ts
// (one concern per file, both under the line cap).

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

const field = (n: number) => Array.from({ length: n }, (_, i) => confirmed(i + 1))

// ── Projection-level gate (in-memory stores) ──────────────────────────────────────────────────────
describe('projections.schedule · publish gate (ADR-0041)', () => {
  // A fully-revealed 4-field over the in-memory stores, with the publish flag seeded.
  const drawn = async (published: boolean) => {
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(field(4))
    const appStateStore = createInMemoryAppStateStore('tournament', published)
    const service = createDrawService({ registrationsStore, drawStore, randomSource: createFakeRandomSource([0]) })
    await service.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    let r = await service.advance('mens', 'forward')
    while (r.ok && r.cursor < r.total) r = await service.advance('mens', 'forward')
    return { drawStore, registrationsStore, appStateStore }
  }

  it('withholds a planned placement until published — published:false, no leak', async () => {
    const { drawStore, registrationsStore, appStateStore } = await drawn(false)
    const semi = (await drawStore.listMatches()).find(m => m.round === 1)!
    await drawStore.placeMatch(semi.id, { court: 2, day: 0, slot: 1 })

    const feed = await createProjections({ drawStore, registrationsStore, appStateStore }).schedule()
    expect(feed.published).toBe(false)
    expect(feed.matches).toEqual([])
  })

  it('serves the planned schedule once published', async () => {
    const { drawStore, registrationsStore, appStateStore } = await drawn(true)
    const semi = (await drawStore.listMatches()).find(m => m.round === 1)!
    await drawStore.placeMatch(semi.id, { court: 2, day: 0, slot: 1 })

    const feed = await createProjections({ drawStore, registrationsStore, appStateStore }).schedule()
    expect(feed.published).toBe(true)
    expect(feed.matches).toHaveLength(1)
  })

  it('serves a running match even while unpublished — the gate spares live truth (ADR-0032)', async () => {
    const { drawStore, registrationsStore, appStateStore } = await drawn(false)
    const semis = (await drawStore.listMatches()).filter(m => m.round === 1)
    const running = { ...semis[0], court: 3, day: 0, slot: 0, status: 'running' as const }
    const plannedSibling = { ...semis[1], court: 4, day: 0, slot: 0 } // stays 'planned' → withheld
    const holed = { ...drawStore, listMatches: async () => [running, plannedSibling] }

    const feed = await createProjections({ drawStore: holed, registrationsStore, appStateStore }).schedule()
    expect(feed.published).toBe(false)
    expect(feed.matches.map(m => m.id)).toEqual([running.id])
  })
})

// ── HTTP-level publish + reset (real local D1) ─────────────────────────────────────────────────────
const JSON_HEADERS = { 'content-type': 'application/json' }
const req = (path: string, init: RequestInit = {}) => app.request(path, init, env)

const seedConfirmed = (i: number) =>
  env.DB.prepare(
    `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, status, lk)
     VALUES (?, 'mens', ?, ?, 'TV Winsen', ?, 'confirmed', ?)`
  )
    .bind(`2026-06-0${i}T10:00:00Z`, `P${i}`, `Player${i}`, `p${i}@x.de`, `${i}.0`)
    .run()

const post = (path: string, body?: unknown) =>
  req(path, { method: 'POST', headers: JSON_HEADERS, ...(body ? { body: JSON.stringify(body) } : {}) })

const place = (body: unknown) => post('/api/admin/match/place', body)
const publish = () => post('/api/admin/schedule/publish')
const reset = () => post('/api/admin/schedule/reset')
const feed = async () => (await (await req('/api/schedule')).json()) as ScheduleResponse

describe('POST /api/admin/schedule/{publish,reset} + GET /api/schedule', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM registrations')
    await env.DB.exec('DELETE FROM matches')
    await env.DB.exec('DELETE FROM draws')
    await env.DB.exec('DELETE FROM app_state')
  })

  // Draw a 4-field over the real D1 and reveal it fully so placed matches can reach the public feed.
  const drawField = async () => {
    for (let i = 1; i <= 4; i++) await seedConfirmed(i)
    await post('/api/admin/phase', { phase: 'tournament' })
    await post('/api/admin/draw', { competition: 'mens' })
    let r = { cursor: 0, total: Number.POSITIVE_INFINITY }
    do {
      r = (await (await post('/api/admin/draw/advance', { competition: 'mens', direction: 'forward' })).json()) as {
        cursor: number
        total: number
      }
    } while (r.cursor < r.total)
  }

  const semiIds = async () =>
    (
      await env.DB.prepare('SELECT id FROM matches WHERE round = 1 ORDER BY position').all<{ id: number }>()
    ).results.map(r => r.id)

  it('GET /api/admin/schedule reports the publish flag (the operator’s lightweight read)', async () => {
    expect(await (await req('/api/admin/schedule')).json()).toEqual({ published: false })
    await publish()
    expect(await (await req('/api/admin/schedule')).json()).toEqual({ published: true })
  })

  it('gates the public feed until published, then serves the planned schedule', async () => {
    await drawField()
    const [a] = await semiIds()
    await place({ id: a, placement: { court: 3, day: 0, slot: 2 } })

    // Unpublished by default: the planned placement is withheld (no leak).
    expect(await feed()).toMatchObject({ published: false, matches: [] })

    // Publish reveals the whole plan in one action.
    const res = await publish()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, published: true })
    const after = await feed()
    expect(after.published).toBe(true)
    expect(after.matches.map(m => m.id)).toEqual([a])
  })

  it('reset clears planned placements, auto-unpublishes, and keeps the draw', async () => {
    await drawField()
    const [a, b] = await semiIds()
    await place({ id: a, placement: { court: 1, day: 0, slot: 0 } })
    await place({ id: b, placement: { court: 2, day: 0, slot: 0 } })
    await publish()

    const res = await reset()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, published: false })

    // The placements are cleared and the schedule is unpublished again.
    expect(await feed()).toMatchObject({ published: false, matches: [] })
    const placed = await env.DB.prepare('SELECT COUNT(*) AS c FROM matches WHERE court IS NOT NULL').first<{
      c: number
    }>()
    expect(placed?.c).toBe(0)
    // The draw + its three matches survive — reset never touches the bracket.
    expect((await env.DB.prepare('SELECT COUNT(*) AS c FROM matches').first<{ c: number }>())?.c).toBe(3)
    expect((await env.DB.prepare('SELECT COUNT(*) AS c FROM draws').first<{ c: number }>())?.c).toBe(1)
  })

  it('reset leaves a running/done match on its court (never erase where it was played)', async () => {
    await drawField()
    const [a, b] = await semiIds()
    await place({ id: a, placement: { court: 1, day: 0, slot: 0 } })
    await place({ id: b, placement: { court: 2, day: 0, slot: 0 } })
    // Simulate match A having started — status transitions land in #90; here we set it directly.
    await env.DB.prepare("UPDATE matches SET status = 'running' WHERE id = ?").bind(a).run()

    await reset()

    // The running match keeps its court; the still-planned one is cleared.
    expect(await env.DB.prepare('SELECT court, status FROM matches WHERE id = ?').bind(a).first()).toMatchObject({
      court: 1,
      status: 'running'
    })
    const bRow = await env.DB.prepare('SELECT court FROM matches WHERE id = ?')
      .bind(b)
      .first<{ court: number | null }>()
    expect(bRow?.court).toBeNull()
  })
})
