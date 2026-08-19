import { crestImage } from './club-crest'
import type { Logos } from './club-crest'
import type { CourtCell, DayGroup, MatchRow, CompetitionOption, RowSlot } from '../../shared'

// The public schedule board's DOM layer (ADR-0005, ADR-0032, ADR-0069, #91, #308): every builder that turns
// the finished schedule view into elements, split out of spielplan.astro so the page's `<script>` stays a
// thin fetch/state/poll controller — the same split the public bracket already has (tournament-draw.render.ts).
//
// Deliberately **thin**. Every decision — the day → court grouping, the ordering, the „ab HH:MM" against
// „im Anschluss · nicht vor ca. HH:MM" floor, the labels, the score line, the degradation to „offen" — lives
// behind `scheduleView` in shared/match-view. What is left here is a translation: this module sorts nothing
// and concatenates no display string, it only puts finished German text into finished nodes. That is what
// makes it uninteresting enough not to need a DOM test (#304).

// createElement + className (+ optional text) in one — the same helper both sibling render modules keep
// (tournament-draw.render.ts, participant-list.render.ts), so each element is one statement rather than the
// create/className/textContent triple repeated ~20 times.
const elem = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * A contestant line, in the anatomy a tennis reader expects (#309, ADR-0070): crest · full name · seed
 * token, then the score column — that slot's games and, on the winner's line, the outcome token. Shared by
 * the courts board and the schedule rows, so the two surfaces cannot drift on how a contestant reads.
 *
 * The winner is marked **twice**, bold and a check, from the one `winner` fact. That is the references'
 * convention and the redundancy is the point: a weight difference alone does not survive a phone held in
 * bright sunlight on the grounds.
 *
 * Still a translation, not a decision: every string here arrives finished, including the seed's title and
 * the outcome's separator. The only branch is „is this field present".
 */
const playerLine = (slot: RowSlot, logos: Logos): HTMLElement => {
  const el = elem('div', 'sched-match__player')
  if (slot.tbd) el.classList.add('sched-match__player--tbd')
  if (slot.winner) el.classList.add('sched-match__player--winner')

  const ident = elem('span', 'sched-match__ident')
  // A placeholder line („Freilos", „Sieger M3", „offen") has nobody behind it, so it flies no crest — the
  // view already decided that by leaving the club null.
  if (slot.club) {
    const crest = elem('span', 'sched-match__crest')
    crest.append(crestImage(slot.club, logos))
    ident.append(crest)
  }
  ident.append(elem('span', 'sched-match__name', slot.text))
  if (slot.seed) {
    const seed = elem('span', 'sched-match__seed', slot.seed.text)
    // „An 3 gesetzt" — a bare number beside a name is meaningless read aloud.
    seed.title = slot.seed.label
    seed.setAttribute('aria-label', slot.seed.label)
    ident.append(seed)
  }
  if (slot.winner) {
    // The check names itself rather than the line naming it, so the win is announced exactly once and this
    // module still joins no German — a lone constant word, like the board's „frei", is not a concatenation.
    const check = elem('span', 'sched-match__check', '✓')
    check.title = 'Sieger'
    check.setAttribute('role', 'img')
    check.setAttribute('aria-label', 'Sieger')
    ident.append(check)
  }
  el.append(ident)

  // Sets and outcome are appended as **siblings** of the identity, never wrapped together: on the schedule
  // the two contestant lines share one grid, so each of the three is its own column and the sets line up
  // between the lines. The games span is emitted even when empty, because a skipped cell would slide the
  // outcome into the sets' column — which is exactly what a walkover ("w.o." with no sets) would do.
  el.append(elem('span', 'sched-match__games', slot.games))
  // „· Aufg." behind the sets, or „w.o." in their place — in the score column, where a reader looks for the
  // outcome, rather than at the far end of the meta line where it used to sit.
  if (slot.outcome) el.append(elem('span', 'sched-match__outcome', slot.outcome))
  return el
}

// ── Courts board ────────────────────────────────────────────────────────────────────────────────

const courtCell = (cell: CourtCell, logos: Logos): HTMLElement => {
  const el = elem('div', 'court')
  // Courts outside the focused field fade back — including free ones — so „mein Feld" pops without ever
  // relabelling a busy court „frei".
  if (cell.dim) el.classList.add('court--dim')
  el.append(elem('div', 'court__no', cell.label))

  if (cell.free) {
    el.append(elem('div', 'court__free', 'frei'))
    return el
  }

  el.classList.add('court--live')
  const players = elem('div', 'court__players')
  players.append(playerLine(cell.slot1, logos), playerLine(cell.slot2, logos))
  el.append(players, elem('div', 'court__meta', cell.meta))
  return el
}

// ── Schedule rows ─────────────────────────────────────────────────────────────────────────────

const matchRow = (row: MatchRow, logos: Logos): HTMLElement => {
  const el = elem('div', 'sched-match')
  // „ab 10:30" or „im Anschluss · nicht vor ca. 14:00" — a floor, never a point (ADR-0069). Which of the
  // two it is comes from the view as a fact, never from reading the German back: the follow-on line reads
  // quieter than an anchored start, and a reworded label must not silently drop the distinction.
  const time = elem('div', 'sched-match__time', row.publishedTime)
  if (row.followsOn) time.classList.add('sched-match__time--follows')
  el.append(time)

  const players = elem('div', 'sched-match__players')
  players.append(playerLine(row.slot1, logos), playerLine(row.slot2, logos), elem('div', 'sched-match__meta', row.meta))
  el.append(players)

  el.append(elem('span', `sched-status sched-status--${row.status}`, row.statusLabel))
  return el
}

// One day: its heading, then one „Platz N" column per court that carries a match on it. The court is the
// unit a spectator reads down — top to bottom is the order of play on that court, which is the only frame
// in which „im Anschluss" is true.
const daySection = (day: DayGroup, logos: Logos): HTMLElement => {
  const el = elem('section', 'sched-day')
  el.append(elem('h2', 'sched-day__head', day.label))
  for (const court of day.courts) {
    const column = elem('div', 'sched-court')
    column.append(elem('h3', 'sched-court__head', court.label))
    for (const row of court.rows) column.append(matchRow(row, logos))
    el.append(column)
  }
  return el
}

// ── The three renderers (the module's surface) ───────────────────────────────────────────────────

// The „Jetzt auf dem Platz" board: the six courts, each showing what is live on it right now (or „frei").
export const renderCourts = (courtsEl: HTMLElement | null, courts: CourtCell[], logos: Logos) => {
  if (!courtsEl) return
  courtsEl.replaceChildren(...courts.map(cell => courtCell(cell, logos)))
}

// The competition filter chips: „Alle" (slug null) or one field. The active chip narrows the schedule to
// that field and focuses its courts on the board; clicking one calls `onSelect` (the controller stores the
// selection and re-renders). An empty option list means there is nothing to choose between — the view
// already decided that, so this only hides the row.
export const renderFilter = (
  filterEl: HTMLElement | null,
  competitions: CompetitionOption[],
  selected: string | null,
  onSelect: (slug: string | null) => void
) => {
  if (!filterEl) return
  if (competitions.length === 0) {
    filterEl.replaceChildren()
    filterEl.hidden = true
    return
  }
  filterEl.hidden = false
  const chips: { slug: string | null; label: string }[] = [{ slug: null, label: 'Alle' }, ...competitions]
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

// The schedule itself: one section per day, each a stack of „Platz N" columns. Rendered in the order the
// view hands over — day ascending, court ascending, each court in order of play.
export const renderSchedule = (sectionsEl: HTMLElement | null, days: DayGroup[], logos: Logos) => {
  if (!sectionsEl) return
  sectionsEl.replaceChildren(...days.map(day => daySection(day, logos)))
}
