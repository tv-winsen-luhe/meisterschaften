import { describe, expect, it } from 'vitest'
import { isFullyRevealed, type PlayerDisplay, type PublicRevealStep, revealedBracket } from '../shared'

// The revealed bracket (CONTEXT: Revealed bracket): the single interpretation both the operator draw show
// and the public live bracket render. Pure in (size, steps), so it pins the §31 bye-advancement rule that
// neither renderer could test before the extraction. Fixtures are hand-built PublicRevealStep[] — the
// exact shape both consumers receive — rather than a full drawBracket run, to keep the unit boundary honest.

const player = (name: string): PlayerDisplay => ({ firstName: name, lastName: 'X', lk: null })

const draw = (position: number, name: string, seed: number | null = null): PublicRevealStep => ({
  kind: seed ? 'seed-fixed' : 'draw',
  position,
  seed,
  player: player(name)
})

// A bye line. A lot-bye carries no player; a seed-bye's public step carries the seed's player (the join
// follows the slot's seed) — but either way the winner is read off the *paired* non-bye line.
const bye = (position: number, seed: number | null = null, p: PlayerDisplay | null = null): PublicRevealStep => ({
  kind: 'bye',
  position,
  seed,
  player: p
})

describe('revealedBracket — lines', () => {
  it('indexes steps by position and leaves gaps for unrevealed lines', () => {
    const { lines } = revealedBracket(8, [draw(0, 'Anna'), draw(2, 'Cara')])
    expect(lines).toHaveLength(8)
    expect(lines[0]?.player?.firstName).toBe('Anna')
    expect(lines[2]?.player?.firstName).toBe('Cara')
    expect(lines[1]).toBeUndefined()
    expect(lines[7]).toBeUndefined()
  })

  it('returns size/2 bye-winner slots', () => {
    expect(revealedBracket(16, []).byeWinners).toHaveLength(8)
    expect(revealedBracket(4, []).byeWinners).toHaveLength(2)
  })
})

describe('revealedBracket — bye-winners (§31)', () => {
  it('advances no one from a contested match (two players)', () => {
    const { byeWinners } = revealedBracket(8, [draw(0, 'Anna'), draw(1, 'Bea')])
    expect(byeWinners[0]).toBeNull()
  })

  it('advances the drawn neighbour over a lot-bye, carrying no seed', () => {
    // Match 0: a drawn player on the even line, the lot-bye (player null) on the odd line.
    const { byeWinners } = revealedBracket(8, [draw(0, 'Bob'), bye(1)])
    expect(byeWinners[0]).toEqual({ player: player('Bob'), seed: null })
  })

  it('advances the seed over its bye, carrying its seed number', () => {
    // Seed 1 sits on line 0; its bye frees the paired line 1. The winner is read off the seed line.
    const { byeWinners } = revealedBracket(8, [draw(0, 'Anna', 1), bye(1, 1, player('Anna'))])
    expect(byeWinners[0]).toEqual({ player: player('Anna'), seed: 1 })
  })

  it('stays null while only one line of a bye match is revealed', () => {
    // The drawn neighbour is shown but its bye partner is not yet — the advance is not knowable yet.
    const { byeWinners } = revealedBracket(8, [draw(0, 'Bob')])
    expect(byeWinners[0]).toBeNull()
  })

  it('advances no one in a full 4-draw with no byes (ADR-0034)', () => {
    const steps = [draw(0, 'Anna', 1), draw(1, 'Bea'), draw(2, 'Cara'), draw(3, 'Dora', 2)]
    const { byeWinners } = revealedBracket(4, steps)
    expect(byeWinners).toEqual([null, null])
  })

  it('advances no one from an unrevealed bracket', () => {
    expect(revealedBracket(8, []).byeWinners).toEqual([null, null, null, null])
  })

  it('advances no one from a double-bye match (defensive — impossible in a real draw)', () => {
    // byes < round-1 matches always holds for sizes 4/8/16, so two byes never share a match; the loop
    // returns null defensively rather than inventing a winner.
    const { byeWinners } = revealedBracket(8, [bye(0), bye(1)])
    expect(byeWinners[0]).toBeNull()
  })
})

describe('isFullyRevealed', () => {
  it('is true once the cursor reaches the total', () => {
    expect(isFullyRevealed({ cursor: 8, total: 8 })).toBe(true)
  })

  it('is false while the cursor is short of the total (mid-reveal, including not-yet-started)', () => {
    expect(isFullyRevealed({ cursor: 3, total: 8 })).toBe(false)
    expect(isFullyRevealed({ cursor: 0, total: 8 })).toBe(false)
  })

  it('reads >= so a cursor past the total (unreachable under the advance clamp) still counts as revealed', () => {
    expect(isFullyRevealed({ cursor: 9, total: 8 })).toBe(true)
  })

  it('treats an empty sequence as trivially revealed — the not-yet-loaded guard is the caller’s job', () => {
    // The predicate is pure cursor math; the reveal controller layers its own `total > 0` loading guard.
    expect(isFullyRevealed({ cursor: 0, total: 0 })).toBe(true)
  })
})
