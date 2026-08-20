import { COURT_NUMBERS, roundLabel, slotLabel, slotTime, SLOT_SPAN } from './schedule'
import { scoreLine } from './score'
import type { LiveBracketSlot, MatchScore, ScheduleMatch, ScheduleResponse, ScheduleSlot } from './admin'
import type { Club } from './club'

/**
 * The public weekend surfaces' projection (ADR-0069): the one place that turns a feed into the finished
 * tree a page renders. Pure computation — no I/O, no state, no clock — so it is tested directly through its
 * interface, and it joins the display layer beside `slotLabel`, `roundLabel` and `slotGames` rather than
 * growing `schedule.ts`, which is at its size budget (ADR-0068). The schedule view is here; the public
 * bracket's view is the second entry point (#311) and lives in the sibling `bracket-view.ts` — a different
 * tree, the same row inside it. The two are one seam split across two files only because a file here is
 * capped at 300 code lines; what they share — the row, the score column, the reservation chain — is exported
 * from here and imported there, so neither can grow its own second answer to a question this one settles.
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
  /** „10:00" when nothing can push it, „ca. 12:00" when it follows on that court (ADR-0071). */
  publishedTime: string
  /**
   * Whether that time is a follow-on rather than an anchored start. Carried as a fact rather than left for
   * a caller to recover from the string: re-reading a decision out of finished German prose is the seam
   * leaking, and a reworded label would silently stop matching. It is also the only thing a renderer can
   * style on — „ca." is two characters, and two characters do not survive a phone in bright sunlight.
   */
  followsOn: boolean
  slot1: RowSlot
  slot2: RowSlot
  /** „Achtelfinale · M3 · Herren" — round, match number, competition, and nothing else. */
  meta: string
  status: ScheduleMatch['status']
  /**
   * „läuft", and **only** that — null for a planned or a finished match, exactly as the bracket cell has
   * read since ADR-0070 (see `BracketCell.statusLabel`). „geplant" was the default state printed on every
   * row of the page, and „beendet" explained a row that already carries „6:4 6:2". Both views take the
   * decision from `statusLabel` below, so neither can answer it differently.
   */
  statusLabel: string | null
}

/**
 * What stands in for a group of matches that names nobody yet (#333): how many matches wait there and
 * roughly when the first of them starts, as one finished line.
 *
 * The block is specified as stating both facts (#333), so `matchCount` and `earliestTime` are carried as
 * facts rather than only baked into the sentence: what the block must say is then asserted directly instead
 * of by pattern-matching German that a rewording would silently break.
 */
export interface UndeterminedRound {
  /** „3 Spiele · ab ca. 11:30 · noch ohne Namen" — the whole block's line. */
  summary: string
  matchCount: number
  /** The block's earliest Published time, hedged where the court's reservations touch it (ADR-0071). */
  earliestTime: string
}

/** One court's column within a day: „Platz 3" and its matches in order of play. */
export interface CourtGroup {
  court: number
  label: string
  rows: MatchRow[]
  /**
   * Non-null when **every** match in this column has a feeder placeholder for both contestants — Sunday's
   * wall of „Sieger M11 — Sieger M12" — and then it is the summary the column collapses to. Null the moment
   * one real player is in there, because a column that names somebody is worth reading down.
   *
   * Decided here rather than in the renderer: „does this group name anybody" is a statement about the
   * content, and a renderer that answered it would have to inspect slot kinds — reading the wire's
   * discriminator back out of a finished tree, which is the seam leaking. Whether the block is **open** is
   * the renderer's own state; it is not a fact about the schedule.
   */
  undetermined: UndeterminedRound | null
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
  /**
   * The „Jetzt auf dem Platz" board's six cells, or **absent** when no match is running (#347). The board
   * answers one question — „what is on right now" — so with nothing running it has no answer and no job:
   * the caller renders no section rather than a heading over six „frei" cells, and what is *next* stays the
   * rows' job. Absent rather than an empty array, so „there is no board" and „the board is empty" cannot be
   * confused; the rule reads the running status alone and admits no clock.
   */
  courts?: CourtCell[]
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

/**
 * The three fields a match's **score column** is a function of. Both wires carry them — the schedule feed
 * since #91, the draw wire since ADR-0070 — so the column is computed once here rather than once per
 * surface. Named for the row rather than for the match (shared/advancement already owns `MatchResult`, a different idea entirely), and structural rather than a union of the two match types, so neither surface's unrelated fields
 * leak into the rule.
 */
export interface RowResult {
  winner: 1 | 2 | null
  outcome: NonNullable<ScheduleMatch['outcome']> | null
  score: MatchScore
}

/**
 * A contestant slot as either wire spells it. The two agree on the discriminator and on every placeholder
 * member, and differ only in what a **player** carries: the schedule joins the club (for the crest), the
 * draw joins the LK (the bracket's strength signal). Everything the shared row reads sits in the
 * intersection; each extra is picked up only where it exists.
 */
export type ViewSlot = ScheduleSlot | LiveBracketSlot

/**
 * The three states a match is in, said in German — the vocabulary for **Match status**, which is why all
 * three stay here even though the public surfaces print only one of them (see `statusLabel`).
 */
export const STATUS_LABELS: Record<ScheduleMatch['status'], string> = {
  planned: 'geplant',
  running: 'läuft',
  done: 'beendet'
}

/**
 * Which state a public surface **marks**: „läuft", and only that. The one state a reader needs marked is the
 * match on court right now — a finished match says so with its score, a planned one with its time — and a
 * „geplant" badge would sit on twenty-odd rows of a fresh page at once, marking nothing by marking
 * everything.
 *
 * One function rather than the same conditional in the row and in the cell (#327): a badge rule that lives
 * in two places is a badge rule that drifts, and this one already did — the cell has read this way since
 * ADR-0070 while the row still printed all three.
 */
export const statusLabel = (status: ScheduleMatch['status']): string | null =>
  status === 'running' ? STATUS_LABELS.running : null

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
const outcomeToken = (match: RowResult, slot: 1 | 2): string | null => {
  if (!match.outcome) return null
  if (slot !== (match.winner ?? 1)) return null
  const token = OUTCOME_TOKENS[match.outcome]
  const played = scoreLine(match.score, 1) !== '' || scoreLine(match.score, 2) !== ''
  return match.outcome === 'retirement' && played ? `· ${token}` : token
}

// A player's name, or the shared German label for a „Freilos"/„Sieger M{n}"/„Verlierer M{n}"/„offen" line.
// A player slot with no name left in it falls through to „offen" rather than rendering a blank line — the
// „it never throws" promise reaches the empty case, not only the unknown one (ADR-0035).
const slotText = (slot: ViewSlot): SlotText => {
  if (slot.kind !== 'player') return { text: slotLabel(slot), tbd: true }
  const name = `${slot.firstName} ${slot.lastName}`.trim()
  return name ? { text: name, tbd: false } : { text: slotLabel({ kind: 'unknown' }), tbd: true }
}

// The seed as the small trailing token the references all put behind the name, plus the sentence that says
// what the number is — a bare „3" beside a name means nothing read aloud.
const seedToken = (seed: number | null): SeedToken | null =>
  seed === null ? null : { text: String(seed), label: `An ${seed} gesetzt` }

export const rowSlot = (match: RowResult, wire: ViewSlot, slot: 1 | 2): RowSlot => ({
  ...slotText(wire),
  // A placeholder line („Freilos", „Sieger M3", „offen") has no person behind it, so it flies no crest and
  // wears no seed — the two fall out of the wire's discriminator rather than needing a rule of their own.
  // A bracket line carries no crest either: the draw wire never joined the club. Its strength signal is the
  // LK, which the cell adds beside this shape rather than inside it (see `cellSlot`).
  club: wire.kind === 'player' && 'club' in wire ? wire.club : null,
  seed: wire.kind === 'player' ? seedToken(wire.seed) : null,
  games: scoreLine(match.score, slot),
  outcome: outcomeToken(match, slot),
  winner: match.winner === slot
})

// The schedule feed's row: both slots come off the one wire match, so the shared piece above keeps only
// what the two surfaces genuinely share and neither has to hand it a slot it does not have.
const scheduleRowSlot = (match: ScheduleMatch, slot: 1 | 2): RowSlot =>
  rowSlot(match, slot === 1 ? match.slot1 : match.slot2, slot)

export const courtLabel = (court: number): string => `Platz ${court}`

// The field's German label; falls back to the wire slug rather than rendering nothing for a field whose
// label the client's copy does not know.
const competitionLabel = (competitions: readonly CompetitionOption[], slug: string): string =>
  competitions.find(c => c.slug === slug)?.label ?? slug

// The round name („Achtelfinale" … „Finale", „Nebenrunde · …", „Spiel um Platz 3") — the shared
// `roundLabel` (ADR-0028), so it reads identically on the admin grid and on both public surfaces.
const roundText = (m: ScheduleMatch): string =>
  roundLabel({ bracket: m.bracket, round: m.round, totalRounds: m.totalRounds, thirdPlace: m.thirdPlace })

// ── The published time (ADR-0071, revising ADR-0069) ─────────────────────────────────────────────

// The time as both the sentence a reader gets and the fact a caller styles on — one return, so the two
// can never disagree and nobody has to recover the second by pattern-matching the first.
export interface PublishedTime {
  label: string
  followsOn: boolean
}

/**
 * How a match's planned start is *said*. Two forms, and which one a row gets is a statement about what can
 * still move it (ADR-0071):
 *
 * - **„HH:MM"**, plain, when nothing on this court is reserved to run into this match: its first match of
 *   the day, and every match that opens a new block after a gap. Nothing in front of it can push it, so
 *   the time is not an estimate — it is the appointment, and it says so by carrying no hedge.
 * - **„ca. HH:MM"** when the previous reservation on this court abuts this one. The 90 minutes behind a
 *   placement is a court **reservation** built from experience, not a match length (ADR-0069 §1, which
 *   stands), so a chained start can drift — late, and only late. „ca." is the hedge; the number stays in
 *   front of it, because the number is what a player plans the drive around.
 *
 * `previousSlot` is the start of the preceding reservation **on the same court and day**, or null for the
 * first. A gap breaks the chain, and the row behind the gap re-anchors to a plain time: the match in front
 * of it finished long ago and cannot push it. A mixer block, an evening window or plain air all make such
 * a hole, and the grid already records them, so the rule reads the operator's real plan rather than
 * importing a convention blind.
 *
 * Abutting is `previousSlot + SLOT_SPAN` **exactly**. On a valid plan there is no other way for two
 * reservations to meet: court occupancy is interval-based and server-enforced (ADR-0040), so two starts on
 * one court are never fewer than SLOT_SPAN steps apart. A closer pair can still reach this page — the feed
 * reports a **running** match on its *actual* court (ADR-0032), so an operator who moves a live match onto
 * a busy court puts it inside that court's chain. That is an overlap, not a follow-on, and it anchors: an
 * overlapping start is not a chained one, and the plain time is the claim that makes no promise about a
 * predecessor it does not actually follow.
 */
const publishedTime = (day: number, slot: number, previousSlot: number | null): PublishedTime => {
  const clock = slotTime(day, slot)
  const followsOn = previousSlot !== null && slot === previousSlot + SLOT_SPAN
  return { label: followsOn ? `ca. ${clock}` : clock, followsOn }
}

/**
 * Every placed match's published time, keyed by match id.
 *
 * Built over the **whole feed** rather than per rendered group, because a court's reservation chain is a
 * fact about the court: the men's match hidden by a competition filter still occupies the court, and the
 * women's match behind it must keep its „ca." rather than being promoted to a plain time. Same reason
 * the bracket cannot compute this from the one node it is rendering — it is exactly the neighbour knowledge
 * a per-row helper would have made every caller carry.
 */
export const publishedTimes = (matches: readonly ScheduleMatch[]): Map<number, PublishedTime> => {
  const chains = new Map<string, ScheduleMatch[]>()
  for (const m of matches) {
    const key = `${m.day}|${m.court}`
    const chain = chains.get(key)
    if (chain) chain.push(m)
    else chains.set(key, [m])
  }
  const times = new Map<number, PublishedTime>()
  for (const chain of chains.values()) {
    // Order of play on that court; the id breaks a tie no valid plan produces but a moved live match can
    // (ADR-0032), so the order is total either way.
    chain.sort((a, b) => a.slot - b.slot || a.id - b.id)
    chain.forEach((m, i) => times.set(m.id, publishedTime(m.day, m.slot, i === 0 ? null : chain[i - 1].slot)))
  }
  return times
}

// ── The undetermined round (#333) ────────────────────────────────────────────────────────────────

// A contestant that is still the *match in front of it* — „Sieger M9", „Verlierer M9". „Freilos" and „offen"
// are placeholders too and deliberately not this: a bye is already decided, and „offen" is a slot that
// failed to resolve (ADR-0035). Only a feeder is genuinely waiting on a result, and only that wait is what
// makes a whole column of rows say nothing.
const isFeederPlaceholder = (slot: ScheduleSlot): boolean => slot.kind === 'feeder' || slot.kind === 'loser'

/**
 * The summary a group collapses to, or null when it names somebody.
 *
 * Takes the group's `matches` **and** the rows they produced, index-aligned, because the two questions live
 * on different sides of the projection: „is every contestant a feeder" is only answerable on the wire
 * (`MatchRow` has finished the discriminator into German), and „when does this start" is only answerable on
 * the row (the hedge is the row's, not the feed's). Both are the *rendered* set, so a filtered column
 * summarises exactly what it shows.
 *
 * `rows` arrives in order of play, so the earliest Published time is simply the first — hedge included,
 * because the block's start is a follow-on exactly as often as its first row is (ADR-0071).
 */
const undeterminedRound = (matches: readonly ScheduleMatch[], rows: readonly MatchRow[]): UndeterminedRound | null => {
  if (rows.length === 0) return null
  if (!matches.every(m => isFeederPlaceholder(m.slot1) && isFeederPlaceholder(m.slot2))) return null
  const earliestTime = rows[0].publishedTime
  const matchCount = rows.length
  const plural = matchCount === 1 ? 'Spiel' : 'Spiele'
  return { summary: `${matchCount} ${plural} · ab ${earliestTime} · noch ohne Namen`, matchCount, earliestTime }
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
 * The grouping stays fixed rather than becoming a two-way toggle again (ADR-0071): the court is the column a
 * player reads down to find their own afternoon, and „what is on right now" is the courts board's question,
 * not the schedule's. Absolute times would make a day-wide list *coherent* — they do not make it wanted.
 *
 * The competition filter narrows the **rows**, never the chain: a court's reservation chain is a fact about
 * the court, so it is built from every match on it before the filter applies. Hiding a men's match must not
 * promote the women's match behind it from „ca. 12:00" to a plain, unpushable 12:00.
 */
export const scheduleView = (
  feed: Pick<ScheduleResponse, 'matches'>,
  { days, competitions, competition = null }: ScheduleViewOptions
): ScheduleView => {
  const { matches } = feed
  const offered = filterOptions(competitions, matches)
  const selected = effectiveSelection(offered, competition)

  // Every court's chain, built before the filter narrows anything — see `publishedTimes`.
  const published = publishedTimes(matches)

  const row = (m: ScheduleMatch): MatchRow => {
    const { label, followsOn } = published.get(m.id)!
    return {
      id: m.id,
      publishedTime: label,
      followsOn,
      slot1: scheduleRowSlot(m, 1),
      slot2: scheduleRowSlot(m, 2),
      meta: [roundText(m), `M${m.number}`, competitionLabel(competitions, m.competition)].join(' · '),
      status: m.status,
      statusLabel: statusLabel(m.status)
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
          const onCourt = onDay
            .filter(m => m.court === court)
            .sort((a, b) => a.slot - b.slot || a.id - b.id)
            .filter(m => selected === null || m.competition === selected)
          const rows = onCourt.map(row)
          return { court, label: courtLabel(court), rows, undetermined: undeterminedRound(onCourt, rows) }
        })
        .filter(group => group.rows.length > 0)
    }
  })

  // The courts board: at most one running match per court (occupancy is server-enforced), and the feed's
  // `court` is already the *actual* live court for a running match (ADR-0032), so this indexes by reality.
  const running = new Map<number, ScheduleMatch>()
  for (const m of matches) if (m.status === 'running') running.set(m.court, m)

  // Nothing running, no board (#347) — the section's whole content would be the absence of content.
  const courts =
    running.size === 0
      ? undefined
      : COURT_NUMBERS.map((court): CourtCell => {
          const live = running.get(court)
          // Courts outside the focused field fade back — including free ones — so „mein Feld" pops without ever
          // relabelling a physically busy court „frei".
          const base = { court, label: courtLabel(court), dim: selected !== null && live?.competition !== selected }
          if (!live) return { ...base, free: true }
          return {
            ...base,
            free: false,
            slot1: scheduleRowSlot(live, 1),
            slot2: scheduleRowSlot(live, 2),
            meta: `${roundText(live)} · ${competitionLabel(competitions, live.competition)}`
          }
        })

  return { competitions: offered, selected, courts, days: dayGroups.filter(d => d.courts.length > 0) }
}
