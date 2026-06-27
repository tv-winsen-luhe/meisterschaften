import { describe, expect, it } from 'vitest'
import { signupCompetitions } from '../src/data/tournament'
import { COMPETITION_SLUGS, competitionSlug } from '../shared'

// signupCompetitions is derived from the contract: the form offers exactly the registerable
// competitions (slug ∈ COMPETITION_SLUGS), with no separate `selectable` flag to drift (ADR-0022).
// The derivation rests on a value (tournament.ts slugs are string-typed), not a type — this is the
// one place that guarantee needs a runtime guard against a future refactor.
describe('signupCompetitions', () => {
  it('is never empty', () => {
    expect(signupCompetitions.length).toBeGreaterThan(0)
  })

  it('offers only competitions the register contract accepts', () => {
    for (const c of signupCompetitions) {
      expect(competitionSlug.safeParse(c.slug).success).toBe(true)
    }
  })

  // Guards the contract→form direction too: a typo'd or missing tournament slug drops a registerable
  // competition from the form with no type error (slug is string-typed). Set equality catches both a
  // dropped slug and a contract slug that has no catalogue entry — the other half of "drift-proof".
  it('offers exactly the registerable competitions, no more, no fewer', () => {
    expect(new Set(signupCompetitions.map(c => c.slug))).toEqual(new Set(COMPETITION_SLUGS))
  })
})
