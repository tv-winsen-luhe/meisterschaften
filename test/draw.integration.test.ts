import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CompetitionDraw } from '../shared'
import { app } from '../worker/app'
import { createDrawService } from '../worker/draw'
import { createInMemoryDrawStore } from '../worker/store/draw'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// A confirmed registration row for the in-memory store. The seeding LK is set so the strongest (1.0)
// sorts to seed 1; createdAt rises with the id so the tiebreak is stable.
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

// ── Worker orchestration over the in-memory stores (no D1) ──────────────────────────────────────
// The draw service is the wiring (guards + read + pure draw + atomic write); the bracket math is
// covered in draw.test.ts. Driving it through the in-memory stores proves the orchestration and the
// gates without a runtime.
describe('createDrawService.draw', () => {
  const service = (rows: RegistrationRow[], sequence: number[]) =>
    createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(rows),
      drawStore: createInMemoryDrawStore(),
      randomSource: createFakeRandomSource(sequence)
    })

  it('draws a full field and writes the bracket + draw record', async () => {
    const svc = service(field(8), [0, 0, 0, 0, 0])
    const result = await svc.draw({ competition: 'mens', phase: 'tournament', now: '2026-08-01T09:00:00.000Z' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draw.size).toBe(8)
    expect(result.draw.bracket).toBe('main')
    expect(result.draw.seeding).toHaveLength(2)
    expect(result.draw.matches).toHaveLength(7)
    // The materialized round-1 matches carry persisted ids and the slot references.
    const round1 = result.draw.matches.filter(m => m.round === 1)
    expect(round1).toHaveLength(4)
    expect(round1.every(m => m.id > 0 && m.slot1RegId !== null && m.slot2RegId !== null)).toBe(true)
  })

  it('seeds only this competition — confirmed rows of other fields are ignored', async () => {
    const rows = [...field(8), confirmed(9, { competition: 'womens' }), confirmed(10, { competition: 'womens' })]
    const result = await service(rows, [0, 0, 0, 0, 0]).draw({
      competition: 'mens',
      phase: 'tournament',
      now: 'now'
    })
    expect(result.ok && result.draw.size).toBe(8)
  })

  it('refuses outside the tournament phase', async () => {
    const result = await service(field(8), []).draw({ competition: 'mens', phase: 'signup', now: 'now' })
    expect(result).toMatchObject({ ok: false, error: 'not-tournament' })
  })

  it('refuses a re-draw once the competition is drawn (ADR-0026)', async () => {
    const drawStore = createInMemoryDrawStore()
    const svc = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(field(8)),
      drawStore,
      randomSource: createFakeRandomSource([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    })
    expect((await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })).ok).toBe(true)
    expect(await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })).toMatchObject({
      ok: false,
      error: 'AlreadyDrawn'
    })
  })

  it('draws a non-full field, filling it with byes and auto-resolving them (§31)', async () => {
    const result = await service(field(7), [0, 0, 0, 0]).draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draw.size).toBe(8)
    expect(result.draw.matches).toHaveLength(7)
    // The 7th entrant rounds up to an 8-draw with one bye, resolved at draw time (winner, no score).
    const byes = result.draw.matches.filter(m => m.outcome === 'bye')
    expect(byes).toHaveLength(1)
    expect(byes[0]).toMatchObject({ round: 1, outcome: 'bye' })
    expect(byes[0]?.winnerRegId).not.toBeNull()
  })

  it('refuses a full field whose size has no seed table yet (e.g. 4 — only 8/16 are supported)', async () => {
    const result = await service(field(4), []).draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    expect(result).toMatchObject({ ok: false, error: 'unsupported-size' })
  })

  it('refuses fewer than two confirmed entries', async () => {
    const result = await service(field(1), []).draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    expect(result).toMatchObject({ ok: false, error: 'too-few' })
  })
})

// ── HTTP integration over a real local D1 ────────────────────────────────────────────────────────
// Smoke over the full wiring (Hono → Zod → draw service → DrawStore → Drizzle → D1): the route gates,
// writes, and reads the bracket back. Auth is edge-only (ADR-0008), so there is none to test here.
const JSON_HEADERS = { 'content-type': 'application/json' }
const req = (path: string, init: RequestInit = {}) => app.request(path, init, env)

const seedConfirmed = (i: number, competition = 'mens') =>
  env.DB.prepare(
    `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, status, lk)
     VALUES (?, ?, ?, ?, 'TV Winsen', ?, 'confirmed', ?)`
  )
    .bind(`2026-06-${String(i).padStart(2, '0')}T10:00:00Z`, competition, `P${i}`, `Player${i}`, `p${i}@x.de`, `${i}.0`)
    .run()

const setPhase = (phase: string) =>
  req('/api/admin/phase', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ phase }) })

const draw = (competition: string) =>
  req('/api/admin/draw', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ competition }) })

describe('POST /api/admin/draw + GET /api/admin/draws', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM registrations')
    await env.DB.exec('DELETE FROM matches')
    await env.DB.exec('DELETE FROM draws')
    await env.DB.exec('DELETE FROM app_state')
  })

  it('refuses to draw before registration is closed', async () => {
    for (let i = 1; i <= 8; i++) await seedConfirmed(i)
    const res = await draw('mens')
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining('Anmeldeschluss') })
  })

  it('draws a full field, persists matches, and serves the bracket', async () => {
    for (let i = 1; i <= 8; i++) await seedConfirmed(i)
    await setPhase('tournament')

    const res = await draw('mens')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; draw: CompetitionDraw }
    expect(body.draw.size).toBe(8)
    expect(body.draw.matches).toHaveLength(7)

    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM matches').first<{ c: number }>()
    expect(count?.c).toBe(7)

    const list = await req('/api/admin/draws', { headers: JSON_HEADERS })
    const listed = (await list.json()) as { draws: CompetitionDraw[] }
    expect(listed.draws).toEqual([expect.objectContaining({ competition: 'mens', size: 8 })])
  })

  it('returns 409 on a re-draw of an already-drawn competition', async () => {
    for (let i = 1; i <= 8; i++) await seedConfirmed(i)
    await setPhase('tournament')
    expect((await draw('mens')).status).toBe(200)
    const second = await draw('mens')
    expect(second.status).toBe(409)
  })

  it('draws a non-full field, persisting the byes as resolved matches', async () => {
    for (let i = 1; i <= 7; i++) await seedConfirmed(i)
    await setPhase('tournament')

    const res = await draw('mens')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; draw: CompetitionDraw }
    expect(body.draw.size).toBe(8)
    expect(body.draw.matches).toHaveLength(7)

    const byes = await env.DB.prepare("SELECT COUNT(*) AS c FROM matches WHERE outcome = 'bye'").first<{ c: number }>()
    expect(byes?.c).toBe(1)
  })

  it('still rejects a field whose draw size has no seed table (e.g. 4) with 400', async () => {
    for (let i = 1; i <= 4; i++) await seedConfirmed(i)
    await setPhase('tournament')
    const res = await draw('mens')
    expect(res.status).toBe(400)
  })
})
