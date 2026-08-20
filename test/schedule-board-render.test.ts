import { beforeAll, describe, expect, it } from 'vitest'
import { scheduleView } from '../shared/match-view'
import type { MatchScore, ScheduleMatch } from '../shared'
import type { ScheduleViewOptions } from '../shared/match-view'

// Feedback loop for the „the contestant lines shift a cell" bug (#343): the schedule row appended the
// outcome span only when there was an outcome, so a normally scored match handed two items to a
// three-track grid and auto-placement pushed the second contestant's name into the first line's outcome
// column — both names on one line, one loose score underneath.
//
// This is why a module that carries no decision still gets a test. `test/match-row.test.ts` pins what the
// row *says* (finished German, at the view's interface); this one pins the *shape it occupies* — which
// cells each contestant line emits, in which order. The two lines dissolve into one grid (`display:
// contents`), so a missing cell is not a gap, it is an offset for everything after it. That is a property
// of the DOM the renderer builds and of nothing else, so it can only be asserted here.
//
// The workers pool has no `document`, so a minimal shim stands in — the same one
// test/participant-list-render.test.ts and test/preview-seed-lot.test.ts use, plus the few members the
// board's builders touch (`classList`, `setAttribute`, `replaceChildren`).

interface FakeClassList {
  add: (...names: string[]) => void
}

interface FakeEl {
  tagName: string
  className: string
  textContent: string
  children: FakeEl[]
  append: (...nodes: FakeEl[]) => void
  replaceChildren: (...nodes: FakeEl[]) => void
  classList: FakeClassList
  setAttribute: (name: string, value: string) => void
  title: string
  src: string
  alt: string
  loading: string
}

const createElement = (tag: string): FakeEl => {
  const el: FakeEl = {
    tagName: tag,
    className: '',
    textContent: '',
    children: [],
    append: (...nodes: FakeEl[]) => el.children.push(...nodes),
    replaceChildren: (...nodes: FakeEl[]) => {
      el.children.length = 0
      el.children.push(...nodes)
    },
    // The renderer adds its state classes (`--winner`, `--tbd`, `--follows`) this way, so the shim keeps
    // them in `className` rather than a separate list — that is where the assertions read them.
    classList: { add: (...names: string[]) => (el.className = [el.className, ...names].filter(Boolean).join(' ')) },
    setAttribute: () => {},
    title: '',
    src: '',
    alt: '',
    loading: ''
  }
  return el
}

const LOGOS = { tv: '/tv.svg', tsv: '/tsv.png' }
const NO_SCORE: MatchScore = { set1: null, set2: null, mtb: null }

const OPTIONS: ScheduleViewOptions = {
  days: [{ weekday: 'Samstag', short: '22.08.' }],
  competitions: [{ slug: 'mens', label: 'Herren' }]
}

// One placed match on court 1 — the same fixture shape test/match-row.test.ts uses, so the two files
// describe the same row from their two angles.
const match = (over: Partial<ScheduleMatch> = {}): ScheduleMatch => ({
  id: 1,
  competition: 'mens',
  bracket: 'main',
  number: 1,
  round: 1,
  thirdPlace: false,
  position: 0,
  totalRounds: 3,
  court: 1,
  day: 0,
  slot: 0,
  status: 'planned',
  winner: null,
  outcome: null,
  score: NO_SCORE,
  slot1: { kind: 'player', firstName: 'Fabian', lastName: 'Pahl', club: 'TV Winsen', seed: 3 },
  slot2: { kind: 'player', firstName: 'Tim', lastName: 'Weselmann', club: 'TSV Winsen', seed: null },
  ...over
})

let renderSchedule: typeof import('../src/components/schedule-board.render').renderSchedule
let renderCourts: typeof import('../src/components/schedule-board.render').renderCourts

beforeAll(async () => {
  ;(globalThis as unknown as { document: unknown }).document = { createElement }
  ;({ renderSchedule, renderCourts } = await import('../src/components/schedule-board.render'))
})

// Render one match through the real projection and hand back its `.sched-match__players` element — the
// grid the two contestant lines dissolve into. Going through `scheduleView` is the point: the bug was in
// how the view's optional outcome met the renderer, so a test handing the renderer a ready-made slot would
// have kept passing.
const players = (over: Partial<ScheduleMatch> = {}): FakeEl => {
  const sections = createElement('div')
  const view = scheduleView({ published: true, matches: [match(over)] }, OPTIONS)
  renderSchedule(sections as unknown as HTMLElement, view.days, LOGOS)
  const court = sections.children[0].children[1]
  const row = court.children[1]
  return row.children.find(c => c.className === 'sched-match__players')!
}

// The grid's cells in placement order: each contestant line is `display: contents`, so its children are
// the items and the line element itself occupies nothing.
const cells = (grid: FakeEl): FakeEl[] =>
  grid.children.flatMap(child => (child.className.startsWith('sched-match__player') ? child.children : [child]))

const classes = (grid: FakeEl) => cells(grid).map(c => c.className)

// Identity · sets · outcome, twice, then the meta spanning the full width. Three cells per line is what
// keeps the second line starting in column 1, so it is asserted for every outcome the row can carry.
const LINE_CELLS = [
  'sched-match__ident',
  'sched-match__games',
  'sched-match__outcome',
  'sched-match__ident',
  'sched-match__games',
  'sched-match__outcome',
  'sched-match__meta'
]

describe('schedule board · a contestant line always occupies all three columns (#343)', () => {
  it('emits identity, sets and outcome for a normally scored match', () => {
    // The reported case: Pahl beat Weselmann 6:3 6:4, no special outcome, so neither line has a token —
    // and this is exactly where the row used to break, because it is the common case, not an edge one.
    const grid = players({ status: 'done', winner: 1, score: { set1: [6, 3], set2: [6, 4], mtb: null } })

    expect(classes(grid)).toEqual(LINE_CELLS)
    expect(cells(grid)[1].textContent).toBe('6 6')
    expect(cells(grid)[4].textContent).toBe('3 4')
    // Present and empty, not absent: the cell is what holds the column open.
    expect(cells(grid)[2].textContent).toBe('')
    expect(cells(grid)[5].textContent).toBe('')
  })

  it('emits both cells for a match nobody has played yet', () => {
    const grid = players()

    expect(classes(grid)).toEqual(LINE_CELLS)
    expect(
      cells(grid)
        .map(c => c.textContent)
        .slice(1, 3)
    ).toEqual(['', ''])
  })

  it('keeps the shape when the walkover token sits on the second line', () => {
    // Winner on slot2 is the asymmetric case: the token lands on the *second* line, so the first supplies
    // an empty outcome cell and only that keeps the second line starting in column 1.
    const grid = players({ status: 'done', winner: 2, outcome: 'walkover', score: NO_SCORE })

    expect(classes(grid)).toEqual(LINE_CELLS)
    expect(cells(grid)[2].textContent).toBe('')
    expect(cells(grid)[5].textContent).toBe('w.o.')
  })

  it('keeps the shape when a retirement follows the sets played', () => {
    const grid = players({
      status: 'done',
      winner: 2,
      outcome: 'retirement',
      score: { set1: [3, 6], set2: [1, 4], mtb: null }
    })

    expect(classes(grid)).toEqual(LINE_CELLS)
    expect(cells(grid)[5].textContent).toBe('· Aufg.')
  })

  it('builds the same three-cell line on the courts board', () => {
    // The courts cell reuses the line outside the grid, where the empty outcome is hidden in CSS
    // (`.court__players .sched-match__outcome:empty`). The DOM stays uniform across both surfaces, so
    // neither can drift into a shape the other's layout does not expect.
    const courtsEl = createElement('div')
    const view = scheduleView(
      {
        published: true,
        matches: [match({ status: 'running', liveCourt: 1, score: { set1: [6, 3], set2: [2, 1], mtb: null } })]
      },
      OPTIONS
    )
    renderCourts(courtsEl as unknown as HTMLElement, view.courts, LOGOS)

    const live = courtsEl.children.find(c => c.className.includes('court--live'))!
    const lines = live.children.find(c => c.className === 'court__players')!.children
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line.children.map(c => c.className)).toEqual([
        'sched-match__ident',
        'sched-match__games',
        'sched-match__outcome'
      ])
    }
  })
})
