import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../worker/app'
import { createDrawService } from '../worker/draw'
import { createD1DrawStore, createInMemoryDrawStore } from '../worker/store/draw'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// The lot-by-lot reveal (ADR-0003, issue #70): the draw is precomputed atomically, then revealed lot
// step by lot step. Advancing is pure playback over the stored reveal sequence (it never re-rolls); the
// public bracket exposes that sequence + cursor with players joined in by name. The draw orchestration
// itself and the re-run guard live in draw.integration.test.ts; this file owns the reveal surface.

// A confirmed registration row for the in-memory store (LK rises with the id, so id 1 is the strongest
// seed; createdAt rises so the tiebreak is stable). Mirrors draw.integration.test.ts.
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

// ── advance over the in-memory store ─────────────────────────────────────────────────────────────
describe('createDrawService.advance', () => {
  // A drawn 8-field over a shared draw store, so advance has a reveal sequence to play (8 steps:
  // 2 fixed seeds + 6 unseeded). Returns the service so the test can step it.
  const drawnService = async () => {
    const drawStore = createInMemoryDrawStore()
    const svc = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(field(8)),
      drawStore,
      randomSource: createFakeRandomSource([0, 0, 0, 0, 0])
    })
    await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    return { svc, drawStore }
  }

  it('moves the cursor forward and reports the total, clamping at the end (idempotent)', async () => {
    const { svc } = await drawnService()
    expect(await svc.advance('mens', 'forward')).toEqual({ ok: true, cursor: 1, total: 8 })
    for (let i = 0; i < 10; i++) await svc.advance('mens', 'forward')
    // Forward past the last step is a no-op — the cursor sits at total, never beyond.
    expect(await svc.advance('mens', 'forward')).toEqual({ ok: true, cursor: 8, total: 8 })
  })

  it('rewinds and clamps at 0', async () => {
    const { svc } = await drawnService()
    await svc.advance('mens', 'forward')
    await svc.advance('mens', 'forward')
    expect(await svc.advance('mens', 'back')).toEqual({ ok: true, cursor: 1, total: 8 })
    expect(await svc.advance('mens', 'back')).toEqual({ ok: true, cursor: 0, total: 8 })
    // Back below 0 is a no-op.
    expect(await svc.advance('mens', 'back')).toEqual({ ok: true, cursor: 0, total: 8 })
  })

  it('is pure playback — advancing never re-rolls the bracket', async () => {
    const { svc, drawStore } = await drawnService()
    const before = await drawStore.getDraw('mens', 'main')
    await svc.advance('mens', 'forward')
    await svc.advance('mens', 'forward')
    const after = await drawStore.getDraw('mens', 'main')
    // The matches + seeding are byte-for-byte identical; only the cursor (not part of CompetitionDraw) moved.
    expect(after).toEqual(before)
    expect((await drawStore.getReveal('mens', 'main'))?.cursor).toBe(2)
  })

  it('refuses to advance a competition that was never drawn (NotDrawn)', async () => {
    const svc = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(field(8)),
      drawStore: createInMemoryDrawStore(),
      randomSource: createFakeRandomSource([])
    })
    expect(await svc.advance('mens', 'forward')).toMatchObject({ ok: false, error: 'NotDrawn' })
  })
})

describe('createDrawService.publicDraws', () => {
  it('is empty until a field is drawn', async () => {
    const svc = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(field(8)),
      drawStore: createInMemoryDrawStore(),
      randomSource: createFakeRandomSource([])
    })
    expect(await svc.publicDraws()).toEqual([])
  })

  it('withholds the unrevealed tail — at cursor 0 a drawn field publishes no steps', async () => {
    // The suspense is server-enforced: a drawn-but-unrevealed field exposes its size + total but not a
    // single player, so a spectator polling the endpoint cannot read the outcome ahead of the show.
    const drawStore = createInMemoryDrawStore()
    const svc = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(field(8)),
      drawStore,
      randomSource: createFakeRandomSource([0, 0, 0, 0, 0])
    })
    await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })

    const [draw] = await svc.publicDraws()
    expect(draw).toMatchObject({ competition: 'mens', size: 8, cursor: 0, total: 8 })
    expect(draw.steps).toEqual([])
  })

  it('exposes only the revealed prefix, with players joined by name + LK', async () => {
    const drawStore = createInMemoryDrawStore()
    const svc = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(field(8)),
      drawStore,
      randomSource: createFakeRandomSource([0, 0, 0, 0, 0])
    })
    await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    await svc.advance('mens', 'forward')
    await svc.advance('mens', 'forward')

    const [draw] = await svc.publicDraws()
    // Two lots revealed of eight: only those two steps are shipped, total still reports the full length.
    expect(draw).toMatchObject({ competition: 'mens', size: 8, cursor: 2, total: 8 })
    expect(draw.steps).toHaveLength(2)
    // The first step is seed 1 (the strongest LK, id 1) on the first line, joined to its name + LK.
    expect(draw.steps[0]).toEqual({
      kind: 'seed-fixed',
      position: 0,
      seed: 1,
      player: { firstName: 'P1', lastName: 'Player1', lk: '1.0' }
    })
    // Every shipped step carries a joined player (this full field has no byes).
    expect(draw.steps.every(s => s.player !== null)).toBe(true)
  })
})

// ── HTTP integration over a real local D1 ────────────────────────────────────────────────────────
// Smoke over the full reveal wiring (Hono → Zod → draw service → DrawStore → D1): the advance endpoint
// moves + persists the cursor, and the public GET serves the joined reveal. Auth is edge-only (ADR-0008).
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

const advance = (competition: string, direction: 'forward' | 'back') =>
  req('/api/admin/draw/advance', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ competition, direction })
  })

interface PublicDrawBody {
  draws: { competition: string; size: number; cursor: number; total: number; steps: { player: unknown }[] }[]
}

describe('POST /api/admin/draw/advance + GET /api/draw', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM registrations')
    await env.DB.exec('DELETE FROM matches')
    await env.DB.exec('DELETE FROM draws')
    await env.DB.exec('DELETE FROM app_state')
  })

  it('advances + rewinds the reveal cursor (pure playback), 404 before the draw exists', async () => {
    for (let i = 1; i <= 8; i++) await seedConfirmed(i)
    await setPhase('tournament')

    // No draw yet → advancing is a 404 (nothing to reveal).
    expect((await advance('mens', 'forward')).status).toBe(404)

    expect((await draw('mens')).status).toBe(200)
    const first = await advance('mens', 'forward')
    expect(first.status).toBe(200)
    expect((await first.json()) as { cursor: number; total: number }).toEqual({ ok: true, cursor: 1, total: 8 })

    const back = await advance('mens', 'back')
    expect((await back.json()) as { cursor: number }).toMatchObject({ cursor: 0 })

    // The cursor is persisted on the draw record — pure playback wrote nothing else.
    await advance('mens', 'forward')
    await advance('mens', 'forward')
    const cursor = await env.DB.prepare('SELECT reveal_cursor AS c FROM draws').first<{ c: number }>()
    expect(cursor?.c).toBe(2)
  })

  it('serves the public live bracket (GET /api/draw) with players joined and the cursor', async () => {
    for (let i = 1; i <= 8; i++) await seedConfirmed(i)
    await setPhase('tournament')
    expect((await draw('mens')).status).toBe(200)
    await advance('mens', 'forward')

    const res = await req('/api/draw')
    expect(res.status).toBe(200)
    const body = (await res.json()) as PublicDrawBody
    expect(body.draws).toHaveLength(1)
    const [draw0] = body.draws
    expect(draw0).toMatchObject({ competition: 'mens', size: 8, cursor: 1, total: 8 })
    // Only the one revealed lot is shipped (not the full eight) — the unrevealed tail stays server-side.
    expect(draw0.steps).toHaveLength(1)
    // The revealed step's player is joined from the registration row (name present, not just an id).
    expect(draw0.steps[0]?.player).toMatchObject({ lastName: expect.any(String) })
  })

  it('GET /api/draw is empty before any field is drawn', async () => {
    const res = await req('/api/draw')
    expect(res.status).toBe(200)
    expect((await res.json()) as { draws: unknown[] }).toEqual({ draws: [] })
  })

  it('fails loudly at the store seam on a malformed reveal_sequence column', async () => {
    // The reveal sequence now crosses back through the Store (the draw reveal show reads it), so a
    // malformed column must throw at the parse seam — not feed a wrong-looking reveal to the beamer.
    await env.DB.prepare(
      "INSERT INTO draws (competition, bracket, size, seeding, reveal_sequence, created_at) VALUES ('mens', 'main', 8, '[]', '[{\"kind\":\"nope\"}]', 'now')"
    ).run()

    const store = createD1DrawStore(env.DB)
    await expect(store.getReveal('mens', 'main')).rejects.toThrow()
  })
})
