import { courtLabel, publishedTimes, rowSlot, STATUS_LABELS } from './match-view'
import { roundLabel, roundName, scheduleNodeKey } from './schedule'
import type { DayCopy, RowSlot } from './match-view'
import type {
  LiveBracket,
  LiveBracketMatch,
  LiveBracketSlot,
  PublicCompetitionBracket,
  ScheduleMatch,
  ScheduleResponse
} from './admin'

/**
 * The public bracket's projection (ADR-0070): the second of the two entry points the weekend surfaces read,
 * and a sibling of `match-view.ts` rather than a module of its own — the row inside a bracket cell **is** a
 * schedule row, so the score column, the winner mark, the outcome token and the reservation chain are
 * imported from there and never re-answered here.
 *
 * The same four facts hold as for the schedule view: the tree comes out fully ordered, every string is
 * finished German, it never throws, and there is no clock in it.
 *
 * The one rule that is this file's alone is the **gate asymmetry** (ADR-0070). See `bracketView`.
 */

/** Which bracket of a field a view shows — the main KO tree or the consolation (ADR-0004, ADR-0046). */
export type BracketSegment = 'main' | 'consolation'

/**
 * A player's LK as the bracket prints it. `pending` marks a player whose rating has not arrived („LK
 * folgt") so the renderer can mute it — the same one-fact-two-readings shape as the seed token.
 *
 * Null for a placeholder line, and null on a strength-redacted field (ADR-0048): there the wire's `lk` is
 * already nulled, and the difference between „withheld" and „not yet rated" must not be flattened into
 * „LK folgt", which would be a claim about the player rather than about the field.
 */
export interface LkToken {
  text: string
  pending: boolean
}

/**
 * A contestant line in a bracket cell: the shared row slot plus the two facts only the bracket asks for.
 *
 * The LK is here rather than on `RowSlot` because it answers the bracket's question — „how strong is this
 * half of the draw" — and the schedule's silence about it is that row's economy, not an omission (ADR-0070).
 *
 * `loser` is carried rather than derived, because „not the winner" is not the same as „lost": both lines of
 * an undecided match are non-winners and neither is faded. A caller recovering this from `winner` alone
 * would need the match's decided-ness, which is the seam leaking one field at a time.
 */
export interface CellSlot extends RowSlot {
  lk: LkToken | null
  loser: boolean
}

/**
 * Where and when a cell's match is played, as the cell's footer prints it — **the gated half** of ADR-0070.
 * It comes from the schedule feed, so it is absent whenever the plan is (unpublished, reset, or simply not
 * placed yet) while the score above it stays. That disappearance is correct: the plan is what the organiser
 * withholds (ADR-0041), the result is not.
 *
 * Split into two strings rather than one, so the time reads exactly as it does on /spielplan („14:00",
 * „ca. 14:00") instead of being nested inside a „Platz 3 · Sa · …" chain whose separators would then mean
 * two different things.
 */
export interface CellSchedule {
  /** „Platz 3 · Sa" — the court is the *actual* one once a match is running (ADR-0032). */
  where: string
  /** „14:00" when nothing can push it, „ca. 14:00" when it follows on that court (ADR-0071). */
  time: string
  followsOn: boolean
}

/** One match in the bracket: the two contestant lines, the result they carry, and the plan's footer. */
export interface BracketCell {
  /** The bracket-stable match number a feeder line points at („Sieger M3"). */
  number: number
  slot1: CellSlot
  slot2: CellSlot
  status: ScheduleMatch['status']
  /**
   * „läuft", and **only** that — null for a planned or a finished match. The one state a reader needs
   * marked is the match on court right now (a finished cell says so with its score, a planned one with its
   * footer), and a „geplant" badge on every cell of a fresh draw would be noise on every line at once.
   * Which states earn a badge is a decision, so it is made here rather than by a branch in the renderer.
   */
  statusLabel: string | null
  /** Null when the plan is withheld or the match is unplaced — see `CellSchedule`. */
  schedule: CellSchedule | null
  /** „Spiel um Platz 3" for the playoff, null for a cell in the tree, which its round column already names. */
  label: string | null
}

/**
 * One round column of the tree, outermost → final. `cells` is `matchCount` long and indexed by bracket
 * position, so a renderer lays out the column by iteration alone. An entry is null where the wire carries
 * no match at that node — not reachable on a resolved bracket, but the tree is drawn from the draw *size*,
 * so the column keeps its shape instead of collapsing (ADR-0035: degrade, never throw).
 */
export interface BracketRound {
  round: number
  /** „Viertelfinale", or „Nebenrunde · Viertelfinale" on the consolation — what the round column heads with. */
  label: string
  /**
   * The same round without its bracket's name — what the round control shows (#312), which sits *inside* the
   * bracket choice and would otherwise repeat „Nebenrunde · " on every one of its buttons. Both come from the
   * one round-name rule (#307), so the control and the column can never drift.
   */
  name: string
  matchCount: number
  cells: (BracketCell | null)[]
  /**
   * The „Spiel um Platz 3" of this round — set on the **final** round of a main bracket and null everywhere
   * else (a consolation has no playoff, ADR-0004).
   *
   * It sits beside `cells` rather than inside them because the two are read differently: `cells` is the
   * tree's own topology, indexed by bracket position and wired up by the elbow connectors, while the playoff
   * is a match that merely shares the final's round. It hangs off the *round* rather than the view (#312)
   * because that is where it is played — on the final day, under the final — and because a round list has
   * nowhere else to put it: as a view-level field it could only be appended as a box under everything, which
   * is the loose box this replaces.
   */
  playoff: BracketCell | null
}

export interface BracketView {
  /** The segment actually shown — see `bracketView` on why it may differ from the one asked for. */
  segment: BracketSegment
  /** Whether this field has a consolation bracket at all, i.e. whether there is a choice to offer. */
  hasConsolation: boolean
  /** The draw size of the shown segment — the tree's width. */
  size: number
  rounds: BracketRound[]
  /**
   * The round the reader has navigated to, always one this bracket actually has (#312). It addresses
   * `rounds` as `rounds[round - 1]`.
   *
   * The tree shows every round at once, so this speaks only to the phone's round list — but resolving a
   * selection is a decision (a stale link, or a switch to a shallower segment, can name a round that is not
   * there), and the seam is where decisions live. See `bracketView` for how it degrades.
   */
  round: number
}

export interface BracketViewOptions {
  days: readonly DayCopy[]
  /** The segment the reader chose, or null/absent for the main bracket. */
  segment?: BracketSegment | null
  /** The round the reader chose, or null/absent for the outermost one. Degraded, never trusted. */
  round?: number | null
}

/** The fully-revealed member of the public bracket union (ADR-0046) — the phase this view projects. */
type LiveCompetition = Extract<PublicCompetitionBracket, { phase: 'live' }>

// The compact day the tight cell footer carries — „Sa"/„So" from the event's own date copy, rather than a
// second weekday list that could drift from /spielplan's „Samstag · 22.08.".
const dayAbbr = (days: readonly DayCopy[], day: number): string => days[day]?.weekday.slice(0, 2) ?? `Tag ${day + 1}`

// The LK as the cell prints it. A redacted field yields nothing at all — see `LkToken` on why „LK folgt"
// would be the wrong thing to say there.
const lkToken = (wire: LiveBracketSlot, redacted: boolean): LkToken | null => {
  if (wire.kind !== 'player' || redacted) return null
  return wire.lk ? { text: `LK ${wire.lk}`, pending: false } : { text: 'LK folgt', pending: true }
}

const cellSlot = (match: LiveBracketMatch, slot: 1 | 2, redacted: boolean): CellSlot => {
  const wire = slot === 1 ? match.slot1 : match.slot2
  return {
    ...rowSlot(match, wire, slot),
    lk: lkToken(wire, redacted),
    // Faded only once the match is actually decided — an undecided pairing has no loser to fade.
    loser: match.winner !== null && match.winner !== slot
  }
}

/**
 * The schedule join, keyed by bracket topology (`scheduleNodeKey`, #159) and carrying the same published
 * time /spielplan states, hedged or plain (ADR-0071).
 *
 * The times come from `publishedTimes` over the whole feed, which is why the bracket takes the feed rather
 * than a pre-built node index: whether a node's start can be pushed is a statement about its court's
 * neighbours, and those neighbours are mostly matches of *other* fields that this bracket never renders. A
 * cell that said something different from the schedule row for the same match would simply be a bug.
 */
const scheduleByNode = (matches: readonly ScheduleMatch[], days: readonly DayCopy[]): Map<string, CellSchedule> => {
  const published = publishedTimes(matches)
  const index = new Map<string, CellSchedule>()
  for (const m of matches) {
    const when = published.get(m.id)!
    index.set(scheduleNodeKey(m.competition, m.bracket, m.round, m.position), {
      where: `${courtLabel(m.court)} · ${dayAbbr(days, m.day)}`,
      time: when.label,
      followsOn: when.followsOn
    })
  }
  return index
}

/**
 * The round a selection resolves to: a whole round number inside this bracket's depth, defaulting to the
 * outermost. Everything else — absent, fractional, NaN, negative, deeper than the tree — is pulled to the
 * nearest round that exists, because a round control has to point somewhere and an empty panel with no way
 * back is the failure to avoid (ADR-0035: degrade, never throw).
 */
const shownRound = (asked: number | null, bracket: LiveBracket): number => {
  if (asked === null || !Number.isFinite(asked)) return 1
  return Math.min(Math.max(Math.trunc(asked), 1), bracket.totalRounds)
}

/**
 * The public bracket as one finished tree: round columns outermost → final, each cell carrying its two
 * contestant lines, its score, and — when the plan is published — its court and floor (ADR-0070, #311).
 *
 * **The result and the plan come from two different places on purpose.** Score, outcome and status ride the
 * `live` bracket, whose feed is gated on the reveal cursor alone; court and time are joined from `feed`,
 * which is gated on the publish flag. So a reset plan empties every `schedule` and leaves every score
 * standing, and that is the intended reading of the surface, not an inconsistency to smooth over — a result
 * is reality (ADR-0032), a plan is an offer (ADR-0041). The score must never be taken off `feed`.
 *
 * A `segment` of 'consolation' on a field that has none falls back to the main bracket, the same way the
 * schedule's competition filter falls back to „Alle": a selection with nothing behind it would otherwise
 * render an empty tree with no control left to leave it by. A `round` outside the shown segment's depth is
 * clamped into it for the same reason, and clamped against the segment actually shown rather than the one
 * asked for — switching from a four-round main bracket to a one-round consolation must not leave the round
 * control pointing at a column that segment has not got.
 */
export const bracketView = (
  live: Pick<LiveCompetition, 'competition' | 'main' | 'consolation'>,
  feed: Pick<ScheduleResponse, 'matches'>,
  { days, segment = null, round = null }: BracketViewOptions
): BracketView => {
  const hasConsolation = live.consolation !== null
  const shown: BracketSegment = segment === 'consolation' && hasConsolation ? 'consolation' : 'main'
  const bracket: LiveBracket = shown === 'consolation' ? live.consolation! : live.main
  const schedules = scheduleByNode(feed.matches, days)

  const cell = (m: LiveBracketMatch): BracketCell => ({
    number: m.number,
    slot1: cellSlot(m, 1, bracket.redacted),
    slot2: cellSlot(m, 2, bracket.redacted),
    status: m.status,
    statusLabel: m.status === 'running' ? STATUS_LABELS.running : null,
    schedule: schedules.get(scheduleNodeKey(live.competition, shown, m.round, m.position)) ?? null,
    label: m.thirdPlace
      ? roundLabel({ bracket: shown, round: m.round, totalRounds: bracket.totalRounds, thirdPlace: true })
      : null
  })

  // The playoff shares the final's round and would otherwise sit in the final's column as a second cell, so
  // it comes out of the tree here and is handed back on its round instead, under its own label.
  const inTree = new Map<string, LiveBracketMatch>()
  for (const m of bracket.matches) if (!m.thirdPlace) inTree.set(`${m.round}-${m.position}`, m)
  const third = bracket.matches.find(m => m.thirdPlace)

  const rounds = Array.from({ length: bracket.totalRounds }, (_, i): BracketRound => {
    const round = i + 1
    const matchCount = bracket.size / 2 ** round
    return {
      round,
      label: roundLabel({ bracket: shown, round, totalRounds: bracket.totalRounds }),
      name: roundName({ round, totalRounds: bracket.totalRounds }),
      matchCount,
      cells: Array.from({ length: matchCount }, (_, position) => {
        const m = inTree.get(`${round}-${position}`)
        return m ? cell(m) : null
      }),
      // The final's round, wherever the wire says the playoff is played — read off the match rather than
      // assumed to be `totalRounds`, which is the same fact stated twice.
      playoff: third && third.round === round ? cell(third) : null
    }
  })

  return { segment: shown, hasConsolation, size: bracket.size, rounds, round: shownRound(round, bracket) }
}
