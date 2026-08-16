import type { D1Database } from '@cloudflare/workers-types'
import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  activeCompetitions,
  CANCEL_DRAWN_REASON,
  COMPETITION_SLUGS,
  isCancelledCompetition,
  type ParticipantsResponse,
  type PhaseResponse
} from '../shared'
import { app } from '../worker/app'
import { createD1AppStateStore } from '../worker/store/app-state'

// Competition cancellation (CONTEXT: Competition cancellation; ADR-0062): the operator cancels a
// competition that drew too few entries, and it leaves the public wire. Three layers, in the order the
// signal travels: the pure predicate, the Store (including its fail-closed degradation), and the HTTP
// seam — the operator route with its one refusal, and the participant list that stops serving the field.
//
// The cross-projection invariant (draws + schedule feed) lands with the last of those wires (#278); what
// is asserted here is the participant list, the /api/phase carriage, and that no registration row moves.

// ── The predicate: pure, and the set comes in as a parameter ──────────────────────────────────────
describe('isCancelledCompetition / activeCompetitions (shared/cancellation.ts)', () => {
  it('answers from the set it is handed — nothing cancelled by default', () => {
    for (const slug of COMPETITION_SLUGS) expect(isCancelledCompetition([], slug)).toBe(false)
    expect(activeCompetitions([])).toEqual([...COMPETITION_SLUGS])
  })

  it('is true for exactly the competitions in the set', () => {
    const cancelled = ['womens-social']
    expect(isCancelledCompetition(cancelled, 'womens-social')).toBe(true)
    expect(isCancelledCompetition(cancelled, 'womens')).toBe(false)
    expect(isCancelledCompetition(cancelled, 'mens')).toBe(false)
  })

  it('activeCompetitions drops the cancelled ones and keeps the offering’s order', () => {
    expect(activeCompetitions(['womens', 'mens'])).toEqual(['mens-challenger', 'womens-social'])
    expect(activeCompetitions([...COMPETITION_SLUGS])).toEqual([])
  })
})

// ── The Store over a real local D1, including the fail-closed read ────────────────────────────────
describe('D1 app-state store · cancelled competitions', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM app_state')
  })

  const store = () => createD1AppStateStore(env.DB)
  // A D1 handle whose every statement fails — the transient outage both paths below are judged against.
  const brokenD1 = () =>
    ({
      prepare: () => {
        throw new Error('D1 down')
      }
    }) as unknown as D1Database

  it('degrades to the empty set when the row does not exist yet', async () => {
    expect(await store().getCancelledCompetitions()).toEqual([])
  })

  it('persists a cancellation and takes it back', async () => {
    await store().setCompetitionCancelled('womens-social', true)
    expect(await store().getCancelledCompetitions()).toEqual(['womens-social'])
    await store().setCompetitionCancelled('womens-social', false)
    expect(await store().getCancelledCompetitions()).toEqual([])
  })

  it('degrades to the empty set on an unparseable value — a running field is never taken off', async () => {
    // Only reachable via a manual DB edit. Both shapes degrade: not JSON at all, and JSON that is not a
    // list of known slugs. The empty set is the safe answer here (unlike the phase's default), because
    // the dangerous direction is *inventing* a cancellation nobody made.
    await env.DB.prepare("INSERT INTO app_state (id, cancelled_competitions) VALUES (1, 'not json')").run()
    expect(await store().getCancelledCompetitions()).toEqual([])
    await env.DB.prepare('UPDATE app_state SET cancelled_competitions = \'["nope"]\'').run()
    expect(await store().getCancelledCompetitions()).toEqual([])
  })

  it('degrades to the empty set on a read failure', async () => {
    expect(await createD1AppStateStore(brokenD1()).getCancelledCompetitions()).toEqual([])
  })

  it('fails the *write* loudly on a read failure — a blip never un-cancels the rest', async () => {
    // The write is a read-modify-write over the whole set. If its read degraded to the empty set like
    // the reader's does, cancelling one field during a D1 blip would silently drop every other
    // cancellation and put those competitions back on the public wire, under a success toast.
    await expect(createD1AppStateStore(brokenD1()).setCompetitionCancelled('womens', true)).rejects.toThrow()
  })

  it('leaves phase and schedule_published untouched, and is left untouched by them', async () => {
    await store().setPhase('tournament')
    await store().setSchedulePublished(true)
    await store().setCompetitionCancelled('womens', true)
    expect(await store().getPhase()).toBe('tournament')
    expect(await store().getSchedulePublished()).toBe(true)

    await store().setPhase('post-event')
    await store().setSchedulePublished(false)
    expect(await store().getCancelledCompetitions()).toEqual(['womens'])
    // Still one row — the three values share the singleton (ADR-0006).
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM app_state').first<{ c: number }>()
    expect(count?.c).toBe(1)
  })
})

// ── The HTTP seam: the operator route and the public wires ────────────────────────────────────────
const JSON_HEADERS = { 'content-type': 'application/json' }
const req = (path: string, init: RequestInit = {}) => app.request(path, init, env)
const post = (path: string, body?: unknown) =>
  req(path, { method: 'POST', headers: JSON_HEADERS, ...(body ? { body: JSON.stringify(body) } : {}) })

const setCancelled = (competition: string, cancelled: boolean) =>
  post('/api/admin/competition/cancel', { competition, cancelled })

const phase = async () => (await (await req('/api/phase')).json()) as PhaseResponse
const participants = async () => (await (await req('/api/participants')).json()) as ParticipantsResponse

const seedConfirmed = (competition: string, i: number) =>
  env.DB.prepare(
    `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, status, lk)
     VALUES (?, ?, ?, ?, 'TV Winsen', ?, 'confirmed', ?)`
  )
    .bind(`2026-06-0${i}T10:00:00Z`, competition, `P${i}`, `Player${i}`, `p${i}@x.de`, `${i}.0`)
    .run()

const statuses = async () =>
  (await env.DB.prepare('SELECT id, status FROM registrations ORDER BY id').all<{ id: number; status: string }>())
    .results

describe('POST /api/admin/competition/cancel + the public wires', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  })

  beforeEach(async () => {
    await env.DB.exec('DELETE FROM registrations')
    await env.DB.exec('DELETE FROM matches')
    await env.DB.exec('DELETE FROM draws')
    await env.DB.exec('DELETE FROM app_state')
  })

  it('cancels a competition, carries it on /api/phase, and takes it back', async () => {
    expect(await phase()).toEqual({ phase: 'signup', cancelledCompetitions: [] })

    const res = await setCancelled('womens-social', true)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, cancelledCompetitions: ['womens-social'] })
    expect(await phase()).toEqual({ phase: 'signup', cancelledCompetitions: ['womens-social'] })

    // Taking it back needs no confirmation and no reconciliation — the flag materialized nothing.
    expect((await setCancelled('womens-social', false)).status).toBe(200)
    expect(await phase()).toEqual({ phase: 'signup', cancelledCompetitions: [] })
  })

  it('rejects an unknown competition slug at the Zod boundary', async () => {
    const res = await setCancelled('mixed-doubles', true)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unbekannte Konkurrenz.' })
    expect((await phase()).cancelledCompetitions).toEqual([])
  })

  it('drops a cancelled competition from the participant list, serving the others unchanged', async () => {
    await seedConfirmed('womens', 1)
    await seedConfirmed('womens', 2)
    await seedConfirmed('mens', 3)

    expect((await participants()).participants).toHaveLength(3)

    await setCancelled('womens', true)
    const after = await participants()
    expect(after.enabled).toBe(true)
    expect(after.participants.map(p => p.competition)).toEqual(['mens'])

    // …and it comes back whole when the cancellation is taken back.
    await setCancelled('womens', false)
    expect((await participants()).participants).toHaveLength(3)
  })

  it('changes no registration row — the entries are the record of who wanted it', async () => {
    await seedConfirmed('womens', 1)
    await seedConfirmed('womens', 2)
    const before = await statuses()

    await setCancelled('womens', true)

    expect(await statuses()).toEqual(before)
    expect(before.every(r => r.status === 'confirmed')).toBe(true)
  })

  it('refuses to cancel a drawn competition and names the way out', async () => {
    for (let i = 1; i <= 4; i++) await seedConfirmed('mens', i)
    await post('/api/admin/phase', { phase: 'tournament' })
    expect((await post('/api/admin/draw', { competition: 'mens' })).status).toBe(200)

    const res = await setCancelled('mens', true)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: CANCEL_DRAWN_REASON })
    expect((await phase()).cancelledCompetitions).toEqual([])
    // The draw is untouched by the refusal.
    expect((await env.DB.prepare('SELECT COUNT(*) AS c FROM draws').first<{ c: number }>())?.c).toBe(1)
  })

  it('never blocks taking a cancellation back, drawn or not', async () => {
    for (let i = 1; i <= 4; i++) await seedConfirmed('mens', i)
    await setCancelled('mens', true)
    await post('/api/admin/phase', { phase: 'tournament' })
    // The field is drawn while cancelled (the draw gate learns about cancellation in #277) — the
    // un-cancel must still go through: the guard binds the cancel, never its reversal.
    expect((await post('/api/admin/draw', { competition: 'mens' })).status).toBe(200)

    const res = await setCancelled('mens', false)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, cancelledCompetitions: [] })
  })
})
