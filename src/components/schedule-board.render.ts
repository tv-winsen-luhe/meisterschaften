import { crestImage } from './club-crest'
import type { Logos } from './club-crest'
import type { CourtCell, DayGroup, MatchRow, CompetitionOption, RowSlot } from '../../shared'

// The public schedule board's DOM layer (ADR-0005, ADR-0032, ADR-0069, #91, #308): every builder that turns
// the finished schedule view into elements, split out of spielplan.astro so the page's `<script>` stays a
// thin fetch/state/poll controller — the same split the public bracket already has (tournament-draw.render.ts).
//
// Deliberately **thin**. Every decision — the day → court grouping, the ordering, the plain „HH:MM" against
// the hedged „ca. HH:MM", the labels, the score line, the degradation to „offen" — lives
// behind `scheduleView` in shared/match-view. What is left here is a translation: this module sorts nothing
// and concatenates no display string, it only puts finished German text into finished nodes.
//
// Thin is not the same as untestable, which is what this module claimed until #343. Carrying no *decision*
// says nothing about carrying the right *shape*, and the shape is load-bearing here: the contestant lines
// dissolve into one grid, so which cells a line emits decides where every later cell lands. That is pinned
// in test/schedule-board-render.test.ts, against the same `document` shim the sibling render tests use.

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
  // between the lines.
  //
  // Both spans are emitted **even when empty**, and that is the line's one rule rather than a quirk of the
  // sets: a skipped cell does not leave a gap, it slides everything after it one cell along. The sets' span
  // was already unconditional for that reason; the outcome's was not, and a row with no special outcome —
  // which is nearly every row — therefore supplied two items to a three-track grid and pushed the second
  // contestant's name into the first line's outcome column (#343). Emitting the cell is what keeps
  // auto-placement honest, so neither span may become conditional again.
  el.append(elem('span', 'sched-match__games', slot.games))
  // „· Aufg." behind the sets, or „w.o." in their place — in the score column, where a reader looks for the
  // outcome, rather than at the far end of the meta line where it used to sit. Empty on the line that has
  // no token, which is every line of a normally scored match: the courts board reuses this line outside the
  // grid and hides the empty span there (`:empty`, spielplan.astro), because a flex row wants the opposite
  // of what a grid does.
  el.append(elem('span', 'sched-match__outcome', slot.outcome ?? ''))
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
  // „10:00" when nothing can push it, „ca. 14:00" when it follows on this court (ADR-0071). Which of the
  // two it is comes from the view as a fact, never from reading the German back: the follow-on line reads
  // quieter than an anchored start — the „ca." is two characters and the dimming carries the same fact a
  // second time, which is what survives a phone in bright sunlight.
  const time = elem('div', 'sched-match__time', row.publishedTime)
  if (row.followsOn) time.classList.add('sched-match__time--follows')
  el.append(time)

  const players = elem('div', 'sched-match__players')
  players.append(playerLine(row.slot1, logos), playerLine(row.slot2, logos), elem('div', 'sched-match__meta', row.meta))
  el.append(players)

  // The one status worth a badge — the view decided which, so this only asks whether there is one. Nothing
  // is appended when there is not: the status column is implicit, so an unbadged row keeps the width.
  if (row.statusLabel) el.append(elem('span', `sched-status sched-status--${row.status}`, row.statusLabel))
  return el
}

// One day: its heading, then one „Platz N" column per court that carries a match on it. The court is the
// unit a spectator reads down — top to bottom is the order of play on that court, and the frame in which a
// „ca." earns its hedge (ADR-0071).
const daySection = (day: DayGroup, logos: Logos): HTMLElement => {
  const el = elem('section', 'sched-day')
  // The day index on the section, so the page can find the day it has something of its own to put at the
  // head of — the Social mixer's band, which is the page's to place and not the projection's (ADR-0073).
  el.setAttribute('data-day', String(day.day))
  el.append(elem('h2', 'sched-day__head', day.label))
  for (const court of day.courts) {
    const column = elem('div', 'sched-court')
    column.append(elem('h3', 'sched-court__head', court.label))
    const rows = court.rows.map(row => matchRow(row, logos))
    // A column that names nobody yet collapses behind its summary (#333) — the view already decided that,
    // and „is it open" is the browser's business: a native `<details>` needs no script for the toggle, no
    // state for this module to hold, and hides nothing from a reader without one, since the rows are inside
    // it either way. Still a translation: the summary line arrives finished.
    if (court.undetermined) {
      const block = elem('details', 'sched-round')
      block.append(elem('summary', 'sched-round__summary', court.undetermined.summary), ...rows)
      column.append(block)
    } else {
      column.append(...rows)
    }
    el.append(column)
  }
  return el
}

// ── The three renderers (the module's surface) ───────────────────────────────────────────────────

// The „Jetzt auf dem Platz" board: the six courts, each showing what is live on it right now (or „frei").
//
// Built here rather than sitting in the page's markup, because the section is present only while it has an
// answer (#347): with no cells arriving there is no heading and no placeholder line either, which a static
// `<h2>` in the page could not withdraw. The same shape `renderFilter` uses — empty it and hide it — so a
// board that comes back later reuses the container it left behind.
export const renderCourts = (boardEl: HTMLElement | null, courts: CourtCell[] | undefined, logos: Logos) => {
  if (!boardEl) return
  if (!courts) {
    boardEl.replaceChildren()
    boardEl.hidden = true
    return
  }
  boardEl.hidden = false
  const grid = elem('div', 'courts')
  grid.append(...courts.map(cell => courtCell(cell, logos)))
  boardEl.replaceChildren(elem('h2', 'board-heading', 'Jetzt auf dem Platz'), grid)
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
