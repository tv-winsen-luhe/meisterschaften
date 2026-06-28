import { describe, expect, it } from 'vitest'
import { competitionAccent } from '../src/admin/surfaces/competition-accent'
import { COMPETITION_SLUGS } from '../shared'

// competitionAccent gives each competition a distinct left-border accent on its schedule match card, so
// the operator can tell a card's field at a glance (issue #120). The guarantees worth pinning: every slug
// resolves to a distinct accent, and an unknown slug falls back to the neutral default.
describe('competitionAccent', () => {
  it('resolves every competition slug to a distinct accent', () => {
    const accents = COMPETITION_SLUGS.map(competitionAccent)
    for (const accent of accents) expect(accent).toBeTruthy()
    expect(new Set(accents).size).toBe(COMPETITION_SLUGS.length)
  })

  it('falls back to the neutral default for an unknown slug', () => {
    const fallback = competitionAccent('not-a-competition')
    expect(fallback).toBeTruthy()
    for (const slug of COMPETITION_SLUGS) expect(competitionAccent(slug)).not.toBe(fallback)
  })

  // A slug colliding with an Object.prototype key must still hit the neutral fallback, not the inherited
  // member — the lookup widens its param to string, so it can't lean on the type to exclude these.
  it('treats prototype-key slugs as unknown, not as a class name', () => {
    const fallback = competitionAccent('not-a-competition')
    for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      expect(competitionAccent(key)).toBe(fallback)
    }
  })
})
