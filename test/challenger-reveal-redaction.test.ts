import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../worker/app'
import { createDrawService } from '../worker/draw'
import { createProjections } from '../worker/projections'
import { createInMemoryAppStateStore } from '../worker/store/app-state'
import { createInMemoryDrawStore } from '../worker/store/draw.memory'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// Challenger strength redaction on the draw reveal wire (#166, ADR-0044). A protected Challenger field is
// seeded by LK internally (ADR-0043), but its strength must not leave the server on the public wire:
// publicDraws nulls each revealed step's lk + seed for an isChallengerField competition (defense in depth
// behind #155's client-side hiding), while operatorDraws — the beamer's full reveal, served under Access —
// keeps them so the draw show can run (ADR-0024). The seeded *structure* (kind, position, names) is
// deliberately kept (ADR-0044); the draw itself is untouched, only the projection.

// A confirmed registration row for the in-memory store. Mirrors draw-reveal.test.ts.
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

describe('projections — Challenger redaction (#166)', () => {
  // Four eligible Challenger entries (LK ≥ CHALLENGER_MIN_LK = 20, so the draw passes its cap guard),
  // weakest-LK-first ids so 21.0 seeds Nr. 1. A full 4-draw: 2 fixed seeds + 2 unseeded drawn (one lot).
  const challengerField = () =>
    [21, 22, 23, 24].map((lk, i) => confirmed(i + 1, { competition: 'mens-challenger', lk: `${lk}.0` }))

  const drawnChallenger = async () => {
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(challengerField())
    const svc = createDrawService({ registrationsStore, drawStore, randomSource: createFakeRandomSource([0]) })
    await svc.draw({ competition: 'mens-challenger', phase: 'tournament', now: 'now' })
    for (let i = 0; i < 4; i++) await svc.advance('mens-challenger', 'forward')
    return createProjections({ drawStore, registrationsStore, appStateStore: createInMemoryAppStateStore() })
  }

  it('publicDraws nulls lk + seed on every revealed step of a Challenger field, keeping the structure', async () => {
    const projections = await drawnChallenger()
    const [draw] = await projections.publicDraws()
    expect(draw).toMatchObject({ competition: 'mens-challenger', size: 4, cursor: 4, total: 4 })
    // The strength signals are dropped on every step …
    expect(draw.steps.every(s => s.seed === null)).toBe(true)
    expect(draw.steps.every(s => s.player === null || s.player.lk === null)).toBe(true)
    // … but the seeded structure survives: a seed line still carries its kind, position, and player name.
    expect(draw.steps[0]).toEqual({
      kind: 'seed-fixed',
      position: 0,
      seed: null,
      player: { firstName: 'P1', lastName: 'Player1', lk: null }
    })
  })

  it('operatorDraws keeps lk + seed intact — the beamer reads the full reveal', async () => {
    const projections = await drawnChallenger()
    const [draw] = await projections.operatorDraws()
    expect(draw.steps[0]).toEqual({
      kind: 'seed-fixed',
      position: 0,
      seed: 1,
      player: { firstName: 'P1', lastName: 'Player1', lk: '21.0' }
    })
    expect(draw.steps.some(s => s.seed !== null)).toBe(true)
    expect(draw.steps.some(s => s.player?.lk !== null)).toBe(true)
  })

  it('leaves a championship field untouched in publicDraws (lk + seed survive)', async () => {
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(field(8))
    const svc = createDrawService({
      registrationsStore,
      drawStore,
      randomSource: createFakeRandomSource([0, 0, 0, 0, 0])
    })
    await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    await svc.advance('mens', 'forward')
    const projections = createProjections({
      drawStore,
      registrationsStore,
      appStateStore: createInMemoryAppStateStore()
    })
    const [draw] = await projections.publicDraws()
    expect(draw.steps[0]).toEqual({
      kind: 'seed-fixed',
      position: 0,
      seed: 1,
      player: { firstName: 'P1', lastName: 'Player1', lk: '1.0' }
    })
  })
})

// ── HTTP integration over a real local D1: the wire-level split end to end ────────────────────────
const JSON_HEADERS = { 'content-type': 'application/json' }
const req = (path: string, init: RequestInit = {}) => app.request(path, init, env)

// The strength-bearing fields the redaction reads off a revealed step: the seed number and the joined
// player's LK (both nulled on the public wire for a Challenger field, kept on the admin reveal).
interface RevealPlayerBody {
  lastName: string
  lk: string | null
}
interface RevealStepBody {
  seed: number | null
  player: RevealPlayerBody
}
interface RevealBody {
  draws: { steps: RevealStepBody[] }[]
}

describe('GET /api/draw vs GET /api/admin/draw/reveal — Challenger wire split (#166, ADR-0044)', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM registrations')
    await env.DB.exec('DELETE FROM matches')
    await env.DB.exec('DELETE FROM draws')
    await env.DB.exec('DELETE FROM app_state')
  })

  const setPhase = (phase: string) =>
    req('/api/admin/phase', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ phase }) })
  const draw = (competition: string) =>
    req('/api/admin/draw', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ competition }) })
  const advance = (competition: string) =>
    req('/api/admin/draw/advance', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ competition, direction: 'forward' })
    })

  it('redacts Challenger lk + seed on the public wire, but the admin reveal keeps them', async () => {
    // Four eligible Challenger entries (LK ≥ CHALLENGER_MIN_LK = 20, weakest-LK-first so 21.0 is seed 1).
    for (let i = 1; i <= 4; i++) {
      await env.DB.prepare(
        `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, status, lk)
         VALUES (?, 'mens-challenger', ?, ?, 'TV Winsen', ?, 'confirmed', ?)`
      )
        .bind(`2026-06-0${i}T10:00:00Z`, `C${i}`, `Chal${i}`, `c${i}@x.de`, `${20 + i}.0`)
        .run()
    }
    await setPhase('tournament')
    expect((await draw('mens-challenger')).status).toBe(200)
    await advance('mens-challenger')

    const stepsOf = async (path: string) => {
      const res = await req(path)
      expect(res.status).toBe(200)
      const body = (await res.json()) as RevealBody
      return body.draws[0].steps
    }

    // Public wire (Access-free): the revealed seed line keeps its name but drops the strength signals.
    const [pub] = await stepsOf('/api/draw')
    expect(pub.player.lastName).toBe('Chal1')
    expect(pub.seed).toBeNull()
    expect(pub.player.lk).toBeNull()

    // Admin reveal (behind Access in prod; open on localhost): the beamer keeps the full LK + seed.
    const [adm] = await stepsOf('/api/admin/draw/reveal')
    expect(adm.seed).toBe(1)
    expect(adm.player.lk).toBe('21.0')
  })
})
