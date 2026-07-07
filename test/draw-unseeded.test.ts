import { describe, expect, it } from 'vitest'
import { createDrawService } from '../worker/draw'
import { createInMemoryDrawStore } from '../worker/store/draw.memory'
import { createInMemoryRegistrationsStore } from '../worker/store/registrations.memory'
import type { RegistrationRow } from '../worker/db/schema'
import { createFakeRandomSource } from './fake-random'

// An unseeded field (Social mixer, ADR-0051) is never drawn — signup-only, no bracket. The draw
// service fail-closes it before reading the field, so a stray call can never produce a bracket from
// its LK-less entries (a defensive guard beneath the admin UI, which does not offer the draw for it).
const confirmed = (id: number): RegistrationRow => ({
  id,
  createdAt: `2026-06-0${id}T10:00:00.000Z`,
  updatedAt: null,
  competition: 'womens-social',
  firstName: `P${id}`,
  lastName: `Player${id}`,
  club: 'TV Winsen',
  email: `p${id}@x.de`,
  phone: null,
  note: null,
  playerId: null,
  lk: null,
  status: 'confirmed',
  ip: null
})

describe('createDrawService.draw · unseeded Social mixer', () => {
  it('refuses to draw it even with a full field', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => confirmed(i + 1))
    const service = createDrawService({
      registrationsStore: createInMemoryRegistrationsStore(rows),
      drawStore: createInMemoryDrawStore(),
      randomSource: createFakeRandomSource([0, 0, 0, 0, 0])
    })

    const result = await service.draw({
      competition: 'womens-social',
      phase: 'tournament',
      now: '2026-08-01T09:00:00.000Z'
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('Unseeded')
  })
})
