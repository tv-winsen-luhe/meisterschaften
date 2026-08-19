import { COURT_NUMBERS, roundLabel, slotLabel, slotTime, SLOT_SPAN } from './schedule'
import { scoreLine } from './score'
import type { ScheduleMatch, ScheduleResponse, ScheduleSlot } from './admin'

/**
 * The public weekend surfaces' projection (ADR-0069): the one place that turns a feed into the finished
 * tree a page renders. Pure computation — no I/O, no state, no clock — so it is tested directly through its
 * interface, and it joins the display layer beside `slotLabel`, `roundLabel` and `slotGames` rather than
 * growing `schedule.ts`, which is at its size budget (ADR-0068). The schedule view is here; the public
 * bracket's view joins it as a second entry point (#304).
 *
 * Four facts about this interface, each load-bearing:
 *
 * 1. **The returned tree is fully ordered.** Callers render in iteration order and never sort — a sort in a
 *    renderer is a decision escaping the seam.
 * 2. **Every string is finished, user-facing German.** Callers never concatenate. This is the rule that
 *    stops the separator divergence the two inline score joins used to have (#305).
 * 3. **It never throws.** An unresolvable slot and a missing player both degrade to „offen" (ADR-0035).
 * 4. **There is no clock.** `now` is not a parameter and is never read: the published time falls out of
 *    day, slot and the court's reservation chain alone, and „läuft" comes from the match status, not from a
 *    time comparison (ADR-0032). So the module needs no fake clock to test.
 *
 * The event's date copy and the competition labels are **passed in** rather than imported: they live with
 * the client (src/data/tournament.ts), and `shared/` must not reach into it. They are data, like the feed —
 * not an injected dependency the module could be handed a different implementation of.
 */

// ── The vocabulary a page renders ────────────────────────────────────────────────────────────────

/**
 * How a contestant is named: their finished display text, and whether it is a placeholder („Freilos",
 * „Sieger M3", „offen") rather than a person — a placeholder renders muted (ADR-0035).
 */
export interface SlotText {
  text: string
  tbd: boolean
}

/** One contestant's line on a match row: how they are named, that slot's set scores, and whether they won. */
export interface RowSlot extends SlotText {
  /** „6 3 10", or „" when nothing is recorded — the one score formatter (#305). */
  games: string
  winner: boolean
}

/**
 * One match as the schedule reads it (CONTEXT: Match row). Every field is finished display text except the
 * two structural ones the renderer needs for its classes (`id`, `status`).
 */
export interface MatchRow {
  id: number
  /** „ab 10:30" or „im Anschluss · nicht vor ca. 12:00" — a floor, never a point (ADR-0069). */
  time: string
  slot1: RowSlot
  slot2: RowSlot
  /** „Achtelfinale · M3 · Herren", with „· Walkover"/„· Aufgabe" appended for a special outcome. */
  meta: string
  status: ScheduleMatch['status']
  /** „geplant" / „läuft" / „beendet". */
  statusLabel: string
}

/** One court's column within a day: „Platz 3" and its matches in order of play. */
export interface CourtGroup {
  court: number
  label: string
  rows: MatchRow[]
}

/** One event day: „Samstag · 22.08." and the courts that carry a match on it, ascending. */
export interface DayGroup {
  day: number
  label: string
  courts: CourtGroup[]
}

/**
 * One cell of the „Jetzt auf dem Platz" board: what is on this court **right now**. Live truth, so it is
 * driven by the match status and never by the plan — a `planned` match leaves its court „frei".
 */
export interface CourtCell {
  court: number
  label: string
  free: boolean
  /** Whether the cell sits outside the filtered field — faded back, never relabelled „frei". */
  dim: boolean
  slot1: RowSlot | null
  slot2: RowSlot | null
  /** „Achtelfinale · Herren", or „" for a free court. */
  meta: string
}

/** A competition the filter may offer: its wire slug and its German label. */
export interface CompetitionOption {
  slug: string
  label: string
}

export interface ScheduleView {
  /**
   * The filter's options, in display order: the fields the feed actually carries, or empty when there is
   * nothing to choose between (fewer than two). A caller renders whatever arrives and hides an empty list.
   */
  competitions: CompetitionOption[]
  /** The selection that actually applies (see `effectiveSelection` below). */
  selected: string | null
  courts: CourtCell[]
  days: DayGroup[]
}

/** One event day's copy, indexed by the wire `day` — „Samstag" + „22.08.". */
export interface DayCopy {
  weekday: string
  short: string
}

export interface ScheduleViewOptions {
  days: readonly DayCopy[]
  /** Every competition the client knows, in display order; the view keeps the ones the feed carries. */
  competitions: readonly CompetitionOption[]
  /** The competition filter's selection, or null/absent for „Alle". */
  competition?: string | null
}

// ── The pieces every row is made of ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ScheduleMatch['status'], string> = {
  planned: 'geplant',
  running: 'läuft',
  done: 'beendet'
}

// The German note for a special outcome (ADR-0032), appended to a finished match's meta line. A normal
// scored result carries no note — its set scores are the result.
const OUTCOME_NOTES: Record<NonNullable<ScheduleMatch['outcome']>, string> = {
  walkover: 'Walkover',
  retirement: 'Aufgabe'
}

// A player's name, or the shared German label for a „Freilos"/„Sieger M{n}"/„Verlierer M{n}"/„offen" line.
// A player slot with no name left in it falls through to „offen" rather than rendering a blank line — the
// „it never throws" promise reaches the empty case, not only the unknown one (ADR-0035).
const slotText = (slot: ScheduleSlot): SlotText => {
  if (slot.kind !== 'player') return { text: slotLabel(slot), tbd: true }
  const name = `${slot.firstName} ${slot.lastName}`.trim()
  return name ? { text: name, tbd: false } : { text: slotLabel({ kind: 'unknown' }), tbd: true }
}

const rowSlot = (match: ScheduleMatch, slot: 1 | 2): RowSlot => ({
  ...slotText(slot === 1 ? match.slot1 : match.slot2),
  games: scoreLine(match.score, slot),
  winner: match.winner === slot
})

const courtLabel = (court: number): string => `Platz ${court}`

// The field's German label; falls back to the wire slug rather than rendering nothing for a field whose
// label the client's copy does not know.
const competitionLabel = (competitions: readonly CompetitionOption[], slug: string): string =>
  competitions.find(c => c.slug === slug)?.label ?? slug

// The round name („Achtelfinale" … „Finale", „Nebenrunde · …", „Spiel um Platz 3") — the shared
// `roundLabel` (ADR-0028), so it reads identically on the admin grid and on both public surfaces.
const roundText = (m: ScheduleMatch): string =>
  roundLabel({ bracket: m.bracket, round: m.round, totalRounds: m.totalRounds, thirdPlace: m.thirdPlace })

// ── The published time (ADR-0069) ────────────────────────────────────────────────────────────────

/**
 * How a match's planned start is *said*. The 90 minutes behind a placement is a court **reservation** built
 * from experience, not a match length, so a later match's clock time is only ever wrong in one direction —
 * late. The page therefore states a floor:
 *
 * - **„ab HH:MM"** when nothing on this court is reserved to run into this match: its first match of the
 *   day, and every match that opens a new block after a gap. Nothing can push it, so its time holds.
 * - **„im Anschluss · nicht vor ca. HH:MM"** when the previous reservation on this court abuts this one.
 *   „Im Anschluss" alone would leave a player without anything to plan against, so the floor stays.
 *
 * `previousSlot` is the start of the preceding reservation **on the same court and day**, or null for the
 * first. A gap breaks the chain: that is the point where the Grand Slam convention is not copied blindly
 * but fed with the grid information we actually have — a mixer block, an evening window or plain air makes
 * a real hole, and a row after a hole re-anchors.
 */
const publishedTime = (day: number, slot: number, previousSlot: number | null): string => {
  const clock = slotTime(day, slot)
  const abuts = previousSlot !== null && slot <= previousSlot + SLOT_SPAN
  return abuts ? `im Anschluss · nicht vor ca. ${clock}` : `ab ${clock}`
}

// ── The filter ───────────────────────────────────────────────────────────────────────────────────

// What the filter offers: the fields the feed carries, in display order — but nothing at all below two,
// because a single field is not a choice. This is also how a cancelled field leaves the filter (ADR-0062):
// the feed stops carrying its matches, so it stops being an option, and nobody has to tell the filter.
const filterOptions = (
  competitions: readonly CompetitionOption[],
  matches: readonly ScheduleMatch[]
): CompetitionOption[] => {
  const present = competitions.filter(c => matches.some(m => m.competition === c.slug)).map(c => ({ ...c }))
  return present.length < 2 ? [] : present
}

// The selection that actually applies. A field that is not on offer — dropped by a reset, cancelled, or
// alone on a page with nothing to choose between — falls back to „Alle", because a selection that stuck
// there would narrow the page with no chip left to widen it again.
const effectiveSelection = (offered: CompetitionOption[], selected: string | null): string | null =>
  selected !== null && offered.some(c => c.slug === selected) ? selected : null

// ── The interface ────────────────────────────────────────────────────────────────────────────────

/**
 * The public schedule as one finished tree: the courts board, the filter's options, and the matches grouped
 * **day → court** with each court's column in order of play (ADR-0069, #308).
 *
 * The grouping is fixed rather than a two-way toggle on purpose: „im Anschluss" only means anything inside
 * one court's column. In a day list ordered by time it would point at the row above, which is on another
 * court, and the sentence would be false. „What is on right now" is the courts board's question, not the
 * schedule's.
 *
 * The competition filter narrows the **rows**, never the chain: a court's reservation chain is a fact about
 * the court, so it is built from every match on it before the filter applies. Hiding a men's match must not
 * promote the women's match behind it from „im Anschluss" to „ab".
 */
export const scheduleView = (
  feed: Pick<ScheduleResponse, 'matches'>,
  { days, competitions, competition = null }: ScheduleViewOptions
): ScheduleView => {
  const { matches } = feed
  const offered = filterOptions(competitions, matches)
  const selected = effectiveSelection(offered, competition)

  const row = (m: ScheduleMatch, previousSlot: number | null): MatchRow => ({
    id: m.id,
    time: publishedTime(m.day, m.slot, previousSlot),
    slot1: rowSlot(m, 1),
    slot2: rowSlot(m, 2),
    meta: [roundText(m), `M${m.number}`, competitionLabel(competitions, m.competition)]
      .concat(m.outcome ? [OUTCOME_NOTES[m.outcome]] : [])
      .join(' · '),
    status: m.status,
    statusLabel: STATUS_LABELS[m.status]
  })

  // Day → court, both ascending and both derived from what the feed carries, so a match is never dropped
  // because an axis was sized from a constant that has moved on.
  const dayIndices = [...new Set(matches.map(m => m.day))].sort((a, b) => a - b)
  const dayGroups = dayIndices.map(day => {
    const onDay = matches.filter(m => m.day === day)
    const courts = [...new Set(onDay.map(m => m.court))].sort((a, b) => a - b)
    return {
      day,
      label: days[day] ? `${days[day].weekday} · ${days[day].short}` : `Tag ${day + 1}`,
      courts: courts
        .map(court => {
          // The whole court's chain first — then the filter, so the time statements survive it.
          const chain = onDay.filter(m => m.court === court).sort((a, b) => a.slot - b.slot || a.id - b.id)
          const rows = chain
            .map((m, i) => ({ m, row: row(m, i === 0 ? null : chain[i - 1].slot) }))
            .filter(({ m }) => selected === null || m.competition === selected)
            .map(({ row: r }) => r)
          return { court, label: courtLabel(court), rows }
        })
        .filter(group => group.rows.length > 0)
    }
  })

  // The courts board: at most one running match per court (occupancy is server-enforced), and the feed's
  // `court` is already the *actual* live court for a running match (ADR-0032), so this indexes by reality.
  const running = new Map<number, ScheduleMatch>()
  for (const m of matches) if (m.status === 'running') running.set(m.court, m)

  const courts = COURT_NUMBERS.map(court => {
    const live = running.get(court)
    return {
      court,
      label: courtLabel(court),
      free: !live,
      // Courts outside the focused field fade back — including free ones — so „mein Feld" pops without
      // ever relabelling a physically busy court „frei".
      dim: selected !== null && live?.competition !== selected,
      slot1: live ? rowSlot(live, 1) : null,
      slot2: live ? rowSlot(live, 2) : null,
      meta: live ? `${roundText(live)} · ${competitionLabel(competitions, live.competition)}` : ''
    }
  })

  return { competitions: offered, selected, courts, days: dayGroups.filter(d => d.courts.length > 0) }
}
