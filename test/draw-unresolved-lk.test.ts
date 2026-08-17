import { describe, expect, it } from 'vitest'
import { createDrawService, type DrawParams } from '../worker/draw'
import { createInMemoryDrawStore } from '../worker/store/draw.memory'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// A confirmed row for the in-memory store; createdAt rises with the id so the tie-break is stable.
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

const params = (overrides: Partial<DrawParams> = {}): DrawParams => ({
  competition: 'mens',
  phase: 'tournament',
  cancelled: false,
  now: '2026-08-17T10:00:00.000Z',
  ...overrides
})

// ── An unresolved LK blocks the draw (ADR-0065) ───────────────────────────────────────────────────
// Since the cut admits by LK, `seedingValue(null)` ⇒ 25.0 would let a merely-unsynced entry be cut as the
// weakest — so a field may not be frozen while an entry's LK is unknown. Reachable in normal operation:
// confirming needs only a seeding basis, not an LK, and resolveLkOnConfirm writes nothing on a missing
// rating, a missing id, or a nuLiga outage. The operator resolves it (nuLiga match, or „keine nuLiga-ID"
// ⇒ 25.0) and draws again.
describe('createDrawService.draw — unresolved LK', () => {
  const field = (lks: (string | null)[], competition = 'mens') =>
    lks.map((lk, i) => confirmed(i + 1, { competition, lk }))

  const service = (rows: RegistrationRow[], drawStore = createInMemoryDrawStore()) => ({
    drawStore,
    svc: createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(rows),
      drawStore,
      randomSource: createFakeRandomSource([0, 0, 0, 0, 0])
    })
  })

  it('blocks the draw when an entry has no LK yet, and writes nothing', async () => {
    const { svc, drawStore } = service(field(['1.0', '2.0', '3.0', null]))

    const result = await svc.draw(params())
    expect(result).toMatchObject({ ok: false, error: 'UnresolvedLk' })
    expect(result.ok || result.reason).toContain('noch keine LK')
    expect(await drawStore.findDraw('mens', 'main')).toBeNull()
  })

  it('names how many entries are missing an LK, so the toast alone says what to fix', async () => {
    const { svc } = service(field(['1.0', null, '3.0', null]))

    const result = await svc.draw(params())
    expect(result.ok || result.reason).toContain('2 Einträge haben')
  })

  it('draws once every LK is resolved — an explicit 25.0 counts as resolved, a null does not', async () => {
    // The „keine nuLiga-ID" path stamps DEFAULT_LK, which is a stated LK and passes the gate; only a
    // genuinely absent rating blocks. Both entries weigh 25.0 for the ordering either way.
    const { svc } = service(field(['1.0', '2.0', '3.0', '25.0']))

    expect((await svc.draw(params())).ok).toBe(true)
  })

  it('blocks a Challenger field before the cap is even judged — the missing LK is the first thing to fix', async () => {
    // A null LK is never „too strong" (it seeds at 25.0), so the cap guard would wave it through and the
    // field would be drawn on a rating nobody stated. This gate runs first.
    const { svc } = service(field(['22.0', '23.0', '24.0', null], 'mens-challenger'))

    expect(await svc.draw(params({ competition: 'mens-challenger' }))).toMatchObject({
      ok: false,
      error: 'UnresolvedLk'
    })
  })

  it('never reaches an unseeded field — the Social mixer is refused as unseeded, LKs or not (ADR-0058)', async () => {
    // The mixer's entries carry no LK by construction, so gating it on resolved LKs would make it
    // permanently unresolvable. It is refused earlier, for the right reason.
    const { svc } = service(field([null, null, null, null], 'womens-social'))

    expect(await svc.draw(params({ competition: 'womens-social' }))).toMatchObject({ ok: false, error: 'Unseeded' })
  })
})
