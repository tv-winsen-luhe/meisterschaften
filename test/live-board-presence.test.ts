import { beforeAll, describe, expect, it } from 'vitest'
import { scheduleView } from '../shared/match-view'
import type { MatchScore, ScheduleMatch } from '../shared'
import type { ScheduleViewOptions } from '../shared/match-view'

// „Jetzt auf dem Platz" is present only while it has an answer (#347, ADR-0072). With nothing running the
// board's whole content was the absence of content — a heading over six cells all reading „frei" — which a
// reader on site scrolls past before reaching the schedule. What is *next* is the rows' job.
//
// The decision is the projection's, not the DOM layer's: the view's court cells are **absent** rather than a
// six-element array of free ones, and the renderer builds the section only when they arrive. Both halves are
// asserted here — this file, rather than test/match-view.test.ts or test/schedule-board-render.test.ts, both
// of which sit at the repo's 300-line budget.
//
// The rule reads the running status alone. No clock enters it: the projection stays timeless (ADR-0032
// leaves „läuft" to the match status), so „the board is gone" can never mean „the phone's clock is wrong".

const NO_SCORE: MatchScore = { set1: null, set2: null, mtb: null }

const match = (over: Partial<ScheduleMatch> & Pick<ScheduleMatch, 'id' | 'court'>): ScheduleMatch => ({
  competition: 'mens',
  bracket: 'main',
  number: over.id,
  round: 1,
  thirdPlace: false,
  position: 0,
  totalRounds: 3,
  day: 0,
  slot: 0,
  status: 'planned',
  winner: null,
  outcome: null,
  score: NO_SCORE,
  slot1: { kind: 'player', firstName: 'Jan', lastName: 'Behrens', club: 'TV Winsen', seed: null },
  slot2: { kind: 'player', firstName: 'Til', lastName: 'Osten', club: 'TV Winsen', seed: null },
  ...over
})

const OPTIONS: ScheduleViewOptions = {
  days: [{ weekday: 'Samstag', short: '22.08.' }],
  competitions: [
    { slug: 'womens', label: 'Damen' },
    { slug: 'mens', label: 'Herren' }
  ]
}

const view = (matches: ScheduleMatch[], over: Partial<ScheduleViewOptions> = {}) =>
  scheduleView({ published: true, matches }, { ...OPTIONS, ...over })

describe('live board · the projection reports courts only while one is running (#347)', () => {
  it('reports no court cells at all when nothing is running', () => {
    const result = view([match({ id: 1, court: 1 }), match({ id: 2, court: 2, status: 'done', winner: 1 })])
    expect(result.courts).toBeUndefined()
    // The rows are untouched — what is next is still there to read.
    expect(result.days[0].courts.map(c => c.court)).toEqual([1, 2])
  })

  it('reports no court cells on an empty feed', () => {
    expect(view([]).courts).toBeUndefined()
  })

  it('reports all six courts as soon as one match runs — five of them idle', () => {
    const result = view([match({ id: 1, court: 2, status: 'running' }), match({ id: 2, court: 3 })])
    expect(result.courts).toHaveLength(6)
    expect(result.courts?.filter(c => c.free)).toHaveLength(5)
    expect(result.courts?.[1]).toMatchObject({ court: 2, free: false })
  })

  it('dims a running court outside the filtered field rather than relabelling it „frei"', () => {
    const result = view(
      [
        match({ id: 1, court: 1, status: 'running', competition: 'mens' }),
        match({ id: 2, court: 2, status: 'running', competition: 'womens' })
      ],
      { competition: 'womens' }
    )
    expect(result.courts?.[0]).toMatchObject({ free: false, dim: true })
  })
})

// ── The renderer's half ──────────────────────────────────────────────────────────────────────────
// The same `document` shim the sibling render tests use, plus `hidden` — the flag `renderFilter` already
// uses to withdraw a section that has nothing to say, and now the live board too.

interface FakeClassList {
  add: (...names: string[]) => void
}

interface FakeEl {
  tagName: string
  className: string
  textContent: string
  hidden: boolean
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
    hidden: false,
    children: [],
    append: (...nodes: FakeEl[]) => el.children.push(...nodes),
    replaceChildren: (...nodes: FakeEl[]) => {
      el.children.length = 0
      el.children.push(...nodes)
    },
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

let renderCourts: typeof import('../src/components/schedule-board.render').renderCourts

beforeAll(async () => {
  ;(globalThis as unknown as { document: unknown }).document = { createElement }
  ;({ renderCourts } = await import('../src/components/schedule-board.render'))
})

const render = (matches: ScheduleMatch[]): FakeEl => {
  const board = createElement('section')
  renderCourts(board as unknown as HTMLElement, view(matches).courts, LOGOS)
  return board
}

describe('live board · the renderer builds the section only when cells arrive (#347)', () => {
  it('leaves nothing behind — no heading, no cells, no placeholder — when none do', () => {
    const board = render([match({ id: 1, court: 1 })])
    expect(board.children).toHaveLength(0)
    expect(board.hidden).toBe(true)
  })

  it('builds the heading and the six cells when one match runs', () => {
    const board = render([match({ id: 1, court: 2, status: 'running' })])
    expect(board.hidden).toBe(false)
    expect(board.children.map(c => c.className)).toEqual(['board-heading', 'courts'])
    expect(board.children[0].textContent).toBe('Jetzt auf dem Platz')
    expect(board.children[1].children).toHaveLength(6)
  })
})
