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

// A contestant line: the name (truncated), that slot's games, and the winner emphasised. Shared by the
// courts board and the schedule rows, so the two surfaces cannot drift on how a contestant reads.
const playerLine = (slot: RowSlot): HTMLElement => {
  const el = elem('div', 'sched-match__player')
  if (slot.tbd) el.classList.add('sched-match__player--tbd')
  if (slot.winner) el.classList.add('sched-match__player--winner')
  el.append(elem('span', 'sched-match__name', slot.text))
  if (slot.games) el.append(elem('span', 'sched-match__games', slot.games))
  return el
}

// ── Courts board ────────────────────────────────────────────────────────────────────────────────

const courtCell = (cell: CourtCell): HTMLElement => {
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
  players.append(playerLine(cell.slot1), playerLine(cell.slot2))
  el.append(players, elem('div', 'court__meta', cell.meta))
  return el
}

// ── Schedule rows ─────────────────────────────────────────────────────────────────────────────

const matchRow = (row: MatchRow): HTMLElement => {
  const el = elem('div', 'sched-match')
  // „ab 10:30" or „im Anschluss · nicht vor ca. 14:00" — a floor, never a point (ADR-0069). Which of the
  // two it is comes from the view as a fact, never from reading the German back: the follow-on line reads
  // quieter than an anchored start, and a reworded label must not silently drop the distinction.
  const time = elem('div', 'sched-match__time', row.publishedTime)
  if (row.followsOn) time.classList.add('sched-match__time--follows')
  el.append(time)

  const players = elem('div', 'sched-match__players')
  players.append(playerLine(row.slot1), playerLine(row.slot2), elem('div', 'sched-match__meta', row.meta))
  el.append(players)

  el.append(elem('span', `sched-status sched-status--${row.status}`, row.statusLabel))
  return el
}

// One day: its heading, then one „Platz N" column per court that carries a match on it. The court is the
// unit a spectator reads down — top to bottom is the order of play on that court, which is the only frame
// in which „im Anschluss" is true.
const daySection = (day: DayGroup): HTMLElement => {
  const el = elem('section', 'sched-day')
  el.append(elem('h2', 'sched-day__head', day.label))
  for (const court of day.courts) {
    const column = elem('div', 'sched-court')
    column.append(elem('h3', 'sched-court__head', court.label))
    for (const row of court.rows) column.append(matchRow(row))
    el.append(column)
  }
  return el
}

// ── The three renderers (the module's surface) ───────────────────────────────────────────────────

// The „Jetzt auf dem Platz" board: the six courts, each showing what is live on it right now (or „frei").
export const renderCourts = (courtsEl: HTMLElement | null, courts: CourtCell[]) => {
  if (!courtsEl) return
  courtsEl.replaceChildren(...courts.map(courtCell))
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
export const renderSchedule = (sectionsEl: HTMLElement | null, days: DayGroup[]) => {
  if (!sectionsEl) return
  sectionsEl.replaceChildren(...days.map(daySection))
}
