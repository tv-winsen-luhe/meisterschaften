import { describe, expect, it } from 'vitest'
import { getSide, sideFields, SIDES } from '../src/data/sides'
import { competitions, signupCompetitions } from '../src/data/tournament'

// SIDES is the data behind the two outreach porches (/damen, /herren; CONTEXT.md: Outreach porch,
// ADR-0052). The porch template is presentation; these invariants are what actually protect the
// campaign: a field silently dropping off outreach, or a card deep-linking to a signup radio that
// doesn't exist, would be invisible in a screenshot but caught here.
describe('outreach porch sides', () => {
  it('are exactly the two German-slugged sides (ADR-0028, ADR-0051 „zwei je Seite")', () => {
    expect(SIDES.map(s => s.slug)).toEqual(['damen', 'herren'])
  })

  it('map each side to its two fields, in display order', () => {
    expect(sideFields(getSide('damen')!).map(c => c.id)).toEqual(['womens', 'womens-social'])
    expect(sideFields(getSide('herren')!).map(c => c.id)).toEqual(['mens', 'mens-challenger'])
  })

  it('reference only real competitions', () => {
    const ids = new Set(competitions.map(c => c.id))
    for (const side of SIDES) {
      for (const id of side.fieldIds) expect(ids).toContain(id)
    }
  })

  it('cover every registerable field exactly once between them (nothing dropped from outreach)', () => {
    const covered = SIDES.flatMap(s => s.fieldIds).sort()
    const registerable = signupCompetitions.map(c => c.id).sort()
    expect(covered).toEqual(registerable)
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

  it('resolve a known slug and reject an unknown one', () => {
    expect(getSide('damen')?.slug).toBe('damen')
    expect(getSide('mens')).toBeUndefined()
    expect(getSide('')).toBeUndefined()
  })
})
