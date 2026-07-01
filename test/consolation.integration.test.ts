import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CompetitionDraw, MatchScore } from '../shared'
import { app } from '../worker/app'
import { createDrawService } from '../worker/draw'
import { createInMemoryDrawStore } from '../worker/store/draw.memory'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// The consolation trigger (#92, ADR-0004): „Nebenrunde auslosen" is gated on „every first match decided",
// batch-draws the lost-their-first-match set through the shared draw procedure, and publishes it directly.
// The pure rules are covered in consolation.test.ts; here the worker orchestration (over the in-memory
// stores) and the full HTTP wiring (over a real local D1).

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

// ── Worker orchestration over the in-memory stores (no D1) ──────────────────────────────────────
describe('createDrawService.drawConsolation', () => {
  // A service over a fresh field, with enough scripted lot values for the main draw + the consolation.
  const setup = (n: number) => {
    const drawStore = createInMemoryDrawStore()
    const svc = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(field(n)),
      drawStore,
      randomSource: createFakeRandomSource(Array<number>(20).fill(0))
    })
    return { drawStore, svc }
  }

  // Decide every first-round main match by letting slot 1 win — enough for the consolation gate in a full
  // field (no byes, so the four round-1 losers are the whole entrant set).
  const decideFirstRound = async (drawStore: ReturnType<typeof createInMemoryDrawStore>) => {
    const r1 = (await drawStore.listMatches()).filter(m => m.bracket === 'main' && m.round === 1)
    for (const m of r1)
      await drawStore.recordResult(m.id, { winnerRegId: m.slot1RegId!, outcome: null, score: EMPTY_SCORE })
    return r1
  }

  it('draws the consolation from the round-1 losers once every first match is decided', async () => {
    const { drawStore, svc } = setup(8)
    await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    const r1 = await decideFirstRound(drawStore)
    const losers = r1.map(m => m.slot2RegId) // slot 1 won each, so slot 2 lost

    const result = await svc.drawConsolation({ competition: 'mens', now: 'now' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.draw.bracket).toBe('consolation')
    expect(result.draw.size).toBe(4) // four round-1 losers → a 4-draw
    // A consolation 4-draw is 3 KO matches — the consolation has NO third-place playoff (ADR-0004).
    expect(result.draw.matches).toHaveLength(3)
    expect(result.draw.matches.some(m => m.thirdPlace)).toBe(false)
    // Its slots reference exactly the round-1 losers, nobody else.
    const slotIds = new Set(result.draw.matches.flatMap(m => [m.slot1RegId, m.slot2RegId]).filter(x => x !== null))
    expect([...slotIds].sort((a, b) => a! - b!)).toEqual(losers.sort((a, b) => a! - b!))
    // Published directly: no reveal to play, so it reads as fully revealed (total 0).
    expect(result.draw.total).toBe(0)
  })

  it('refuses before the main bracket is drawn', async () => {
    const { svc } = setup(8)
    expect(await svc.drawConsolation({ competition: 'mens', now: 'now' })).toMatchObject({
      ok: false,
      error: 'main-not-drawn'
    })
  })

  it('has no consolation bracket at draw size 4', async () => {
    const { svc } = setup(4)
    await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    expect(await svc.drawConsolation({ competition: 'mens', now: 'now' })).toMatchObject({
      ok: false,
      error: 'no-consolation'
    })
  })

  it('blocks while the first matches are still being played', async () => {
    const { svc } = setup(8)
    await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    expect(await svc.drawConsolation({ competition: 'mens', now: 'now' })).toMatchObject({
      ok: false,
      error: 'first-matches-pending'
    })
  })

  it('refuses a re-run once the consolation is drawn (ADR-0026)', async () => {
    const { drawStore, svc } = setup(8)
    await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    await decideFirstRound(drawStore)
    expect((await svc.drawConsolation({ competition: 'mens', now: 'now' })).ok).toBe(true)
    expect(await svc.drawConsolation({ competition: 'mens', now: 'now' })).toMatchObject({
      ok: false,
      error: 'already-drawn'
    })
    expect(await drawStore.listDraws()).toHaveLength(2) // one main + one consolation, no duplicate
  })
})

// ── HTTP integration over a real local D1 ────────────────────────────────────────────────────────
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
const drawMain = (competition: string) =>
  req('/api/admin/draw', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ competition }) })
const drawConsolation = (competition: string) =>
  req('/api/admin/draw/consolation', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ competition }) })
// Slot 1 wins each round-1 match with a straight-sets score. A normal result now requires a legal, decisive
// score (ADR-0045) — a scoreless win would be a walkover — so this posts a real 2:0.
const recordResult = (id: number) =>
  req('/api/admin/match/result', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ id, winner: 1, outcome: null, score: { set1: [6, 0], set2: [6, 0], mtb: null } })
  })

describe('POST /api/admin/draw/consolation', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM registrations')
    await env.DB.exec('DELETE FROM matches')
    await env.DB.exec('DELETE FROM draws')
    await env.DB.exec('DELETE FROM app_state')
  })

  it('is blocked with the pending reason until the first matches are decided', async () => {
    for (let i = 1; i <= 8; i++) await seedConfirmed(i)
    await setPhase('tournament')
    await drawMain('mens')

    const res = await drawConsolation('mens')
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining('ersten Spiele')
    })
    const draws = await env.DB.prepare("SELECT COUNT(*) AS c FROM draws WHERE bracket = 'consolation'").first<{
      c: number
    }>()
    expect(draws?.c).toBe(0)
  })

  it('draws + persists the consolation once every first match is decided, and serves it as a second bracket', async () => {
    for (let i = 1; i <= 8; i++) await seedConfirmed(i)
    await setPhase('tournament')
    await drawMain('mens')

    // Decide all four round-1 matches (slot 1 wins each).
    const r1 = await env.DB.prepare("SELECT id FROM matches WHERE bracket = 'main' AND round = 1 ORDER BY id").all<{
      id: number
    }>()
    for (const row of r1.results) expect((await recordResult(row.id)).status).toBe(200)

    const res = await drawConsolation('mens')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true; draw: CompetitionDraw }
    expect(body.draw.bracket).toBe('consolation')
    expect(body.draw.size).toBe(4)
    expect(body.draw.matches).toHaveLength(3)

    const persisted = await env.DB.prepare("SELECT COUNT(*) AS c FROM matches WHERE bracket = 'consolation'").first<{
      c: number
    }>()
    expect(persisted?.c).toBe(3)

    // The draws overview now lists both brackets.
    const list = await req('/api/admin/draws', { headers: JSON_HEADERS })
    const listed = (await list.json()) as { draws: CompetitionDraw[] }
    expect(listed.draws.map(d => d.bracket).sort()).toEqual(['consolation', 'main'])

    // A re-run is refused as a conflict (409).
    expect((await drawConsolation('mens')).status).toBe(409)
  })
})
