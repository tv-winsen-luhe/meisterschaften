import { describe, expect, it } from 'vitest'
import { cancellationThreshold, MIN_DRAW_ENTRIES, MIN_SOCIAL_MIXER_ENTRIES, underfilledCompetitions } from '../shared'

// The cancellation *affordance* (ADR-0062): the confirm dialog of the signup → tournament transition
// lists the competitions under their threshold. The thresholds advise, they never cancel — nothing but
// this list reads them.
describe('cancellation threshold', () => {
  it('reuses the draw floor for the drawn fields', () => {
    expect(cancellationThreshold('mens')).toBe(MIN_DRAW_ENTRIES)
    expect(cancellationThreshold('mens-challenger')).toBe(MIN_DRAW_ENTRIES)
    expect(cancellationThreshold('womens')).toBe(MIN_DRAW_ENTRIES)
  })

  it('gives the unseeded Social mixer its own, higher minimum', () => {
    expect(cancellationThreshold('womens-social')).toBe(MIN_SOCIAL_MIXER_ENTRIES)
    expect(MIN_SOCIAL_MIXER_ENTRIES).toBe(6)
  })
})

describe('underfilledCompetitions', () => {
  it('lists a drawn field under the draw floor with its confirmed count', () => {
    expect(underfilledCompetitions({ mens: 8, 'mens-challenger': 8, womens: 3, 'womens-social': 8 }, [])).toEqual([
      { competition: 'womens', confirmed: 3, threshold: MIN_DRAW_ENTRIES }
    ])
  })

  it('counts a competition with no entry at all as zero', () => {
    const list = underfilledCompetitions({ mens: 8, 'mens-challenger': 8, womens: 8 }, [])
    expect(list).toEqual([{ competition: 'womens-social', confirmed: 0, threshold: MIN_SOCIAL_MIXER_ENTRIES }])
  })

  it('holds the mixer to its own threshold — 5 is under it, 4 would clear the draw floor', () => {
    expect(underfilledCompetitions({ mens: 4, 'mens-challenger': 4, womens: 4, 'womens-social': 5 }, [])).toEqual([
      { competition: 'womens-social', confirmed: 5, threshold: MIN_SOCIAL_MIXER_ENTRIES }
    ])
    expect(underfilledCompetitions({ mens: 4, 'mens-challenger': 4, womens: 4, 'womens-social': 6 }, [])).toEqual([])
  })

  it('omits an already cancelled competition — there is nothing left to advise', () => {
    expect(underfilledCompetitions({ mens: 8, 'mens-challenger': 8, womens: 2 }, ['womens', 'womens-social'])).toEqual(
      []
    )
  })

  it('keeps the canonical competition order', () => {
    expect(underfilledCompetitions({}, []).map(f => f.competition)).toEqual([
      'mens',
      'mens-challenger',
      'womens',
      'womens-social'
    ])
  })
})
