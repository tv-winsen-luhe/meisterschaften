import { describe, expect, it } from 'vitest'
import { bracketView } from '../shared/bracket-view'
import type { LiveBracket, LiveBracketMatch, LiveBracketSlot, MatchScore, ScheduleMatch, ScheduleSlot } from '../shared'
import type { BracketViewOptions } from '../shared/bracket-view'

// What one **bracket cell** reads like (ADR-0070, #311) — the sibling of bracket-view.test.ts the same way
// match-row.test.ts is the sibling of match-view.test.ts. Split by question rather than by size: that file
// asks „is the tree right", this one asks „does one cell report a result the way tennis reports one".
//
// The score column itself — separators, which line the outcome token rides, a partial score — is the shared
// Match row's and is pinned in match-row.test.ts. What is asserted here is what the **cell** adds: the LK,
// the loser fade, the running marker, and that a redacted field says nothing about strength at all.

const NO_SCORE: MatchScore = { set1: null, set2: null, mtb: null }

// A plain, unseeded TV Winsen player on the **schedule** wire — the feed side of the join, which carries the
// club (for the crest) where the draw wire carries the LK.
const player = (firstName: string, lastName: string): ScheduleSlot => ({
  kind: 'player',
  firstName,
  lastName,
  club: 'TV Winsen',
  seed: null
})

// One placed match of the schedule feed — here only ever the *plan* half of the join: which court a bracket
// node sits on and when. The result never comes from this side.
const match = (over: Partial<ScheduleMatch> & Pick<ScheduleMatch, 'id' | 'court' | 'slot'>): ScheduleMatch => ({
  competition: 'mens',
  bracket: 'main',
  number: over.id,
  round: 1,
  thirdPlace: false,
  position: 0,
  totalRounds: 2,
  day: 0,
  status: 'planned',
  winner: null,
  outcome: null,
  score: NO_SCORE,
  slot1: player('Jan', 'Behrens'),
  slot2: player('Til', 'Osten'),
  ...over
})

// The event's date copy is the client's (src/data/tournament.ts), handed in as data — the view abbreviates it
// to „Sa"/„So" for the tight cell footer.
const DAYS = [
  { weekday: 'Samstag', short: '22.08.' },
  { weekday: 'Sonntag', short: '23.08.' }
]

// A player line on the **draw** wire — the result side of the join, which carries the LK where the schedule
// feed carries the club.
interface PlayerSlotKind {
  kind: 'player'
}
type BracketPlayer = Extract<LiveBracketSlot, PlayerSlotKind>

const bPlayer = (firstName: string, lastName: string, over: Partial<BracketPlayer> = {}): LiveBracketSlot => ({
  kind: 'player',
  firstName,
  lastName,
  lk: '12,3',
  seed: null,
  ...over
})

const bMatch = (
  over: Partial<LiveBracketMatch> & Pick<LiveBracketMatch, 'round' | 'position' | 'number'>
): LiveBracketMatch => ({
  thirdPlace: false,
  winner: null,
  status: 'planned',
  outcome: null,
  score: NO_SCORE,
  slot1: bPlayer('Jan', 'Behrens'),
  slot2: bPlayer('Til', 'Osten'),
  ...over
})

// A 4-draw: two first-round matches feeding one final (plus, where a case wants it, the playoff).
const bracket = (matches: LiveBracketMatch[], over: Partial<LiveBracket> = {}): LiveBracket => ({
  size: 4,
  totalRounds: 2,
  redacted: false,
  matches,
  ...over
})

const BRACKET_OPTIONS: BracketViewOptions = { days: DAYS }

const bview = (matches: LiveBracketMatch[], feed: ScheduleMatch[] = [], over: Partial<BracketViewOptions> = {}) =>
  bracketView(
    { competition: 'mens', main: bracket(matches), consolation: null },
    { matches: feed },
    {
      ...BRACKET_OPTIONS,
      ...over
    }
  )

// The cell at a node, narrowed — a null cell would mean the wire carried no match there.
const cellAt = (view: ReturnType<typeof bview>, round: number, position: number) => {
  const cell = view.rounds[round - 1].cells[position]
  if (!cell) throw new Error(`no cell at ${round}/${position}`)
  return cell
}

describe('bracketView · the cell carries its own score (ADR-0070)', () => {
  it('shows the sets and the Match-Tie-Break of a decided match, and marks the winner', () => {
    const view = bview([
      bMatch({
        round: 1,
        position: 0,
        number: 1,
        status: 'done',
        winner: 2,
        score: { set1: [6, 3], set2: [4, 6], mtb: [8, 10] }
      })
    ])
    const cell = cellAt(view, 1, 0)
    // The one score formatter (#305) — the same separator the schedule row prints, because it is the same
    // call. Two formatters was the state this replaced.
    expect(cell.slot1.games).toBe('6 4 8')
    expect(cell.slot2.games).toBe('3 6 10')
    expect(cell.slot2).toMatchObject({ winner: true, loser: false })
    expect(cell.slot1).toMatchObject({ winner: false, loser: true })
  })

  it('shows a partial score while a match is running', () => {
    const view = bview([
      bMatch({ round: 1, position: 0, number: 1, status: 'running', score: { set1: [6, 3], set2: null, mtb: null } })
    ])
    const cell = cellAt(view, 1, 0)
    expect(cell.slot1.games).toBe('6')
    expect(cell.slot2.games).toBe('3')
    expect(cell.statusLabel).toBe('läuft')
  })

  it('marks a running match even before a single set is saved', () => {
    // The case that made `status` worth carrying: with no score yet, nothing else distinguishes a match on
    // court right now from one that has not started.
    const view = bview([bMatch({ round: 1, position: 0, number: 1, status: 'running' })])
    const cell = cellAt(view, 1, 0)
    expect(cell.slot1.games).toBe('')
    expect(cell.statusLabel).toBe('läuft')
    expect(cell.slot1).toMatchObject({ winner: false, loser: false })
    expect(cell.slot2).toMatchObject({ winner: false, loser: false })
  })

  it('says nothing about a planned or a finished match’s status', () => {
    // „läuft" is the one state worth a badge; a fresh draw of „geplant" chips would mark every line at once.
    expect(cellAt(bview([bMatch({ round: 1, position: 0, number: 1 })]), 1, 0).statusLabel).toBeNull()
    const done = bview([
      bMatch({
        round: 1,
        position: 0,
        number: 1,
        status: 'done',
        winner: 1,
        score: { set1: [6, 0], set2: [6, 0], mtb: null }
      })
    ])
    expect(cellAt(done, 1, 0).statusLabel).toBeNull()
  })

  it('writes a retirement behind the sets that were played, on the winner’s line', () => {
    const view = bview([
      bMatch({
        round: 1,
        position: 0,
        number: 1,
        status: 'done',
        winner: 1,
        outcome: 'retirement',
        score: { set1: [6, 3], set2: [3, 1], mtb: null }
      })
    ])
    const cell = cellAt(view, 1, 0)
    expect(cell.slot1).toMatchObject({ games: '6 3', outcome: '· Aufg.' })
    expect(cell.slot2.outcome).toBeNull()
  })

  it('writes a walkover in the score’s place, where there are no sets at all', () => {
    const view = bview([bMatch({ round: 1, position: 0, number: 1, status: 'done', winner: 2, outcome: 'walkover' })])
    const cell = cellAt(view, 1, 0)
    expect(cell.slot2).toMatchObject({ games: '', outcome: 'w.o.' })
    expect(cell.slot1.outcome).toBeNull()
  })
})

describe('bracketView · the bracket’s own strength signals', () => {
  it('prints the LK and the seed token a bracket line carries', () => {
    const view = bview([
      bMatch({ round: 1, position: 0, number: 1, slot1: bPlayer('Jan', 'Behrens', { lk: '11,4', seed: 1 }) })
    ])
    const cell = cellAt(view, 1, 0)
    expect(cell.slot1.lk).toEqual({ text: 'LK 11,4', pending: false })
    expect(cell.slot1.seed).toEqual({ text: '1', label: 'An 1 gesetzt' })
  })

  it('marks an unrated player’s LK as still pending rather than absent', () => {
    const view = bview([bMatch({ round: 1, position: 0, number: 1, slot1: bPlayer('Jan', 'Behrens', { lk: null }) })])
    expect(cellAt(view, 1, 0).slot1.lk).toEqual({ text: 'LK folgt', pending: true })
  })

  it('says nothing at all about strength on a redacted field (ADR-0048)', () => {
    // The wire has already nulled lk + seed there, so „LK folgt" would turn a withheld field into a claim
    // about the player. The flag, not the null, is what decides.
    const view = bracketView(
      {
        competition: 'mens',
        main: bracket(
          [bMatch({ round: 1, position: 0, number: 1, slot1: bPlayer('Jan', 'Behrens', { lk: null, seed: null }) })],
          {
            redacted: true
          }
        ),
        consolation: null
      },
      { matches: [] },
      BRACKET_OPTIONS
    )
    const cell = cellAt(view, 1, 0)
    expect(cell.slot1.lk).toBeNull()
    expect(cell.slot1.seed).toBeNull()
    expect(cell.slot1.text).toBe('Jan Behrens')
  })
})
