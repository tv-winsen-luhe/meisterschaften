import { describe, expect, it } from 'vitest'
import { type DrawPlayer, drawBracket, seedingEntrySchema } from '../shared'
import { createFakeRandomSource } from './fake-random'

// The seeding schema guards the draw's seeding JSON text column (draws.seeding): the Store parses
// through it on read so a malformed or stale row fails at the seam, closing the one raw cast in the
// ADR-0009 type chain. Here we pin the schema itself; the store wiring is exercised in
// draw.integration.test.ts.

const field = (n: number): DrawPlayer[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, lk: `${i + 1}.0` }))

describe('seedingEntrySchema', () => {
  it('round-trips a real drawBracket seeding through JSON — what we write comes back the same shape', () => {
    const { seeding } = drawBracket({ players: field(8), size: 8, random: createFakeRandomSource([0, 0, 0, 0, 0]) })
    expect(seedingEntrySchema.array().parse(JSON.parse(JSON.stringify(seeding)))).toEqual(seeding)
  })

  it('rejects a malformed seeding entry (the stale-row case)', () => {
    expect(() => seedingEntrySchema.parse({ seed: 1, playerId: 1 })).toThrow() // lk missing
    expect(() => seedingEntrySchema.parse({ seed: '1', playerId: 1, lk: null })).toThrow() // wrong type
  })
})
