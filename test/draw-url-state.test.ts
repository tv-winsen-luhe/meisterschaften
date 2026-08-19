import { describe, expect, it } from 'vitest'
import { drawSelection, drawSelectionParams } from '../src/components/tournament-draw.url'

// The public bracket's state lives in the address (#313, ADR-0028): a reload on the grounds keeps the
// field, the bracket and the round a spectator picked, and „hier ist dein Draw" becomes a link somebody
// can send. Everything here is about **reading a stranger's URL** — a hand-typed one, a stale one, a
// bookmark from a field that no longer exists — so nothing is trusted and nothing throws (ADR-0035).
//
// The upper end of the round is deliberately *not* this module's business: how deep a bracket is, is a
// fact of the drawn field, so `bracketView` clamps it (see bracket-view.test.ts) and this only rejects
// what is not a round number at all.

const SLUGS = ['mens', 'mens-challenger', 'womens']

describe('drawSelection', () => {
  it('reads the field, the bracket and the round out of the address', () => {
    expect(drawSelection('?competition=womens&bracket=consolation&round=2', SLUGS)).toEqual({
      competition: 'womens',
      segment: 'consolation',
      round: 2
    })
  })

  it('asks for nothing when the address carries nothing', () => {
    expect(drawSelection('', SLUGS)).toEqual({ competition: null, segment: 'main', round: 1 })
  })

  it('leaves the field to the page when the address names one that has no draw', () => {
    expect(drawSelection('?competition=womens-social', SLUGS).competition).toBeNull()
  })

  it('leaves the field to the page when the address names one that does not exist', () => {
    expect(drawSelection('?competition=juniors', SLUGS).competition).toBeNull()
  })

  it('keeps the other two when the field it names is unknown', () => {
    expect(drawSelection('?competition=juniors&bracket=consolation&round=3', SLUGS)).toEqual({
      competition: null,
      segment: 'consolation',
      round: 3
    })
  })

  it('reads only „consolation" as the consolation bracket', () => {
    expect(drawSelection('?bracket=consolation', SLUGS).segment).toBe('consolation')
    expect(drawSelection('?bracket=main', SLUGS).segment).toBe('main')
    expect(drawSelection('?bracket=Nebenrunde', SLUGS).segment).toBe('main')
    expect(drawSelection('?bracket=', SLUGS).segment).toBe('main')
  })

  it('degrades a round that is not a round number to the outermost one', () => {
    expect(drawSelection('?round=zwei', SLUGS).round).toBe(1)
    expect(drawSelection('?round=0', SLUGS).round).toBe(1)
    expect(drawSelection('?round=-2', SLUGS).round).toBe(1)
    expect(drawSelection('?round=', SLUGS).round).toBe(1)
  })

  it('takes a round as a whole number, never a fraction', () => {
    expect(drawSelection('?round=2.7', SLUGS).round).toBe(2)
  })

  it('ignores the query parameters of other surfaces on the page', () => {
    expect(drawSelection('?utm_source=whatsapp&competition=mens', SLUGS).competition).toBe('mens')
  })
})

describe('drawSelectionParams', () => {
  it('writes English keys and values, the round as a number', () => {
    expect(drawSelectionParams({ competition: 'mens', segment: 'consolation', round: 3 })).toEqual({
      competition: 'mens',
      bracket: 'consolation',
      round: '3'
    })
  })

  it('round-trips a selection back into the same reading', () => {
    const params = drawSelectionParams({ competition: 'womens', segment: 'main', round: 2 })
    const search = new URLSearchParams(params).toString()
    expect(drawSelection(`?${search}`, SLUGS)).toEqual({ competition: 'womens', segment: 'main', round: 2 })
  })
})
