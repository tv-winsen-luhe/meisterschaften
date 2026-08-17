import { beforeAll, describe, expect, it } from 'vitest'
import type { Participant } from '../shared'

// Feedback loop for the "the Challenger's Setzliste shows no seed markers" bug (ADR-0066): the public
// participant list gated its seeding board on a slug allow-list, so `mens-challenger` rendered as a plain
// list even though the wire carried its `seedRank`. The render module is DOM code and the workers pool has
// no `document`, so a minimal shim stands in — the same one test/preview-seed-lot.test.ts uses.

interface FakeEl {
  tagName: string
  className: string
  textContent: string
  children: FakeEl[]
  append: (...nodes: FakeEl[]) => void
  innerHTML: string
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
    innerHTML: '',
    title: '',
    src: '',
    alt: '',
    loading: ''
  }
  // `innerHTML = ''` is how the renderer clears a list, and on a real element that drops the children —
  // a plain field would not, and the "replaces the skeleton" case would pass against a broken renderer.
  Object.defineProperty(el, 'innerHTML', {
    get: () => '',
    set: (v: string) => {
      if (v === '') el.children.length = 0
    }
  })
  return el
}

const LOGOS = { tv: '/tv.svg', tsv: '/tsv.png' }

const player = (i: number, lk: string | null, seedRank: number | null): Participant =>
  ({
    firstName: `P${i}`,
    lastName: `L${i}`,
    club: 'TV Winsen',
    lk,
    redacted: false,
    seedRank,
    createdAt: `2026-06-01T10:00:${String(i).padStart(2, '0')}.000Z`
  }) as unknown as Participant

// A 16-field in wire order (LK ascending, ADR-0065), seeds 1..4 attached by the server (§30.5a).
const field16: Participant[] = Array.from({ length: 16 }, (_, i) => player(i + 1, `${i + 1}.0`, i < 4 ? i + 1 : null))

// The mixer's rows: unrated by construction (ADR-0058) and never seeded, so the wire sends seedRank null.
const mixer: Participant[] = Array.from({ length: 6 }, (_, i) => player(i + 1, null, null))

const rowsOf = (list: FakeEl) => list.children.filter(c => c.className.startsWith('pl-row'))
const seedCircles = (list: FakeEl) =>
  list.children.flatMap(row => row.children.filter(c => c.className.includes('pl-rank--seed')))
const rankCells = (list: FakeEl) =>
  list.children.flatMap(row => row.children.filter(c => c.className.startsWith('pl-rank')))
const dividers = (list: FakeEl) => list.children.filter(c => c.className === 'pl-divider')
const lkCells = (list: FakeEl) => list.children.flatMap(row => row.children.filter(c => c.className.includes('pl-lk')))

let renderField: typeof import('../src/components/participant-list.render').renderField

beforeAll(async () => {
  ;(globalThis as unknown as { document: unknown }).document = { createElement }
  ;({ renderField } = await import('../src/components/participant-list.render'))
})

// Render a field by its **slug**, exactly as the component does. Going through the slug is the point: the
// bug was the slug→board mapping, so a test that handed the renderer a ready-made boolean would have kept
// passing while `mens-challenger` still fell through to the friendly list.
const board = (slug: string, entries: readonly Participant[] = field16) => {
  const list = createElement('ol')
  renderField(list as unknown as HTMLElement, entries, slug, LOGOS)
  return list
}

describe('participant list — a seeded field renders a seeding board', () => {
  it('marks the seeds on the Challenger, exactly as on the championship field (ADR-0061 §1, ADR-0066)', () => {
    const challenger = board('mens-challenger')
    const mens = board('mens')

    expect(seedCircles(challenger)).toHaveLength(4)
    expect(seedCircles(challenger).map(c => c.textContent)).toEqual(['1', '2', '3', '4'])
    expect(rowsOf(challenger).map(r => r.className)).toEqual(rowsOf(mens).map(r => r.className))
    expect(dividers(challenger)).toHaveLength(1)
  })

  it('numbers the circle by the wire seedRank, not the row position (ADR-0047)', () => {
    // The server ranks by LK independently of the caller's display order (provisionalSeedRanks), so a
    // field whose display order is not the seeding order must still number its circles by seedRank.
    const list = board('mens', [player(1, '1.0', 1), player(2, '2.0', 2), player(9, '9.0', null)])

    expect(seedCircles(list).map(c => c.textContent)).toEqual(['1', '2'])
    expect(seedCircles(list).map(c => c.title)).toEqual(['An 1 gesetzt (vorläufig)', 'An 2 gesetzt (vorläufig)'])
  })

  it('splits the seeds from the rest with the lot divider', () => {
    const list = board('mens-challenger')

    expect(dividers(list)).toHaveLength(1)
    expect(list.children.indexOf(dividers(list)[0])).toBe(4)
    expect(dividers(list)[0].textContent).toBe('Weitere im Feld — Platzierung wird bei der Auslosung gelost')
  })

  it('numbers the unseeded rows by position and shows their LK', () => {
    const list = board('mens-challenger')

    expect(rankCells(list).map(c => c.textContent)).toEqual(Array.from({ length: 16 }, (_, i) => String(i + 1)))
    expect(lkCells(list)).toHaveLength(16)
  })

  it('shows no markers below the draw floor, where the server sends no seedRank', () => {
    const list = board('mens-challenger', [player(1, '1.0', null), player(2, '2.0', null)])

    expect(seedCircles(list)).toHaveLength(0)
    expect(dividers(list)).toHaveLength(0)
  })
})

describe('participant list — an unseeded field keeps the friendly list', () => {
  it('renders the mixer with no ranks, no seeds, no divider and no LK (ADR-0058)', () => {
    const list = board('womens-social', mixer)

    expect(rowsOf(list)).toHaveLength(6)
    expect(rankCells(list)).toHaveLength(0)
    expect(dividers(list)).toHaveLength(0)
    expect(lkCells(list)).toHaveLength(0)
  })
})

describe('participant list — the row body', () => {
  it('omits the LK of a redacted row but keeps „LK folgt" for a genuine null (ADR-0048)', () => {
    const redacted = { ...player(1, '1.0', null), redacted: true } as unknown as Participant
    const list = board('mens', [redacted, player(2, null, null)])

    expect(lkCells(list)).toHaveLength(1)
    expect(lkCells(list)[0].textContent).toBe('LK folgt')
  })

  it('clears whatever the list held before (the server-rendered skeleton)', () => {
    const list = createElement('ol')
    list.append(createElement('li'), createElement('li'))
    renderField(list as unknown as HTMLElement, mixer, 'womens-social', LOGOS)

    expect(list.children).toHaveLength(6)
  })
})
