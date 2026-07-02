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

// Challenger strength redaction on the public bracket wire (#166, ADR-0044, ADR-0046). A protected
// Challenger field is seeded by LK internally (ADR-0043), but its strength must not leave the server on the
// public wire — in **both** phases of the two-phase bracket (ADR-0046): publicDraws nulls each revealed
// step's lk + seed while revealing, and each resolved player slot's lk + seed once live (defense in depth
// behind #155's client-side hiding). operatorDraws — the beamer's full reveal, served under Access — keeps
// them so the draw show can run (ADR-0024). The seeded *structure* (kind, position, names) is deliberately
// kept (ADR-0044); the draw itself is untouched, only the projection.

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

  it('publicDraws nulls lk + seed on a fully-revealed Challenger field, keeping names + structure', async () => {
    // Fully revealed → the live phase (ADR-0046): the redaction now applies to the resolved bracket's player
    // slots, not reveal steps. Every player drops its strength signals; the names + bracket structure stay.
    const projections = await drawnChallenger()
    const [bracket] = await projections.publicDraws()
    expect(bracket.phase).toBe('live')
    if (bracket.phase !== 'live') return
    // The decision travels with its after-effect (ADR-0048): the bracket carries `redacted: true`.
    expect(bracket.main.redacted).toBe(true)
    const playerSlots = bracket.main.matches.flatMap(m => [m.slot1, m.slot2]).filter(s => s.kind === 'player')
    expect(playerSlots.length).toBeGreaterThan(0)
    expect(playerSlots.every(s => s.kind === 'player' && s.seed === null)).toBe(true)
    expect(playerSlots.every(s => s.kind === 'player' && s.lk === null)).toBe(true)
    // … but the names survive: seed 1 (id 1, LK 21) still sits on the first line, named.
    const first = bracket.main.matches.find(m => m.round === 1 && m.position === 0)
    expect(first?.slot1).toMatchObject({ kind: 'player', firstName: 'P1', lastName: 'Player1' })
  })

  it('publicDraws nulls lk + seed on a still-revealing Challenger field, keeping the reveal structure', async () => {
    // While revealing, the redaction still nulls each revealed step's seed + player LK (ADR-0044), keeping
    // the seeded structure — the phase-one half of the two-phase redaction.
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(challengerField())
    const svc = createDrawService({ registrationsStore, drawStore, randomSource: createFakeRandomSource([0]) })
    await svc.draw({ competition: 'mens-challenger', phase: 'tournament', now: 'now' })
    await svc.advance('mens-challenger', 'forward')
    const projections = createProjections({
      drawStore,
      registrationsStore,
      appStateStore: createInMemoryAppStateStore()
    })
    const [draw] = await projections.publicDraws()
    expect(draw.phase).toBe('revealing')
    if (draw.phase !== 'revealing') return
    expect(draw.redacted).toBe(true)
    expect(draw.steps.every(s => s.seed === null)).toBe(true)
    expect(draw.steps.every(s => s.player === null || s.player.lk === null)).toBe(true)
    expect(draw.steps[0]).toEqual({
      kind: 'seed-fixed',
      position: 0,
      seed: null,
      player: { firstName: 'P1', lastName: 'Player1', lk: null }
    })
  })

  it('operatorDraws keeps lk + seed intact and never redacts — the beamer reads the full reveal', async () => {
    const projections = await drawnChallenger()
    const [draw] = await projections.operatorDraws()
    // The operator wire never redacts, even for a Challenger field (ADR-0024): the flag stays false and the
    // strength is intact, so the beamer draw show can run.
    expect(draw.redacted).toBe(false)
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

// ── The cross-projection strength-redaction invariant (ADR-0048) ──────────────────────────────────
// One decision, enforced across every public projection — the load-bearing deliverable of #176. A
// protected field emits no LK value and no seed number and carries `redacted: true`; a championship field
// carries `redacted: false` with its strength intact; and — the de-overload the flag buys — a not-yet-synced
// championship LK is `lk: null` but `redacted: false`, so a client can tell „LK folgt" from a withheld
// rating. This single invariant replaces the per-surface `isChallengerField` guards the public clients used
// to run (the participant list + the draw bracket). The reveal/live dimensions are covered above; this block
// adds the participant list and the pending-LK de-overload, plus a championship live bracket for symmetry.
describe('strength redaction is one decision across public projections (ADR-0048)', () => {
  const drawnChampionship = async () => {
    const drawStore = createInMemoryDrawStore()
    const registrationsStore = createInMemoryRegistrationsStore(field(8))
    const svc = createDrawService({
      registrationsStore,
      drawStore,
      randomSource: createFakeRandomSource(Array(20).fill(0))
    })
    await svc.draw({ competition: 'mens', phase: 'tournament', now: 'now' })
    // Advance past the last step (clamped at total) so the field is fully revealed → the live phase.
    for (let i = 0; i < 20; i++) await svc.advance('mens', 'forward')
    return createProjections({ drawStore, registrationsStore, appStateStore: createInMemoryAppStateStore() })
  }

  it('participant list: a Challenger field is redacted (lk null, redacted true) but keeps its relative rank', async () => {
    const store = createInMemoryRegistrationsStore(
      [21, 22, 23, 24].map((lk, i) => confirmed(i + 1, { competition: 'mens-challenger', lk: `${lk}.0` }))
    )
    const list = await store.listConfirmed()
    expect(list.length).toBe(4)
    expect(list.every(p => p.redacted === true)).toBe(true)
    expect(list.every(p => p.lk === null)).toBe(true)
    // The relative-rank signal survives redaction (ADR-0047): the LK-strongest still carry a seedRank, so the
    // pre-draw preview can place them on the seed lines without ever exposing the withheld LK.
    expect(list.some(p => p.seedRank !== null)).toBe(true)
  })

  it('participant list: a championship field is not redacted, and a pending LK stays redacted:false (the de-overload)', async () => {
    const store = createInMemoryRegistrationsStore([
      confirmed(1, { competition: 'mens', lk: '10.0' }),
      confirmed(2, { competition: 'mens', lk: '11.0' }),
      confirmed(3, { competition: 'mens', lk: '12.0' }),
      confirmed(4, { competition: 'mens', lk: null }) // rated later — a genuine „LK folgt", not a withheld one
    ])
    const list = await store.listConfirmed()
    expect(list.every(p => p.redacted === false)).toBe(true)
    // The rated rows keep their LK on the wire (a championship field advertises strength).
    expect(list.filter(p => p.lk !== null).length).toBe(3)
    // The pending row: lk null AND redacted false — a client renders „LK folgt", never a protected blank.
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
// The public /api/draw feed is the two-phase bracket (`brackets`, a still-revealing member carrying steps);
// the operator /api/admin/draw/reveal keeps the reveal-only `draws` shape (ADR-0046 is public-only).
interface PublicRevealingBody {
  brackets: { redacted: boolean; steps: RevealStepBody[] }[]
}
interface OperatorRevealBody {
  draws: { redacted: boolean; steps: RevealStepBody[] }[]
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

    // Public wire (Access-free): the revealed seed line keeps its name but drops the strength signals. Still
    // revealing (cursor 1 of 4), so the two-phase feed's `revealing` member carries the steps.
    const pubRes = await req('/api/draw')
    expect(pubRes.status).toBe(200)
    const pubBracket = ((await pubRes.json()) as PublicRevealingBody).brackets[0]
    expect(pubBracket.redacted).toBe(true)
    const [pub] = pubBracket.steps
    expect(pub.player.lastName).toBe('Chal1')
    expect(pub.seed).toBeNull()
    expect(pub.player.lk).toBeNull()

    // Admin reveal (behind Access in prod; open on localhost): the beamer keeps the full LK + seed, never
    // redacts, and the operator endpoint keeps the reveal-only `draws` shape.
    const admRes = await req('/api/admin/draw/reveal')
    expect(admRes.status).toBe(200)
    const admDraw = ((await admRes.json()) as OperatorRevealBody).draws[0]
    expect(admDraw.redacted).toBe(false)
    const [adm] = admDraw.steps
    expect(adm.seed).toBe(1)
    expect(adm.player.lk).toBe('21.0')
  })
})
