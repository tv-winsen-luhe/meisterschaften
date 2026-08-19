import { describe, expect, it } from 'vitest'
import { bracketView } from '../shared/bracket-view'
import type { LiveBracket, LiveBracketMatch, LiveBracketSlot, MatchScore, ScheduleMatch, ScheduleSlot } from '../shared'
import type { BracketViewOptions } from '../shared/bracket-view'

// The public bracket's projection (ADR-0070, #311): the tree a page renders — round columns, the „Spiel um
// Platz 3", the segment choice — and the schedule join that puts a court and a floor under each cell. How one
// cell reports its result is bracket-cell.test.ts's question.
//
// The rule these cases exist to protect is the **gate asymmetry** (ADR-0070): the score arrives on the draw
// wire, which is gated on the reveal cursor alone, while court and time are joined from the schedule feed,
// which is gated on the publish flag. „Plan unveröffentlicht" is therefore not an edge case here — it is the
// case that fails the moment someone joins the score off the schedule feed instead.

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

describe('bracketView · it never throws', () => {
  it('names a bye line „Freilos" and carries no score for it', () => {
    const view = bview([bMatch({ round: 1, position: 0, number: 1, slot2: { kind: 'bye' }, winner: 1 })])
    const cell = cellAt(view, 1, 0)
    expect(cell.slot2).toMatchObject({ text: 'Freilos', tbd: true, games: '', lk: null, seed: null })
    expect(cell.slot1.winner).toBe(true)
  })

  it('names an open feeder as the match it waits on', () => {
    const view = bview([
      bMatch({
        round: 2,
        position: 0,
        number: 3,
        slot1: { kind: 'feeder', matchNumber: 1 },
        slot2: { kind: 'unknown' }
      })
    ])
    const cell = cellAt(view, 2, 0)
    expect(cell.slot1).toMatchObject({ text: 'Sieger M1', tbd: true, lk: null })
    // An unresolvable slot degrades to „offen" rather than to „Freilos", which would read as a free pass.
    expect(cell.slot2).toMatchObject({ text: 'offen', tbd: true })
  })

  it('keeps a round column its full width when the wire carries no match at a node', () => {
    const view = bview([bMatch({ round: 1, position: 1, number: 2 })])
    expect(view.rounds.map(r => r.matchCount)).toEqual([2, 1])
    expect(view.rounds[0].cells[0]).toBeNull()
    expect(view.rounds[0].cells[1]).not.toBeNull()
  })
})

describe('bracketView · the plan is joined, the result is not (ADR-0070)', () => {
  const decided = bMatch({
    round: 1,
    position: 0,
    number: 1,
    status: 'done',
    winner: 1,
    score: { set1: [6, 3], set2: [6, 4], mtb: null }
  })

  it('keeps the score when the plan is unpublished, and drops court and time with it', () => {
    // An unpublished plan means the schedule feed carries no planned match at all, so the join finds
    // nothing — while the score, which rides the draw wire, is untouched. This is the case that breaks if
    // anyone ever „simplifies" the score onto the schedule join.
    const view = bview([decided], [])
    const cell = cellAt(view, 1, 0)
    expect(cell.schedule).toBeNull()
    expect(cell.slot1.games).toBe('6 6')
    expect(cell.slot2.games).toBe('3 4')
    expect(cell.slot1.winner).toBe(true)
  })

  it('states the court and the floor when the plan is published', () => {
    const view = bview([decided], [match({ id: 1, court: 3, slot: 0 })])
    expect(cellAt(view, 1, 0).schedule).toEqual({ where: 'Platz 3 · Sa', time: 'ab 10:30', followsOn: false })
  })

  it('follows the floor rule in the footer rather than claiming „ca. HH:MM" (ADR-0069)', () => {
    const view = bview(
      [decided, bMatch({ round: 1, position: 1, number: 2 })],
      [match({ id: 1, court: 3, slot: 0, position: 0 }), match({ id: 2, court: 3, slot: 3, position: 1 })]
    )
    expect(cellAt(view, 1, 0).schedule).toMatchObject({ time: 'ab 10:30', followsOn: false })
    expect(cellAt(view, 1, 1).schedule).toMatchObject({
      where: 'Platz 3 · Sa',
      time: 'im Anschluss · nicht vor ca. 12:00',
      followsOn: true
    })
  })

  it('reads the court’s chain off every field on it, not only off this bracket', () => {
    // The match in front of this one on court 3 belongs to another competition and never appears in this
    // tree — but it still occupies the court, so this cell still follows on. That neighbour knowledge is
    // exactly why the view takes the feed rather than a per-node index.
    const view = bview(
      [bMatch({ round: 1, position: 0, number: 1 })],
      [
        match({ id: 9, court: 3, slot: 0, competition: 'womens' }),
        match({ id: 1, court: 3, slot: 3, competition: 'mens', position: 0 })
      ]
    )
    expect(cellAt(view, 1, 0).schedule).toMatchObject({ time: 'im Anschluss · nicht vor ca. 12:00' })
  })

  it('joins a match on the day it is actually played', () => {
    const view = bview([decided], [match({ id: 1, court: 1, slot: 0, day: 1 })])
    expect(cellAt(view, 1, 0).schedule).toEqual({ where: 'Platz 1 · So', time: 'ab 10:00', followsOn: false })
  })
})

describe('bracketView · the tree is finished — rounds, the playoff, the segments', () => {
  it('labels the round columns outermost → final, sized from the draw', () => {
    const view = bview([bMatch({ round: 1, position: 0, number: 1 })])
    expect(view.rounds.map(r => ({ label: r.label, matchCount: r.matchCount }))).toEqual([
      { label: 'Halbfinale', matchCount: 2 },
      { label: 'Finale', matchCount: 1 }
    ])
  })

  it('hands the „Spiel um Platz 3" to the final round, out of its column and under its own label', () => {
    const third = bMatch({
      round: 2,
      position: 1,
      number: 4,
      thirdPlace: true,
      status: 'done',
      winner: 1,
      score: { set1: [6, 2], set2: [6, 1], mtb: null }
    })
    const view = bview([bMatch({ round: 2, position: 0, number: 3 }), third])
    // The playoff shares the final's round, so leaving it in the column would put two cells in a one-cell
    // column — and the elbow connectors read a column's cells as the tree's own positions.
    expect(view.rounds[1].cells).toHaveLength(1)
    expect(view.rounds[1].cells[0]?.number).toBe(3)
    // It belongs to the final *round* though (#312): that is where it is played, and a round list has
    // nowhere else to put it than under the final.
    expect(view.rounds[1].playoff?.number).toBe(4)
    expect(view.rounds[1].playoff?.label).toBe('Spiel um Platz 3')
    // It shows its score exactly like any other cell.
    expect(view.rounds[1].playoff?.slot1).toMatchObject({ games: '6 6', winner: true })
    // No earlier round carries one.
    expect(view.rounds[0].playoff).toBeNull()
  })

  it('shows the consolation bracket under its own round names, scores and all', () => {
    const view = bracketView(
      {
        competition: 'mens',
        main: bracket([bMatch({ round: 1, position: 0, number: 1 })]),
        consolation: bracket(
          [
            bMatch({
              round: 1,
              position: 0,
              number: 5,
              status: 'done',
              winner: 2,
              score: { set1: [6, 4], set2: [6, 4], mtb: null }
            })
          ],
          { size: 2, totalRounds: 1 }
        )
      },
      { matches: [] },
      { ...BRACKET_OPTIONS, segment: 'consolation' }
    )
    expect(view.segment).toBe('consolation')
    expect(view.hasConsolation).toBe(true)
    // „Nebenrunde · …" so a consolation final never reads as the real one (ADR-0004).
    expect(view.rounds.map(r => r.label)).toEqual(['Nebenrunde · Finale'])
    // The round control sits *inside* the Nebenrunde tab, so its buttons drop the prefix the column keeps.
    expect(view.rounds.map(r => r.name)).toEqual(['Finale'])
    expect(view.rounds[0].cells[0]?.slot2).toMatchObject({ games: '4 4', winner: true })
    // The consolation has no playoff (ADR-0004).
    expect(view.rounds[0].playoff).toBeNull()
  })

  it('falls back to the main bracket when the consolation asked for does not exist', () => {
    // The segment arrives from the URL in the next slice, so it can name a bracket this field never drew.
    // An empty tree with no control left to leave it by is the failure this avoids.
    const view = bview([bMatch({ round: 1, position: 0, number: 1 })], [], { segment: 'consolation' })
    expect(view).toMatchObject({ segment: 'main', hasConsolation: false, size: 4 })
    expect(view.rounds[0].cells[0]?.slot1.text).toBe('Jan Behrens')
  })
})

// The round a reader has navigated to (#312). The tree shows every round at once, so this matters only to
// the phone's round list — but *which* round a selection resolves to is a decision, so it is settled here
// rather than in a renderer, and the next slice can hand it straight in from the URL.
describe('bracketView · the selected round', () => {
  const twoRounds = [bMatch({ round: 1, position: 0, number: 1 }), bMatch({ round: 2, position: 0, number: 3 })]

  it('starts at the outermost round when the reader has not chosen one', () => {
    expect(bview(twoRounds).round).toBe(1)
  })

  it('keeps the round the reader chose', () => {
    expect(bview(twoRounds, [], { round: 2 }).round).toBe(2)
  })

  it('degrades a round this bracket does not have to the nearest one it does', () => {
    // A 4-draw is two rounds deep; a „Runde 7" arrives from a stale link or from a deeper segment.
    expect(bview(twoRounds, [], { round: 7 }).round).toBe(2)
    expect(bview(twoRounds, [], { round: 0 }).round).toBe(1)
    expect(bview(twoRounds, [], { round: -3 }).round).toBe(1)
  })

  it('degrades a round that is not a whole number at all', () => {
    expect(bview(twoRounds, [], { round: Number.NaN }).round).toBe(1)
    expect(bview(twoRounds, [], { round: 1.5 }).round).toBe(1)
  })

  it('clamps to the segment actually shown, not to the one asked for', () => {
    // The consolation here is one round deep: a reader standing on the main bracket's Finale who switches
    // must not land on a round that segment has no column for.
    const view = bracketView(
      {
        competition: 'mens',
        main: bracket(twoRounds),
        consolation: bracket([bMatch({ round: 1, position: 0, number: 5 })], { size: 2, totalRounds: 1 })
      },
      { matches: [] },
      { ...BRACKET_OPTIONS, segment: 'consolation', round: 2 }
    )
    expect(view).toMatchObject({ segment: 'consolation', round: 1 })
  })
})
