import { COURT_NUMBERS, roundLabel, scoreLine, slotLabel, slotTime } from '../../shared'
import { competitions, tournament } from '../data/tournament'
import type { ScheduleMatch, ScheduleSlot } from '../../shared'

// The public schedule board's DOM layer (ADR-0005, ADR-0032, #91): every builder that turns the schedule
// feed into elements, split out of spielplan.astro so the page's `<script>` stays a thin fetch/state/poll
// controller — the same split the public bracket already has (tournament-draw.render.ts). Pure and
// framework-free: it takes data + a render target and fills DOM, holding no state of its own (the
// competition filter and the grouping are passed in, and the filter's re-render trigger comes back as a
// callback). It never fetches and never sets a timer. The four renderers at the bottom are the module's
// surface, and the pure derivations above them are exported too: they are what the page used to have walled
// in behind its inline script, and having them importable — assertable without a DOM — is the point of the
// boundary. Nothing outside this module reads them yet; the shared match row lands here next (#304).

// Which axis the schedule groups by (#91): „Nach Tag" or „Nach Platz".
export type Grouping = 'day' | 'court'

// Day labels from the event's date copy (src/data/tournament.ts), indexed by the wire `day` (0/1): the
// full „Samstag · 22.08." heads a by-day section; the two-letter „Sa"/„So" prefixes a by-court row's time.
const DAYS = [tournament.saturday, tournament.sunday]
const DAY_ABBR = DAYS.map(d => d.weekday.slice(0, 2))

// Competition slug → German label, and the stable display order (the wire carries the English slug). The
// admin's own `competitionLabel` reads the same list, but it lives in a React surface — importing it here
// would pull the admin bundle onto a public page, so the public board reads the shared copy directly.
const COMPETITION_LABELS = new Map(competitions.map(c => [c.slug, c.label]))
const COMPETITION_ORDER = competitions.map(c => c.slug)

const STATUS_LABELS: Record<ScheduleMatch['status'], string> = {
  planned: 'geplant',
  running: 'läuft',
  done: 'beendet'
}

// The German note for a special outcome (ADR-0032), appended to a finished match's meta line. A normal
// scored result carries no note — its set scores are the result.
const OUTCOME_NOTE: Record<NonNullable<ScheduleMatch['outcome']>, string> = {
  walkover: 'Walkover',
  retirement: 'Aufgabe'
}

// createElement + className (+ optional text) in one — the same helper both sibling render modules keep
// (tournament-draw.render.ts, participant-list.render.ts), so each element is one statement rather than the
// create/className/textContent triple repeated ~20 times.
const elem = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// ── The derivations the board reads a match through ───────────────────────────────────────────────

// One slot's display text: a player's name, or the shared German label for a „Freilos"/„Sieger M{n}"/
// „Verlierer M{n}"/„offen" line — every not-yet-decided slot renders muted (ADR-0035).
export interface SlotText {
  text: string
  tbd: boolean
}
export const slotDisplay = (slot: ScheduleSlot): SlotText =>
  slot.kind === 'player'
    ? { text: `${slot.firstName} ${slot.lastName}`.trim(), tbd: false }
    : { text: slotLabel(slot), tbd: true }

// The match's round name („Achtelfinale" … „Finale", „Nebenrunde · …", „Spiel um Platz 3") — the shared
// `roundLabel` (ADR-0028), so it reads identically on the admin grid and the public bracket.
export const roundText = (m: ScheduleMatch): string =>
  roundLabel({ bracket: m.bracket, round: m.round, totalRounds: m.totalRounds, thirdPlace: m.thirdPlace })

// The match's field („Herren", „Damen", …); falls back to the wire slug rather than rendering nothing for a
// field whose label the client's copy does not know.
export const competitionText = (m: ScheduleMatch): string => COMPETITION_LABELS.get(m.competition) ?? m.competition

// „geplant" / „läuft" / „beendet" — the status the board shows instead of presenting the plan as the truth.
export const statusText = (m: ScheduleMatch): string => STATUS_LABELS[m.status]

// The single running match on a court (occupancy is enforced server-side, so at most one). The feed's
// `court` is already the actual live court for a running match (ADR-0032), so this indexes by reality.
export const runningByCourt = (matches: ScheduleMatch[]): Map<number, ScheduleMatch> => {
  const map = new Map<number, ScheduleMatch>()
  for (const m of matches) if (m.status === 'running') map.set(m.court, m)
  return map
}

// The competitions actually present in the feed, in the fixed display order — the filter's options. This is
// also how a cancelled competition leaves the board's filter (ADR-0062): the feed stops carrying its
// matches, so it stops being an option — the filter is never told about it separately.
export const presentCompetitions = (matches: ScheduleMatch[]): string[] =>
  COMPETITION_ORDER.filter(slug => matches.some(m => m.competition === slug))

// The filter selection that actually applies. A field the feed no longer carries (a reset dropped it, or it
// was cancelled) falls back to „Alle", and so does any selection once fewer than two fields are present —
// the chips stop rendering there, so a selection that stuck would narrow the board with no way to widen it.
export const effectiveSelection = (present: string[], selected: string | null): string | null =>
  present.length < 2 || (selected && !present.includes(selected)) ? null : selected

// ── Shared lines ──────────────────────────────────────────────────────────────────────────────────

// A player line: the name (truncated), the slot's games (if any), and the winner emphasised. Shared by
// the courts board and the schedule rows.
const playerLine = (slot: ScheduleSlot, games: string, winner: boolean): HTMLElement => {
  const el = elem('div', 'sched-match__player')
  const { text, tbd } = slotDisplay(slot)
  if (tbd) el.classList.add('sched-match__player--tbd')
  if (winner) el.classList.add('sched-match__player--winner')
  el.append(elem('span', 'sched-match__name', text))
  if (games) el.append(elem('span', 'sched-match__games', games))
  return el
}

// ── Courts board ────────────────────────────────────────────────────────────────────────────────

const courtCell = (court: number, match: ScheduleMatch | undefined, selected: string | null): HTMLElement => {
  const cell = elem('div', 'court')
  if (match) cell.classList.add('court--live')
  // Fade back the courts that are not the focused field when a filter is active — including free ones —
  // so „mein Feld" pops without ever relabelling a busy court „frei".
  if (selected && match?.competition !== selected) cell.classList.add('court--dim')
  cell.append(elem('div', 'court__no', `Platz ${court}`))

  if (!match) {
    cell.append(elem('div', 'court__free', 'frei'))
    return cell
  }

  const players = elem('div', 'court__players')
  // Running — no winner yet; show any opportunistically-saved set games.
  players.append(
    playerLine(match.slot1, scoreLine(match.score, 1), false),
    playerLine(match.slot2, scoreLine(match.score, 2), false)
  )
  cell.append(players, elem('div', 'court__meta', `${roundText(match)} · ${competitionText(match)}`))
  return cell
}

// ── Schedule rows ─────────────────────────────────────────────────────────────────────────────

// `showDay` prefixes the time with the two-letter day — needed in the by-court view, where a section's
// rows span both days; the by-day view's section header already carries the day.
const matchRow = (m: ScheduleMatch, showDay: boolean): HTMLElement => {
  const row = elem('div', 'sched-match')
  // The „ca." time is day-aware — Saturday and Sunday start at different clock times (ADR-0040).
  const clock = `ca. ${slotTime(m.day, m.slot)}`
  row.append(elem('div', 'sched-match__time', showDay ? `${DAY_ABBR[m.day] ?? `T${m.day + 1}`} · ${clock}` : clock))

  const players = elem('div', 'sched-match__players')
  players.append(
    playerLine(m.slot1, scoreLine(m.score, 1), m.winner === 1),
    playerLine(m.slot2, scoreLine(m.score, 2), m.winner === 2)
  )
  // The round („Achtelfinale" … „Finale", „Nebenrunde · …"), the match number, the field, and — for a
  // special outcome — „Walkover"/„Aufgabe" so a scoreless finish still reads as a result.
  const note = m.outcome ? ` · ${OUTCOME_NOTE[m.outcome]}` : ''
  players.append(elem('div', 'sched-match__meta', `${roundText(m)} · M${m.number} · ${competitionText(m)}${note}`))
  row.append(players)

  const right = elem('div', 'sched-match__right')
  right.append(
    elem('div', 'sched-match__court', `Platz ${m.court}`),
    elem('span', `sched-status sched-status--${m.status}`, statusText(m))
  )
  row.append(right)
  return row
}

const section = (head: string, matches: ScheduleMatch[], showDay: boolean): HTMLElement => {
  const el = elem('section', 'sched-section')
  el.append(elem('h2', 'sched-section__head', head))
  for (const m of matches) el.append(matchRow(m, showDay))
  return el
}

// Group by the day values actually present (ascending), each day's matches ordered by slot then court —
// so a match is never silently dropped because the day axis was sized too small.
const byDay = (matches: ScheduleMatch[]): HTMLElement[] => {
  const days = [...new Set(matches.map(m => m.day))].sort((a, b) => a - b)
  return days.map(day => {
    const dayMatches = matches.filter(m => m.day === day).sort((a, b) => a.slot - b.slot || a.court - b.court)
    const label = DAYS[day]
    return section(label ? `${label.weekday} · ${label.short}` : `Tag ${day + 1}`, dayMatches, false)
  })
}

// Group by court (one „Platz N" section per court present, ascending), each court's matches ordered by
// day then slot — so an on-site player reads down their court's column to see when they play (#91).
const byCourt = (matches: ScheduleMatch[]): HTMLElement[] => {
  const courts = [...new Set(matches.map(m => m.court))].sort((a, b) => a - b)
  return courts.map(court => {
    const courtMatches = matches.filter(m => m.court === court).sort((a, b) => a.day - b.day || a.slot - b.slot)
    return section(`Platz ${court}`, courtMatches, true)
  })
}

// ── The four renderers (the module's surface) ─────────────────────────────────────────────────────

// The „Jetzt auf dem Platz" board: the six courts, each showing what is live on it right now (or „frei"),
// with the courts outside the filtered field faded back.
export const renderCourts = (courtsEl: HTMLElement | null, matches: ScheduleMatch[], selected: string | null) => {
  if (!courtsEl) return
  const running = runningByCourt(matches)
  courtsEl.replaceChildren(...COURT_NUMBERS.map(court => courtCell(court, running.get(court), selected)))
}

// The competition filter chips: „Alle" (slug null) or one field. The active chip narrows the schedule to
// that field and focuses its courts on the board; clicking one calls `onSelect` (the controller stores the
// selection and re-renders). A filter with fewer than two fields present has nothing to choose between —
// hide it, which is the same threshold `effectiveSelection` drops a selection at.
export const renderFilter = (
  filterEl: HTMLElement | null,
  present: string[],
  selected: string | null,
  onSelect: (slug: string | null) => void
) => {
  if (!filterEl) return
  if (present.length < 2) {
    filterEl.replaceChildren()
    filterEl.hidden = true
    return
  }
  filterEl.hidden = false
  const chips: { slug: string | null; label: string }[] = [
    { slug: null, label: 'Alle' },
    ...present.map(slug => ({ slug, label: COMPETITION_LABELS.get(slug) ?? slug }))
  ]
  filterEl.replaceChildren(
    ...chips.map(chip => {
      const btn = elem('button', 'board-chip', chip.label) as HTMLButtonElement
      btn.type = 'button'
      const active = selected === chip.slug
      btn.classList.toggle('is-active', active)
      btn.setAttribute('aria-pressed', String(active))
      btn.addEventListener('click', () => onSelect(chip.slug))
      return btn
    })
  )
}

// The schedule itself: the filtered matches grouped on the chosen axis, each group a „Platz N" or
// „Samstag · 22.08." section of rows.
export const renderSchedule = (
  sectionsEl: HTMLElement | null,
  matches: ScheduleMatch[],
  selected: string | null,
  grouping: Grouping
) => {
  if (!sectionsEl) return
  const visible = selected ? matches.filter(m => m.competition === selected) : matches
  sectionsEl.replaceChildren(...(grouping === 'court' ? byCourt(visible) : byDay(visible)))
}

// Mark the active „Nach Tag" / „Nach Platz" button. The buttons live in the page's markup and keep their
// listeners there (the grouping is controller state), so this only re-syncs their pressed state.
export const syncGrouping = (buttons: HTMLButtonElement[], grouping: Grouping) => {
  for (const btn of buttons) {
    const active = btn.dataset.group === grouping
    btn.classList.toggle('is-active', active)
    btn.setAttribute('aria-pressed', String(active))
  }
}
