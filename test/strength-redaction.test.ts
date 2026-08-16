import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { redactLiveBracket, redactRevealDraw, strengthRedacted, COMPETITION_SLUGS } from '../shared'
import type { LiveBracket, PublicDraw } from '../shared'
import { app } from '../worker/app'
import { createDrawService } from '../worker/draw'
import { createProjections } from '../worker/projections'
import { createInMemoryAppStateStore } from '../worker/store/app-state'
import { createInMemoryDrawStore } from '../worker/store/draw.memory'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// Strength redaction across the public wire (CONTEXT: Strength redaction; ADR-0044, ADR-0048, ADR-0061).
// Two halves, and they are deliberately separate:
//
//   1. The **mechanism** — the two pure redactors in shared/redaction.ts. Tested directly, so it stays
//      correct and alive while no competition uses it (a future protected field flips one list entry).
//   2. The **decision** — which competitions are redacted. Today: none (ADR-0061). The cross-projection
//      invariant asserts that every public projection agrees with `strengthRedacted`, so the flag on the
//      wire and the values it describes can never drift — the enforcement ADR-0048 bought, now enforcing
//      the opposite answer.
//
// The Herren Challenger is therefore public in full: LK values and seed numbers on the participant list,
// the reveal and both bracket phases. The operator reveal keeps its own un-redacted route (ADR-0044) —
// today functionally identical to the public one, kept as the seam a protected field would need.

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

// ── 1. The mechanism: the pure redactors ──────────────────────────────────────────────────────────
describe('the strength redactors (shared/redaction.ts)', () => {
  it('redactRevealDraw nulls every step seed + player LK, keeps names and structure, and sets the flag', () => {
    const draw = {
      competition: 'mens-challenger',
      redacted: false,
      cursor: 2,
      total: 4,
      size: 4,
      steps: [
        { kind: 'seed-fixed', position: 0, seed: 1, player: { firstName: 'P1', lastName: 'Player1', lk: '21.0' } },
        { kind: 'bye', position: 1, seed: null, player: null }
      ]
    } as unknown as PublicDraw

    const redacted = redactRevealDraw(draw)
    expect(redacted.redacted).toBe(true)
    expect(redacted.steps.every(s => s.seed === null)).toBe(true)
    expect(redacted.steps.every(s => s.player === null || s.player.lk === null)).toBe(true)
    // The seeded structure survives — relative rank is the sanctioned signal, the absolute LK is not
    // (ADR-0044 §2): kind, position and the names stay put, and a bye line stays a bye line.
    expect(redacted.steps[0]).toMatchObject({ kind: 'seed-fixed', position: 0, player: { lastName: 'Player1' } })
    expect(redacted.steps[1]).toMatchObject({ kind: 'bye', position: 1, player: null })
    expect(redacted.cursor).toBe(2)
  })

  it('redactLiveBracket nulls every resolved player slot, leaves non-player slots alone', () => {
    const bracket = {
      redacted: false,
      matches: [
        {
          round: 1,
          position: 0,
          slot1: { kind: 'player', regId: 1, firstName: 'P1', lastName: 'Player1', lk: '21.0', seed: 1 },
          slot2: { kind: 'bye' }
        }
      ]
    } as unknown as LiveBracket

    const redacted = redactLiveBracket(bracket)
    expect(redacted.redacted).toBe(true)
    expect(redacted.matches[0].slot1).toMatchObject({ kind: 'player', lastName: 'Player1', lk: null, seed: null })
    expect(redacted.matches[0].slot2).toEqual({ kind: 'bye' })
  })
})

// ── 2. The decision: nobody is redacted today ─────────────────────────────────────────────────────
describe('strengthRedacted — the single switch (ADR-0061)', () => {
  it('is false for every competition, the Herren Challenger included', () => {
    for (const slug of COMPETITION_SLUGS) expect(strengthRedacted(slug)).toBe(false)
  })
})

describe('projections — the Challenger publishes its strength (ADR-0061)', () => {
  // Four eligible Challenger entries (LK ≥ CHALLENGER_MIN_LK = 20, so the draw passes its cap guard),
  // weakest-LK-first ids so 21.0 seeds Nr. 1. A full 4-draw: 2 fixed seeds + 2 unseeded drawn (one lot).
  const challengerField = () =>
    [21, 22, 23, 24].map((lk, i) => confirmed(i + 1, { competition: 'mens-challenger', lk: `${lk}.0` }))

  const drawnChallenger = async () => {
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(challengerField())
    const svc = createDrawService({ registrationsStore, drawStore, randomSource: createFakeRandomSource([0]) })
    await svc.draw({ competition: 'mens-challenger', phase: 'tournament', cancelled: false, now: 'now' })
    for (let i = 0; i < 4; i++) await svc.advance('mens-challenger', 'forward')
    return createProjections({ drawStore, registrationsStore, appStateStore: createInMemoryAppStateStore() })
  }

  it('publicDraws keeps lk + seed on a fully-revealed Challenger field', async () => {
    // Fully revealed → the live phase (ADR-0046). Every resolved player keeps the strength signals a
    // spectator needs to place the match against their own LK.
    const projections = await drawnChallenger()
    const [bracket] = await projections.publicDraws()
    expect(bracket.phase).toBe('live')
    if (bracket.phase !== 'live') return
    expect(bracket.main.redacted).toBe(false)
    const playerSlots = bracket.main.matches.flatMap(m => [m.slot1, m.slot2]).filter(s => s.kind === 'player')
    expect(playerSlots.length).toBeGreaterThan(0)
    expect(playerSlots.some(s => s.kind === 'player' && s.seed !== null)).toBe(true)
    expect(playerSlots.every(s => s.kind === 'player' && s.lk !== null)).toBe(true)
    const first = bracket.main.matches.find(m => m.round === 1 && m.position === 0)
    expect(first?.slot1).toMatchObject({ kind: 'player', firstName: 'P1', lastName: 'Player1', lk: '21.0' })
  })

  it('publicDraws keeps lk + seed on a still-revealing Challenger field — the draw is verifiable live', async () => {
    // The verifiability half of ADR-0061: while the show runs, the public reveal names the seed and
    // its LK, so „Nr. 1" is checkable against the field rather than asserted.
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(challengerField())
    const svc = createDrawService({ registrationsStore, drawStore, randomSource: createFakeRandomSource([0]) })
    await svc.draw({ competition: 'mens-challenger', phase: 'tournament', cancelled: false, now: 'now' })
    await svc.advance('mens-challenger', 'forward')
    const projections = createProjections({
      drawStore,
      registrationsStore,
      appStateStore: createInMemoryAppStateStore()
    })
    const [draw] = await projections.publicDraws()
    expect(draw.phase).toBe('revealing')
    if (draw.phase !== 'revealing') return
    expect(draw.redacted).toBe(false)
    expect(draw.steps[0]).toEqual({
      kind: 'seed-fixed',
      position: 0,
      seed: 1,
      player: { firstName: 'P1', lastName: 'Player1', lk: '21.0' }
    })
  })

  it('operatorDraws still serves the full reveal — the beamer route is unchanged (ADR-0044)', async () => {
    const projections = await drawnChallenger()
    const [draw] = await projections.operatorDraws()
    expect(draw.redacted).toBe(false)
    expect(draw.steps[0]).toEqual({
      kind: 'seed-fixed',
      position: 0,
      seed: 1,
      player: { firstName: 'P1', lastName: 'Player1', lk: '21.0' }
    })
  })

  it('leaves a championship field untouched in publicDraws (lk + seed survive)', async () => {
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(field(8))
    const svc = createDrawService({
      registrationsStore,
      drawStore,
      randomSource: createFakeRandomSource([0, 0, 0, 0, 0])
    })
    await svc.draw({ competition: 'mens', phase: 'tournament', cancelled: false, now: 'now' })
    await svc.advance('mens', 'forward')
    const projections = createProjections({
      drawStore,
      registrationsStore,
      appStateStore: createInMemoryAppStateStore()
    })
    const [draw] = await projections.publicDraws()
    expect(draw.phase).toBe('revealing')
    if (draw.phase !== 'revealing') return
    expect(draw.redacted).toBe(false)
    expect(draw.steps[0]).toEqual({
      kind: 'seed-fixed',
      position: 0,
      seed: 1,
      player: { firstName: 'P1', lastName: 'Player1', lk: '1.0' }
    })
  })
})

// ── The cross-projection invariant (ADR-0048, still enforced — with the opposite answer) ──────────
// Every public projection's `redacted` flag equals `strengthRedacted(competition)`, and the strength it
// carries agrees with that flag. This is what ADR-0048's prose-free enforcement is for: it caught a
// projection that forgot to redact, and it now catches one that forgets to *publish*. The de-overload it
// bought still holds — a not-yet-synced LK is `lk: null` with `redacted: false`, so a client renders
// „LK folgt" rather than a protected blank.
describe('strength redaction is one decision across public projections (ADR-0048)', () => {
  const drawnChampionship = async () => {
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(field(8))
    const svc = createDrawService({
      registrationsStore,
      drawStore,
      randomSource: createFakeRandomSource(Array(20).fill(0))
    })
    await svc.draw({ competition: 'mens', phase: 'tournament', cancelled: false, now: 'now' })
    // Advance past the last step (clamped at total) so the field is fully revealed → the live phase.
    for (let i = 0; i < 20; i++) await svc.advance('mens', 'forward')
    return createProjections({ drawStore, registrationsStore, appStateStore: createInMemoryAppStateStore() })
  }

  it('participant list: the Challenger is unredacted and carries LK + rank', async () => {
    // Asserted against the literal `false`, never against `strengthRedacted(p.competition)` — re-deriving
    // the expectation from the production predicate would pass even if this projection read the *wrong*
    // predicate, which is precisely the drift ADR-0048's invariant exists to catch.
    const store = createInMemoryRegistrationsStore(
      [21, 22, 23, 24].map((lk, i) => confirmed(i + 1, { competition: 'mens-challenger', lk: `${lk}.0` }))
    )
    const list = await store.listConfirmed()
    expect(list.length).toBe(4)
    expect(list.every(p => p.redacted === false)).toBe(true)
    expect(list.every(p => p.lk !== null)).toBe(true)
    // The relative-rank signal is unchanged by ADR-0061 — it was always public (ADR-0047); the LK value
    // now sits beside it, so the seed lines can be checked against the strengths that produced them.
    expect(list.some(p => p.seedRank !== null)).toBe(true)
  })

  it('participant list: a pending LK stays redacted:false (the de-overload survives)', async () => {
    const store = createInMemoryRegistrationsStore([
      confirmed(1, { competition: 'mens', lk: '10.0' }),
      confirmed(2, { competition: 'mens', lk: '11.0' }),
      confirmed(3, { competition: 'mens', lk: '12.0' }),
      confirmed(4, { competition: 'mens', lk: null }) // rated later — a genuine „LK folgt"
    ])
    const list = await store.listConfirmed()
    expect(list.every(p => p.redacted === false)).toBe(true)
    expect(list.filter(p => p.lk !== null).length).toBe(3)
    const pending = list.find(p => p.lk === null)
    expect(pending).toBeDefined()
    expect(pending?.redacted).toBe(false)
  })

  it('live bracket: a championship field is not redacted and keeps lk + seed', async () => {
    const projections = await drawnChampionship()
    const [bracket] = await projections.publicDraws()
    expect(bracket.phase).toBe('live')
    if (bracket.phase !== 'live') return
    expect(bracket.main.redacted).toBe(false)
    const playerSlots = bracket.main.matches.flatMap(m => [m.slot1, m.slot2]).filter(s => s.kind === 'player')
    expect(playerSlots.some(s => s.kind === 'player' && s.lk !== null)).toBe(true)
    expect(playerSlots.some(s => s.kind === 'player' && s.seed !== null)).toBe(true)
  })
})

// ── HTTP integration over a real local D1: the public wire end to end ─────────────────────────────
const JSON_HEADERS = { 'content-type': 'application/json' }
const req = (path: string, init: RequestInit = {}) => app.request(path, init, env)

// The strength-bearing fields a revealed step carries: the seed number and the joined player's LK.
interface RevealPlayerBody {
  lastName: string
  lk: string | null
}
interface RevealStepBody {
  seed: number | null
  player: RevealPlayerBody
}
// The public /api/draw feed is the two-phase bracket (`brackets`, a still-revealing member carrying steps);
// the operator /api/admin/draw/reveal keeps the reveal-only `draws` shape (ADR-0046 is public-only).
interface PublicRevealingBody {
  brackets: { redacted: boolean; steps: RevealStepBody[] }[]
}
interface OperatorRevealBody {
  draws: { redacted: boolean; steps: RevealStepBody[] }[]
}

describe('GET /api/draw — the Challenger reveal ships its strength (ADR-0061)', () => {
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

  it('serves Challenger lk + seed on the public wire, matching the admin reveal', async () => {
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

    // Public wire (Access-free): the revealed seed line carries its name, seed number and LK. Still
    // revealing (cursor 1 of 4), so the two-phase feed's `revealing` member carries the steps.
    const pubRes = await req('/api/draw')
    expect(pubRes.status).toBe(200)
    const pubBracket = ((await pubRes.json()) as PublicRevealingBody).brackets[0]
    expect(pubBracket.redacted).toBe(false)
    const [pub] = pubBracket.steps
    expect(pub.player.lastName).toBe('Chal1')
    expect(pub.seed).toBe(1)
    expect(pub.player.lk).toBe('21.0')

    // The admin reveal route still exists and still serves the full reveal — the seam a future protected
    // field needs (ADR-0044); today the two agree step for step.
    const admRes = await req('/api/admin/draw/reveal')
    expect(admRes.status).toBe(200)
    const admDraw = ((await admRes.json()) as OperatorRevealBody).draws[0]
    expect(admDraw.redacted).toBe(false)
    const [adm] = admDraw.steps
    expect(adm.seed).toBe(1)
    expect(adm.player.lk).toBe('21.0')
  })
})
