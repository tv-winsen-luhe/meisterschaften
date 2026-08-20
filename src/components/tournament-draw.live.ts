import { bracketView } from '../../shared'
import { DAYS, elem, tbdEl } from './tournament-draw.render'
import type { Segment } from './tournament-draw.render'
import type {
  BracketCell,
  BracketView,
  CellSchedule,
  CellSlot,
  PublicCompetitionBracket,
  ScheduleResponse
} from '../../shared'

// The fully-revealed public bracket's DOM layer (ADR-0046 phase two, ADR-0070, #311, #312) — a sibling of
// tournament-draw.render.ts, which keeps the two phases before a field is resolved. The split is the same one
// `shared/` makes between `match-view` and `bracket-view`: the preview and the reveal draw a *topology* from a
// draw size, while everything here is a **translation** of the finished `bracketView` tree — no sorting, no
// label building, no „is this decided" arithmetic, and no German assembled from parts. The one thing this
// layer decides is which class carries which fact, which is what a stylesheet is for.
//
// `renderLive` is the module's surface; it emits **both** layouts (#312) — the round-column tree for a wide
// screen, the chosen round as a list for a phone — and the stylesheet shows one. Which width gets which is a
// stylesheet's question, so there is no `matchMedia` here and no resize listener in the controller.

// The fully-revealed member of the per-competition bracket union (ADR-0046) — the one phase this file renders.
export type LiveCompetition = Extract<PublicCompetitionBracket, { phase: 'live' }>

// One contestant line of a cell: seed · name · LK, then the score column, in the tennis anatomy the schedule
// row uses (#309). The winner is marked twice — an inked line with a navy accent bar (the class) *and* a
// check — because a weight difference alone does not survive a phone in bright sunlight.
const cellSlotEl = (slot: CellSlot): HTMLElement => {
  const el = elem('div', 'dm-slot dm-slot--cell')
  // A placeholder line („Freilos", „Sieger M3", „offen") wears the dashed, muted treatment; the view already
  // decided it is one, so this never re-reads the label to find out.
  if (slot.tbd) el.classList.add('dm-slot--feeder')
  else el.classList.add('dm-slot--seed')
  if (slot.winner) el.classList.add('dm-slot--winner')
  if (slot.loser) el.classList.add('dm-slot--loser')

  if (slot.seed) {
    const no = elem('span', 'dm-seedno', slot.seed.text)
    // „An 3 gesetzt" — a bare number beside a name means nothing read aloud.
    no.title = slot.seed.label
    no.setAttribute('aria-label', slot.seed.label)
    el.append(no)
  }
  el.append(elem('span', slot.tbd ? 'dm-feeder' : 'dm-name', slot.text))
  if (slot.lk) el.append(elem('span', slot.lk.pending ? 'dm-lk dm-lk--pending' : 'dm-lk', slot.lk.text))
  if (slot.winner) {
    const check = elem('span', 'dm-check', '✓')
    check.title = 'Sieger'
    check.setAttribute('role', 'img')
    check.setAttribute('aria-label', 'Sieger')
    el.append(check)
  }
  // The games span is emitted even when empty, so the sets keep their column and line up between the two
  // contestant lines — a skipped cell would slide a walkover's „w.o." into the sets' place.
  el.append(elem('span', 'dm-games', slot.games))
  if (slot.outcome) el.append(elem('span', 'dm-outcome', slot.outcome))
  return el
}

// The court + floor caption („Platz 3 · Sa" / „ab 14:00"), the **gated** half of the cell (ADR-0070): it is
// simply absent when the plan is withheld, while the score above stays. The floor is its own span so it can
// read quieter as a follow-on, and so the „ab" / „nicht vor ca." wording is the schedule's verbatim.
const whenEl = (when: CellSchedule): DocumentFragment => {
  const frag = document.createDocumentFragment()
  frag.append(elem('span', 'dm-when__where', when.where))
  const time = elem('span', 'dm-when__time', when.time)
  if (when.followsOn) time.classList.add('dm-when__time--follows')
  frag.append(time)
  return frag
}

// One cell: its header line (court + floor, and „läuft" for a match on court right now), then the two
// contestant lines. The header is emitted even when empty so every match in a column keeps the same height
// and the CSS elbow connectors stay aligned.
//
// The one cell that names itself is the „Spiel um Platz 3": every other cell is placed by the round column
// (or, on a phone, by the round control) it sits under, and the view leaves `label` null for those.
const liveMatchEl = (cell: BracketCell | null): HTMLElement => {
  const el = elem('div', 'dm-match')
  if (cell?.label) {
    el.classList.add('dm-match--playoff')
    el.append(elem('div', 'dm-match__label', cell.label))
  }
  const head = elem('div', 'dm-when')
  if (cell?.schedule) head.append(whenEl(cell.schedule))
  // The one status worth a badge — the view decided which, so this only asks whether there is one.
  if (cell?.statusLabel) head.append(elem('span', 'dm-live', cell.statusLabel))
  el.append(head)
  el.append(cell ? cellSlotEl(cell.slot1) : tbdEl(), cell ? cellSlotEl(cell.slot2) : tbdEl())
  return el
}

// The tree (the wide layout): one column per round, outermost → final, rendered in the order the view hands
// over. It does not reuse `renderTree` (the preview/reveal shell) because that one addresses slots by index
// into a draw size, while the view already hands over the columns and their cells — and re-deriving them from
// `size` here would put the topology back on both sides of the seam.
//
// A **grid** rather than a flex row (#312), for two reasons that are really one: the columns are tracks that
// share the available width, so the whole bracket fits a laptop without horizontal scrolling at our field
// sizes; and the playoff can take a second grid row under the final column without stealing height from the
// tree row — in a flex row it would push the final off the mid-point its two feeders' elbows aim at. The
// column count rides a custom property so the track list stays in the stylesheet.
const renderLiveTree = (view: BracketView): HTMLElement => {
  const tree = elem('div', 'dm-tree dm-tree--live')
  tree.style.setProperty('--dm-cols', String(view.rounds.length))
  for (const round of view.rounds) {
    const col = elem('div', 'dm-round')
    const label = elem('div', 'dm-round__label')
    label.append(round.label, elem('span', 'dm-round__count', String(round.matchCount)))
    col.append(label)

    const matches = elem('div', 'dm-round__matches')
    for (const cell of round.cells) matches.append(liveMatchEl(cell))
    col.append(matches)
    tree.append(col)
    // The „Spiel um Platz 3" of this round (ADR-0046, #312) — a sibling of the columns rather than a cell
    // inside one, so it stays out of the elbow connectors, which describe the tree's own wiring. The
    // stylesheet puts it in the second grid row under this column; this only asks the round for it.
    if (round.playoff) tree.append(liveMatchEl(round.playoff))
  }
  return tree
}

// The round list (the phone layout, #312): the one round the reader chose, read top to bottom, in the same
// cell shape the wide tree uses — so the two layouts cannot drift on how a match reads. The playoff is a row
// of the final round's list rather than a box below everything, because that is the round it is played in.
//
// It is rendered on every width and hidden by a media query rather than by a `matchMedia` branch here: which
// layout a width gets is a stylesheet's question, and a JS breakpoint would need a resize listener the
// polling controller has no other reason to own.
const renderRoundList = (view: BracketView): HTMLElement => {
  const list = elem('div', 'dm-list')
  const round = view.rounds[view.round - 1]
  // The view clamps `round` into the tree, so this is only ever absent on a bracket with no rounds at all.
  if (!round) return list
  for (const cell of round.cells) list.append(liveMatchEl(cell))
  if (round.playoff) list.append(liveMatchEl(round.playoff))
  return list
}

// The bracket control („Hauptrunde" / „Nebenrunde", ADR-0046) — the buttons are created once per panel, then
// re-synced on each render (so a poll never drops focus or duplicates a listener). Clicking calls `onSelect`
// (the controller switches the panel's segment + re-renders). The 3rd-place cell rides under the main
// bracket's final, so there is no tab for it.
//
// This is the **outer** choice, with the rounds nested inside it (#312): the consolation is a tournament of
// its own with its own draw and its own byes (ADR-0004), while a round is a position inside one — two
// questions of different rank, which two equal bars stacked on each other would flatten.
const renderSegments = (segmentsEl: HTMLElement, selected: Segment, onSelect: (segment: Segment) => void) => {
  if (segmentsEl.childElementCount === 0) {
    for (const seg of ['main', 'consolation'] as const) {
      const btn = elem('button', 'dm-seg', seg === 'main' ? 'Hauptrunde' : 'Nebenrunde') as HTMLButtonElement
      btn.type = 'button'
      btn.setAttribute('role', 'tab')
      btn.dataset.seg = seg
      btn.addEventListener('click', () => onSelect(seg))
      segmentsEl.append(btn)
    }
  }
  segmentsEl.querySelectorAll<HTMLButtonElement>('[data-seg]').forEach(btn => {
    btn.setAttribute('aria-selected', String(btn.dataset.seg === selected))
  })
}

// The round control, nested inside the segment choice (#312) — the phone's way through the bracket, and the
// only control the wide tree does not need. Its buttons carry the view's `name`, the bracket-less reading of
// the same round-name rule the columns use (#307, ADR-0028): the control above already names the bracket, and
// repeating it on every button would not fit a segment anyway. No round names are spelled here.
//
// Rebuilt only when the rounds themselves change (a segment switch changes their number and their names);
// otherwise the buttons are left in place and re-synced, so a poll mid-tournament never steals focus from a
// reader's thumb.
const renderRounds = (roundsEl: HTMLElement, view: BracketView, onSelect: (round: number) => void) => {
  const signature = view.rounds.map(r => r.name).join('|')
  if (roundsEl.dataset.rounds !== signature) {
    roundsEl.dataset.rounds = signature
    roundsEl.replaceChildren(
      ...view.rounds.map(round => {
        const btn = elem('button', 'dm-roundtab', round.name) as HTMLButtonElement
        btn.type = 'button'
        btn.setAttribute('role', 'tab')
        btn.dataset.round = String(round.round)
        btn.addEventListener('click', () => onSelect(round.round))
        return btn
      })
    )
  }
  roundsEl.querySelectorAll<HTMLButtonElement>('[data-round]').forEach(btn => {
    btn.setAttribute('aria-selected', String(Number(btn.dataset.round) === view.round))
  })
}

/** The three elements a live panel renders into: its two controls and the bracket target itself. */
export interface LiveTargets {
  segments: HTMLElement
  rounds: HTMLElement
  bracket: HTMLElement
}

/** What the reader has chosen, held by the controller so it survives a poll. Both are degraded by the view. */
export interface LiveSelection {
  segment: Segment
  round: number
}

/** The two ways a reader moves through a live bracket — the controller stores the choice and re-renders. */
export interface LiveHandlers {
  segment: (segment: Segment) => void
  round: (round: number) => void
}

// A fully-revealed competition (phase two, ADR-0046, ADR-0070, #312): project the field through `bracketView`
// and render the segment it hands back — as the round-column tree for a wide screen and as the chosen round's
// list for a phone, both emitted, one shown by the stylesheet. The main bracket carries the „Spiel um Platz 3"
// under its final; the consolation stands alone (ADR-0004).
//
// `selection` + `on` carry the reader's choices, which live in the controller so they survive a poll — the
// *effective* segment and round come back from the view, which falls back to the main bracket when the one
// asked for does not exist and clamps the round into the segment actually shown.
//
// It takes the whole schedule **feed** rather than a per-node index, because whether the cell footer hedges
// its time („ca. 14:00", ADR-0071) is a statement about the court's neighbours — mostly matches of other
// fields this tree never draws. The score does **not** come from here: it rides the
// draw wire, so it survives a plan the operator has reset (ADR-0070).
// It hands the view back so the controller can adopt the segment that was actually shown (#313). That matters
// for one case: a `consolation` asked for by a link, on a field whose consolation does not exist. The view
// falls back to the main bracket, and if the controller kept „consolation" in memory, the day the consolation
// *does* arrive on a poll would silently move a reader who had asked for nothing since. Adopting the verdict
// is also why this returns the view rather than the controller re-deriving it: `hasConsolation` is the view's
// decision, and asking it twice is the seam leaking one field at a time.
//
// The **round** is deliberately not adopted the same way (see `LiveSelection`): a clamp into a shallow
// consolation is per-render, so remembering it would forget the deep round the reader is switching back to.
export const renderLive = (
  { segments, rounds, bracket }: LiveTargets,
  live: LiveCompetition,
  feed: Pick<ScheduleResponse, 'matches'>,
  selection: LiveSelection,
  on: LiveHandlers
): BracketView => {
  const view = bracketView(live, feed, { days: DAYS, segment: selection.segment, round: selection.round })
  // The outer choice, offered only where there is one to make: a field below size 8 has no consolation at all
  // (ADR-0004) — at exactly four the „Spiel um Platz 3" *is* it, and it shows under the final either way.
  if (view.hasConsolation) {
    renderSegments(segments, view.segment, on.segment)
    segments.hidden = false
  } else {
    segments.hidden = true
  }
  // The inner choice. Present at every width in the DOM and shown by the stylesheet only where the round list
  // is the layout — the wide tree shows every round at once and has nothing to navigate.
  renderRounds(rounds, view, on.round)
  rounds.hidden = false
  bracket.innerHTML = ''
  bracket.append(renderLiveTree(view), renderRoundList(view))
  return view
}
