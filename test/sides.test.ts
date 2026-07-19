import { describe, expect, it } from 'vitest'
import { getSide, sideFields, SIDES } from '../src/data/sides'
import { competitions, signupCompetitions } from '../src/data/tournament'

// SIDES is the data behind the Damen outreach porch (/damen; CONTEXT.md: Outreach porch, ADR-0052).
// The Herren porch was retired (ADR-0057): the broad Herren send lands on the front door, so the Herren
// fields are no longer on any porch. The porch template is presentation; these invariants are what
// actually protect the campaign: a field silently dropping off Damen outreach, or a card deep-linking to
// a signup radio that doesn't exist, would be invisible in a screenshot but caught here.
describe('outreach porch sides', () => {
  it('is the single German-slugged Damen side — Herren moved to the front door (ADR-0057)', () => {
    expect(SIDES.map(s => s.slug)).toEqual(['damen'])
  })

  it('maps the Damen side to its two fields, in display order', () => {
    // The Damen porch leads with the social field, which is the genuine first choice it sells (ADR-0054).
    expect(sideFields(getSide('damen')!).map(c => c.id)).toEqual(['womens-social', 'womens'])
  })

  it('reference only real competitions', () => {
    const ids = new Set(competitions.map(c => c.id))
    for (const side of SIDES) {
      for (const id of side.fieldIds) expect(ids).toContain(id)
    }
  })

  it('covers the Damen fields only — the Herren fields live on the front door now (ADR-0057)', () => {
    // Before ADR-0057 the two porches covered every registerable field between them. That invariant is
    // deliberately broken here: the broad Herren send lands on the front door, so the Herren fields are
    // covered there, not on any porch.
    const covered = SIDES.flatMap(s => s.fieldIds).sort()
    expect(covered).toEqual(['womens', 'womens-social'])
    const registerable = signupCompetitions.map(c => c.id)
    expect(registerable).toContain('mens')
    expect(registerable).toContain('mens-challenger')
    expect(covered).not.toContain('mens')
    expect(covered).not.toContain('mens-challenger')
  })

  it('deep-link only to slugs the signup modal offers', () => {
    const offered = new Set(signupCompetitions.map(c => c.slug))
    for (const side of SIDES) {
      for (const field of sideFields(side)) expect(offered).toContain(field.slug)
    }
  })

  it('carry a non-empty WhatsApp preview card (the reason the route exists — ADR-0052)', () => {
    for (const side of SIDES) {
      expect(side.ogTitle.length).toBeGreaterThan(0)
      expect(side.ogDescription.length).toBeGreaterThan(0)
    }
  })

  it('resolve the Damen slug and reject everything else, Herren included (ADR-0057)', () => {
    expect(getSide('damen')?.slug).toBe('damen')
    expect(getSide('herren')).toBeUndefined()
    expect(getSide('mens')).toBeUndefined()
    expect(getSide('')).toBeUndefined()
  })
})
