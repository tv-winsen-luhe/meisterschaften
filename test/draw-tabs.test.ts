import { describe, expect, it } from 'vitest'
import { drawableCompetitions } from '../src/components/tournament-draw.render'
import { competitions } from '../src/data/tournament'

// Feedback loop for "the Social mixer showed a draw tab in the tournament phase": the public draw
// derived its tabs from `status === 'open' && capacity`, which the mixer satisfies, and ordered them by
// `indexOf` in a slug list, where a missing slug scores -1 and sorts *first*. So the unseeded field was
// not merely present — it was the pre-selected tab, rendering a bracket of "?" placeholders for a
// bracket the server refuses to ever create (worker/draw.ts, ADR-0058).

const slugs = (list: readonly { slug: string }[]) => list.map(c => c.slug)

describe('drawableCompetitions', () => {
  it('leaves out the unseeded field — it is never drawn (ADR-0058)', () => {
    expect(slugs(drawableCompetitions(competitions))).not.toContain('womens-social')
  })

  it('orders the drawn fields Herren, Herren Challenger, Damen', () => {
    expect(slugs(drawableCompetitions(competitions))).toEqual(['mens', 'mens-challenger', 'womens'])
  })

  it('reads the trait, not a slug allow-list (ADR-0066)', () => {
    const invented = [...competitions, { ...competitions[0], id: 'x', slug: 'mens-social', label: 'X' }]
    expect(slugs(drawableCompetitions(invented as typeof competitions))).not.toContain('mens-social')
  })

  it('sorts an unknown field last, never into the pre-selected tab', () => {
    const invented = [...competitions, { ...competitions[0], id: 'y', slug: 'juniors', label: 'Y' }]
    expect(slugs(drawableCompetitions(invented as typeof competitions)).at(-1)).toBe('juniors')
  })

  it('leaves out a field that is not offered', () => {
    const closed = competitions.map(c => (c.slug === 'womens' ? { ...c, status: 'closed' as const } : c))
    expect(slugs(drawableCompetitions(closed as typeof competitions))).not.toContain('womens')
  })
})
