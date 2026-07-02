import { describe, expect, it } from 'vitest'
import { provisionalSeedRanks } from '../shared'

// provisionalSeedRanks is the one source every surface reads its seed rank from (ADR-0047): it ranks a
// field's entries strongest-first by LK — the draw's own order — and hands ranks 1..seedCount to the top,
// *independent* of whatever order the caller displays in. The cut decides who is in, the seeding decides
// where (ADR-0043); seed rank is LK on every field, Challenger included.
describe('provisionalSeedRanks', () => {
  it('seeds the strongest LK first, whatever order the entries arrive in (the Challenger incident, ADR-0047)', () => {
    // The exact prod rows, in participant-list order for a Challenger field (registration date, earliest
    // first). Steimmig registered last but is the strongest, so he must be seed 1 — never Lühr, who
    // registered earlier but is the weakest.
    const kasigkeit = { lk: '21.9', createdAt: '2026-06-24T11:44:28.570Z' }
    const luehr = { lk: '24.7', createdAt: '2026-06-24T13:05:59.206Z' }
    const amtsberg = { lk: '24.5', createdAt: '2026-06-24T13:59:41.085Z' }
    const steimmig = { lk: '21.5', createdAt: '2026-07-01T20:26:09.025Z' }
    const entries = [kasigkeit, luehr, amtsberg, steimmig]

    const ranks = provisionalSeedRanks(entries, 2) // a 4-draw seeds 2 (§30.5a + ADR-0034)

    expect(ranks.get(steimmig)).toBe(1) // strongest LK → seed 1, though registered last
    expect(ranks.get(kasigkeit)).toBe(2)
    expect(ranks.has(luehr)).toBe(false) // weakest → not among the two seeds
    expect(ranks.has(amtsberg)).toBe(false)
  })

  it('breaks equal LKs by registration time (earliest is the higher seed)', () => {
    const later = { lk: '20.0', createdAt: '2026-06-02T10:00:00.000Z' }
    const earlier = { lk: '20.0', createdAt: '2026-06-01T10:00:00.000Z' }

    const ranks = provisionalSeedRanks([later, earlier], 2)

    expect(ranks.get(earlier)).toBe(1)
    expect(ranks.get(later)).toBe(2)
  })

  it('seeds a missing LK as the weakest (DEFAULT_LK 25.0), never the strongest', () => {
    const rated = { lk: '23.0', createdAt: '2026-06-02T10:00:00.000Z' }
    const unrated = { lk: null, createdAt: '2026-06-01T10:00:00.000Z' } // earlier, but no rating

    const ranks = provisionalSeedRanks([unrated, rated], 1)

    expect(ranks.get(rated)).toBe(1) // the only seed is the rated player
    expect(ranks.has(unrated)).toBe(false)
  })

  it('assigns no ranks below the draw floor (seedCount 0)', () => {
    const entries = [{ lk: '10.0', createdAt: '2026-06-01T10:00:00.000Z' }]
    expect(provisionalSeedRanks(entries, 0).size).toBe(0)
  })

  it('is pure — it does not reorder the caller’s array', () => {
    const a = { lk: '25.0', createdAt: '2026-06-01T10:00:00.000Z' }
    const b = { lk: '10.0', createdAt: '2026-06-02T10:00:00.000Z' }
    const entries = [a, b]

    provisionalSeedRanks(entries, 2)

    expect(entries).toEqual([a, b]) // caller keeps its display order; only the rank Map reflects LK
  })
})
