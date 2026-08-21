import {
  bracketDepth,
  type CompetitionDraw,
  type CompetitionOption,
  courtLabel,
  dayAbbr,
  type DayCopy,
  dayLabel,
  type Match,
  resolveBracket,
  roundLabel,
  type SlotView,
  slotTime
} from '../../../shared'

// The Ergebnisse surface's two readings (ADR-0077), as pure functions: the round view's meta line, the
// court view's day → court → chronological grouping, and the court text both share.
//
// It groups locally over the `Match[]` the surface already holds rather than reusing the public
// `scheduleView()`. That projection is built to *exclude* what this surface must show — unplaced matches
// (its row type has court/day/slot non-nullable, since only placed matches ship), the unpublished plan,
// reveal-gated fields — and to *add* what this surface must not have: the „ca." hedge. The hedge states
// what can still move a start, and the operator is what moves it, so the admin reads a plain clock time.
// Copy arrives as options, the same convention `scheduleView` uses, so no German literal lives here except
// the two this module owns outright.

// Which reading the surface is in. „Runde" is the status quo and the default; „Platz" is the court view.
export type Grouping = 'round' | 'court'

// „Nicht geplant" — the court view's trailing group *and* what a round-view row says where its court would
// be. One name, because they are the same fact, and it is already the Spielplan's word for its backlog tray.
const BACKLOG_LABEL = 'Nicht geplant'

// One match resolved for the list: the wire row plus its display number, round name and two slot views
// (player names joined by the caller, feeders/byes labelled by the shared copy). Lives here rather than in
// the surface so this module and its tests do not import a component to get at a type.
export interface ResultMatch {
  match: Match
  number: number
  roundLabel: string
  slot1: SlotView
  slot2: SlotView
}

// The German the two readings need, passed in rather than imported, so every string this module returns is
// finished copy from the copy's home (src/data/tournament.ts) and the tests can assert on it.
export interface ResultsCopy {
  days: readonly DayCopy[]
  competitions: readonly CompetitionOption[]
}

// One bracket's real matches, resolved + numbered over its whole set (so „Sieger M{n}" is stable). Runs per
// bracket, so the consolation labels read „Nebenrunde · …" off its own depth. Both readings start here: the
// round view groups these by round label, the court view pours every bracket's into one event-wide set.
export const resultRows = (draw: CompetitionDraw): ResultMatch[] => {
  const totalRounds = bracketDepth(draw.matches)
  const rows: ResultMatch[] = []
  for (const { match, number, slot1, slot2 } of resolveBracket(draw.matches)) {
    if (match.outcome === 'bye') continue // a bye is never played, so it is never a result row
    rows.push({
      match,
      number,
      roundLabel: roundLabel({ bracket: draw.bracket, round: match.round, totalRounds, thirdPlace: match.thirdPlace }),
      slot1,
      slot2
    })
  }
  return rows
}

/**
 * A bracket's rows grouped by round label in match order — the third-place playoff sorts after the final (it
 * shares the final's round but a higher position). The caller concatenates a competition's brackets (main
 * first, then consolation).
 */
export const matchGroups = (draw: CompetitionDraw): [string, ResultMatch[]][] => {
  const byLabel = new Map<string, ResultMatch[]>()
  for (const r of resultRows(draw).sort(
    (a, b) => a.match.round - b.match.round || a.match.position - b.match.position
  )) {
    const list = byLabel.get(r.roundLabel) ?? []
    list.push(r)
    byLabel.set(r.roundLabel, list)
  }
  return [...byLabel.entries()]
}

/**
 * The court a match is actually on: the actual court once one is captured, else the planned court, else
 * null. ADR-0032 captures the actual court at the `running` transition *because* it diverges, and the court
 * view answers „was läuft auf Platz 3" — so it has to group by reality, exactly as the public page does.
 * Not conditioned on the status: a `liveCourt` is only ever written by that transition, and it stays true
 * after the match is done.
 */
export const effectiveCourt = (match: Pick<Match, 'court' | 'liveCourt'>): number | null =>
  match.liveCourt ?? match.court

/**
 * What a row says about its court: „Platz 3" normally, „Platz 3 (geplant 5)" when the match is being played
 * somewhere other than where it was planned, and nothing at all when it has no placement (the surface's own
 * „Zum Starten erst im Spielplan platzieren" hint covers that case, and is the only thing that should).
 * The divergence is stated rather than resolved silently: on this surface a mis-started match is something
 * the operator wants to notice.
 */
export const courtText = (match: Pick<Match, 'court' | 'liveCourt'>): string | null => {
  const court = effectiveCourt(match)
  if (court === null) return null
  const diverged = match.liveCourt !== null && match.court !== null && match.court !== match.liveCourt
  return diverged ? `${courtLabel(court)} (geplant ${match.court})` : courtLabel(court)
}

// A placement's plain clock time — never hedged with „ca.", which is the public announcement's device
// (ADR-0077 rule 1). Null when the match is unplaced. `withDay` because both event days share one slot
// numbering: „14:00" alone names two different afternoons, so the round view prefixes the day while the
// court view lets its heading say it.
const timeText = (match: Pick<Match, 'day' | 'slot'>, days: readonly DayCopy[], withDay: boolean): string | null => {
  if (match.day === null || match.slot === null) return null
  const clock = slotTime(match.day, match.slot)
  return withDay ? `${dayAbbr(days, match.day)} ${clock}` : clock
}

// The field's German label; falls back to the wire slug rather than rendering nothing for a field whose
// label the copy does not know.
const competitionText = (competitions: readonly CompetitionOption[], slug: string): string =>
  competitions.find(c => c.slug === slug)?.label ?? slug

/**
 * A row's meta line, as the parts a renderer joins — each view carrying what its own headings do not.
 * The round view is headed by the round, so the row states the day, the time and the court. The court view
 * is headed by the day and the court, so the row states the bare time, the round, and the **field**: the
 * tabs are hidden there, which makes the competition the one thing a court group cannot tell you.
 * Never one identical line for both — the duplication would be loudest where the surface is densest.
 */
export const metaParts = (row: ResultMatch, grouping: Grouping, copy: ResultsCopy): string[] => {
  // A row with no court sits under „Nicht geplant" in the court view — a heading that names no day — so the
  // time keeps its day prefix there, and in the round view the missing court is *said* rather than left
  // silent: the row's own start hint only renders for a `planned` match with both players known.
  const placed = effectiveCourt(row.match) !== null
  return (
    grouping === 'round'
      ? [timeText(row.match, copy.days, true), courtText(row.match) ?? BACKLOG_LABEL]
      : [
          timeText(row.match, copy.days, !placed),
          row.roundLabel,
          competitionText(copy.competitions, row.match.competition)
        ]
  ).filter((p): p is string => p !== null)
}

// One court's rows inside a day. A null label is the „Nicht geplant" group's single section: there is no
// court to name, so the renderer prints no court heading.
export interface CourtSection {
  label: string | null
  rows: ResultMatch[]
}

// One day of the court view, or the trailing „Nicht geplant" group.
export interface DaySection {
  label: string
  courts: CourtSection[]
}

/**
 * The court view: day → court → chronological, the hierarchy the public page fixed (ADR-0071 §5), so the
 * operator and the grounds read the same shape. Empty courts and empty days are dropped — six „frei"
 * headings a day is scroll spent before the content starts. Matches with no placement collect in one
 * trailing „Nicht geplant" group rather than vanishing: those are exactly the rows whose result may still
 * need entering for a match played off-plan.
 */
export const courtSections = (rows: readonly ResultMatch[], copy: ResultsCopy): DaySection[] => {
  const placed: ResultMatch[] = []
  const unplaced: ResultMatch[] = []
  for (const row of rows) {
    const hasPlacement = effectiveCourt(row.match) !== null && row.match.day !== null
    ;(hasPlacement ? placed : unplaced).push(row)
  }

  // day → court → rows, built from the values actually present so nothing empty can be emitted.
  const byDay = new Map<number, Map<number, ResultMatch[]>>()
  for (const row of placed) {
    const day = row.match.day as number
    const court = effectiveCourt(row.match) as number
    const courts = byDay.get(day) ?? new Map<number, ResultMatch[]>()
    const list = courts.get(court) ?? []
    list.push(row)
    courts.set(court, list)
    byDay.set(day, courts)
  }

  const sections: DaySection[] = [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, courts]) => ({
      label: dayLabel(copy.days, day),
      courts: [...courts.entries()]
        .sort(([a], [b]) => a - b)
        .map(([court, courtRows]) => ({
          label: courtLabel(court),
          // Chronological within the court; a placed match always has a slot, so the fallback only keeps a
          // half-placed row from sorting as NaN.
          rows: [...courtRows].sort((a, b) => (a.match.slot ?? 0) - (b.match.slot ?? 0) || a.match.id - b.match.id)
        }))
    }))

  if (unplaced.length > 0) sections.push({ label: BACKLOG_LABEL, courts: [{ label: null, rows: unplaced }] })
  return sections
}
