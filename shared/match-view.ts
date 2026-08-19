import { COURT_NUMBERS, roundLabel, slotLabel, slotTime, SLOT_SPAN } from './schedule'
import { scoreLine } from './score'
import type { ScheduleMatch, ScheduleResponse, ScheduleSlot } from './admin'
import type { Club } from './club'

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

/**
 * A seeded player's trailing token (#309): the number as it is printed, and the sentence that names it for
 * a reader who cannot see that the small number after a name means a seeding. Both finished, so the
 * renderer prints a token and titles it without knowing what a seed is.
 */
export interface SeedToken {
  text: string
  label: string
}

/**
 * One contestant's line on a match row (CONTEXT: Match row): how they are named, the club behind their
 * crest, their seed token, that slot's set scores, and whether they won.
 *
 * `club` is the one structural value on this interface that is not finished text, and deliberately so: the
 * crest is an image whose URL the page owns (the assets are bundled per surface), so the view names *which*
 * club and the renderer resolves the asset. Null on a placeholder line, which has no person behind it, and
 * null for a club the wire could not name — no crest beats the wrong crest.
 *
 * There is **no `lk`**. The schedule answers „when and where"; „how strong is this half" is the bracket's
 * question. The silence is the row's economy, not an omission (ADR-0070).
 */
export interface RowSlot extends SlotText {
  club: Club | null
  seed: SeedToken | null
  /** „6 3 10", or „" when nothing is recorded — the one score formatter (#305). */
  games: string
  /**
   * The match's outcome, in the score column where a reader looks for it (#309): „· Aufg." behind the sets
   * that were actually played, „w.o." in their place when there are none. Null on a normal scored result,
   * whose sets *are* the outcome — and null on the other contestant's line.
   *
   * It rides a **line** rather than the match because the score column is per line, and *which* line the
   * token belongs on is a decision, not a rendering detail: it goes on the winner's, the way a result is
   * quoted („6:3 3:1 Aufg."), so the renderer prints it beside that line's games and inherits the
   * alignment for free. Finished including its separator, so nothing is concatenated downstream — which is
   * also how a retirement before the first set was saved avoids a „·" dangling off nothing.
   */
  outcome: string | null
  /**
   * Whether this line won. One fact, read twice by the renderer — bold **and** a check. The redundancy is
   * the reference tournaments' convention and it is deliberate: it survives a phone in bright sunlight,
   * where a weight difference alone does not.
   */
  winner: boolean
}

/**
 * One match as the schedule reads it (CONTEXT: Match row). Every field is finished display text except the
 * structural ones the renderer needs for its classes (`id`, `status`, `followsOn`).
 */
export interface MatchRow {
  id: number
  /** „ab 10:30" or „im Anschluss · nicht vor ca. 12:00" — a floor, never a point (ADR-0069). */
  publishedTime: string
  /**
   * Whether that floor is a follow-on rather than an anchored start. Carried as a fact rather than left for
   * a caller to recover from the string: re-reading a decision out of finished German prose is the seam
   * leaking, and a reworded label would silently stop matching.
   */
  followsOn: boolean
  slot1: RowSlot
  slot2: RowSlot
  /** „Achtelfinale · M3 · Herren" — round, match number, competition, and nothing else. */
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

interface CourtCellBase {
  court: number
  label: string
  /** Whether the cell sits outside the filtered field — faded back, never relabelled „frei". */
  dim: boolean
}

/** A court with nothing on it right now. It carries no contestants, so it cannot be asked for any. */
export interface FreeCourtCell extends CourtCellBase {
  free: true
}

/** A court with a match on it right now: its two contestants and „Achtelfinale · Herren". */
export interface LiveCourtCell extends CourtCellBase {
  free: false
  slot1: RowSlot
  slot2: RowSlot
  meta: string
}

/**
 * One cell of the „Jetzt auf dem Platz" board: what is on this court **right now**. Live truth, so it is
 * driven by the match status and never by the plan — a `planned` match leaves its court „frei".
 *
 * A union rather than a cell with nullable contestants, so „is this court free" has exactly one answer a
 * caller can branch on, and an empty cell cannot be asked for a name that is not there.
 */
export type CourtCell = FreeCourtCell | LiveCourtCell

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

// The terse token a special outcome reads as in the **score column** (#309, ADR-0032) — the abbreviations a
// tennis reader already knows, not the spelled-out „Walkover"/„Aufgabe" that used to sit at the far end of
// the meta line. A normal scored result carries no token: its set scores are the result.
const OUTCOME_TOKENS: Record<NonNullable<ScheduleMatch['outcome']>, string> = {
  walkover: 'w.o.',
  retirement: 'Aufg.'
}

/**
 * How the outcome is said in the score column, and on which contestant's line.
 *
 * The token goes on the **winner's** line, the way a result is quoted — „6:3 3:1 Aufg." — so it reads
 * behind the sets rather than beside the name of whoever stopped. With no winner recorded (only reachable
 * for a decided match whose winning slot no longer resolves, ADR-0035) it falls to the first line, because
 * the outcome is still true of the match and dropping it would leave a finished row looking unplayed.
 *
 * A retirement follows the sets already played, so it takes a separator — unless there are none, which is
 * reachable: a player can retire during the first set before anyone saved it, and a leading „·" would then
 * hang off nothing. A walkover never has sets (the score rules reject one, ADR-0045), so its token stands
 * alone in the score's place.
 */
const outcomeToken = (match: ScheduleMatch, slot: 1 | 2): string | null => {
  if (!match.outcome) return null
  if (slot !== (match.winner ?? 1)) return null
  const token = OUTCOME_TOKENS[match.outcome]
  const played = scoreLine(match.score, 1) !== '' || scoreLine(match.score, 2) !== ''
  return match.outcome === 'retirement' && played ? `· ${token}` : token
}

// A player's name, or the shared German label for a „Freilos"/„Sieger M{n}"/„Verlierer M{n}"/„offen" line.
// A player slot with no name left in it falls through to „offen" rather than rendering a blank line — the
// „it never throws" promise reaches the empty case, not only the unknown one (ADR-0035).
const slotText = (slot: ScheduleSlot): SlotText => {
  if (slot.kind !== 'player') return { text: slotLabel(slot), tbd: true }
  const name = `${slot.firstName} ${slot.lastName}`.trim()
  return name ? { text: name, tbd: false } : { text: slotLabel({ kind: 'unknown' }), tbd: true }
}

// The seed as the small trailing token the references all put behind the name, plus the sentence that says
// what the number is — a bare „3" beside a name means nothing read aloud.
const seedToken = (seed: number | null): SeedToken | null =>
  seed === null ? null : { text: String(seed), label: `An ${seed} gesetzt` }

const rowSlot = (match: ScheduleMatch, slot: 1 | 2): RowSlot => {
  const wire = slot === 1 ? match.slot1 : match.slot2
  return {
    ...slotText(wire),
    // A placeholder line („Freilos", „Sieger M3", „offen") has no person behind it, so it flies no crest and
    // wears no seed — the two fall out of the wire's discriminator rather than needing a rule of their own.
    club: wire.kind === 'player' ? wire.club : null,
    seed: wire.kind === 'player' ? seedToken(wire.seed) : null,
    games: scoreLine(match.score, slot),
    outcome: outcomeToken(match, slot),
    winner: match.winner === slot
  }
}

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

// The floor as both the sentence a reader gets and the fact a caller styles on — one return, so the two
// can never disagree and nobody has to recover the second by pattern-matching the first.
interface PublishedTime {
  label: string
  followsOn: boolean
}

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
 *
 * Abutting is `previousSlot + SLOT_SPAN` **exactly**. On a valid plan there is no other way for two
 * reservations to meet: court occupancy is interval-based and server-enforced (ADR-0040), so two starts on
 * one court are never fewer than SLOT_SPAN steps apart. A closer pair can still reach this page — the feed
 * reports a **running** match on its *actual* court (ADR-0032), so an operator who moves a live match onto
 * a busy court puts it inside that court's chain. That is an overlap, not a follow-on: the previous
 * reservation is still covering this start, so „nicht vor ca. HH:MM" would state a floor already known to
 * be broken. It anchors instead, which is the weaker and therefore safe claim.
 */
const publishedTime = (day: number, slot: number, previousSlot: number | null): PublishedTime => {
  const clock = slotTime(day, slot)
  const followsOn = previousSlot !== null && slot === previousSlot + SLOT_SPAN
  return { label: followsOn ? `im Anschluss · nicht vor ca. ${clock}` : `ab ${clock}`, followsOn }
}

// ── The filter ───────────────────────────────────────────────────────────────────────────────────

// What the filter offers: the fields the feed carries, in display order — but nothing at all below two,
// because a single field is not a choice. This is also how a cancelled field leaves the filter (ADR-0062):
// the feed stops carrying its matches, so it stops being an option, and nobody has to tell the filter.
const filterOptions = (
  competitions: readonly CompetitionOption[],
  matches: readonly ScheduleMatch[]
): CompetitionOption[] => {
  const present = competitions.filter(c => matches.some(m => m.competition === c.slug))
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

  const row = (m: ScheduleMatch, previousSlot: number | null): MatchRow => {
    const { label, followsOn } = publishedTime(m.day, m.slot, previousSlot)
    return {
      id: m.id,
      publishedTime: label,
      followsOn,
      slot1: rowSlot(m, 1),
      slot2: rowSlot(m, 2),
      meta: [roundText(m), `M${m.number}`, competitionLabel(competitions, m.competition)].join(' · '),
      status: m.status,
      statusLabel: STATUS_LABELS[m.status]
    }
  }

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

  const courts = COURT_NUMBERS.map((court): CourtCell => {
    const live = running.get(court)
    // Courts outside the focused field fade back — including free ones — so „mein Feld" pops without ever
    // relabelling a physically busy court „frei".
    const base = { court, label: courtLabel(court), dim: selected !== null && live?.competition !== selected }
    if (!live) return { ...base, free: true }
    return {
      ...base,
      free: false,
      slot1: rowSlot(live, 1),
      slot2: rowSlot(live, 2),
      meta: `${roundText(live)} · ${competitionLabel(competitions, live.competition)}`
    }
  })

  return { competitions: offered, selected, courts, days: dayGroups.filter(d => d.courts.length > 0) }
}
