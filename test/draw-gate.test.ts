import { describe, expect, it } from 'vitest'
import { drawBlocker, isDrawStageLocked } from '../shared'

// The draw gate (CONTEXT: competition lifecycle, ADR-0011/0027): the pure, store-free predicates the
// draw surface (UI: „Auslosung") renders and the worker enforces. `drawBlocker` answers "can *this*
// competition be drawn?" (the per-card button); `isDrawStageLocked` answers "is the surface even at the
// draw stage yet?" (the whole-surface "not yet" panel).

// The shared draw gate the worker enforces and the admin button renders (ADR-0011) — so a size the
// math can't handle (e.g. a full field of 4 or 32) is blocked, never crashed.
describe('drawBlocker', () => {
  it('blocks until registration is closed', () => {
    expect(drawBlocker('signup', 8)).toBe('not-tournament')
    expect(drawBlocker('post-event', 8)).toBe('not-tournament')
  })

  it('blocks fewer than four entries — the smallest field that forms a real knockout (ADR-0034)', () => {
    expect(drawBlocker('tournament', 0)).toBe('too-few')
    expect(drawBlocker('tournament', 1)).toBe('too-few')
    expect(drawBlocker('tournament', 2)).toBe('too-few') // a 2–3 field would draw a bye-semifinal
    expect(drawBlocker('tournament', 3)).toBe('too-few')
  })

  it('allows a non-full field — §31 fills it with byes', () => {
    expect(drawBlocker('tournament', 7)).toBeNull() // 8-draw, 1 bye
    expect(drawBlocker('tournament', 12)).toBeNull() // 16-draw, 4 byes
    expect(drawBlocker('tournament', 9)).toBeNull() // 16-draw, 7 byes (4 to seeds, 3 by lot)
    expect(drawBlocker('tournament', 13)).toBeNull() // 16-draw, 3 byes
  })

  it('blocks an over-full field whose draw size has no seed table (17+ rounds to 32)', () => {
    expect(drawBlocker('tournament', 17)).toBe('unsupported-size') // size 32
    expect(drawBlocker('tournament', 32)).toBe('unsupported-size') // size 32
  })

  it('allows a supported field (4–16 entrants round to a 4-, 8-, or 16-draw)', () => {
    expect(drawBlocker('tournament', 4)).toBeNull() // 4-draw, full — the smallest field
    expect(drawBlocker('tournament', 5)).toBeNull()
    expect(drawBlocker('tournament', 8)).toBeNull()
    expect(drawBlocker('tournament', 16)).toBeNull()
  })
})

// The surface-level lock the draw surface (UI: „Auslosung") shows before drawing can start — keyed on
// the phase, not on draw existence (unlike the schedule surface's empty, UI: „Spielplan"), because the
// draw is *created* on this surface (ADR-0027). The lock is for the genuine pre-draw stage only.
describe('isDrawStageLocked', () => {
  it('locks during signup while nothing is drawn — drawing opens at registration close', () => {
    expect(isDrawStageLocked('signup', false)).toBe(true)
  })

  it('does not lock while the phase is unknown (null: still loading, or a failed read) — falls through to the cards', () => {
    expect(isDrawStageLocked(null, false)).toBe(false)
  })

  it('does not lock in tournament — the operator draws here, before and after the first draw exists', () => {
    expect(isDrawStageLocked('tournament', false)).toBe(false)
    expect(isDrawStageLocked('tournament', true)).toBe(false) // the steady state for the whole phase
  })

  it('does not lock post-event — archived brackets, or nothing drawn, never the pre-draw panel', () => {
    expect(isDrawStageLocked('post-event', true)).toBe(false)
    expect(isDrawStageLocked('post-event', false)).toBe(false)
  })

  it('an existing draw wins even in signup — a phase flipped back after drawing keeps its brackets', () => {
    expect(isDrawStageLocked('signup', true)).toBe(false)
  })
})
