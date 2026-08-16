import { beforeAll, describe, expect, it } from 'vitest'
import type { Participant } from '../shared'

// Feedback loop for the "Nr. 3/4 are shown on a fixed line in the pre-draw preview" bug. The render
// module is DOM code, and the workers pool has no `document`, so a minimal shim stands in — enough for
// createElement/className/textContent/append/setAttribute/dataset/innerHTML plus a text serializer.

interface FakeClassList {
  add: (c: string) => void
}

interface FakeEl {
  tagName: string
  className: string
  textContent: string
  children: FakeEl[]
  attrs: Record<string, string>
  dataset: Record<string, string>
  classList: FakeClassList
  append: (...nodes: FakeEl[]) => void
  setAttribute: (k: string, v: string) => void
  querySelectorAll: () => FakeEl[]
  innerHTML: string
  title: string
}

const createElement = (tag: string): FakeEl => {
  const el: FakeEl = {
    tagName: tag,
    className: '',
    textContent: '',
    children: [],
    attrs: {},
    dataset: {},
    classList: { add: (c: string) => (el.className = `${el.className} ${c}`.trim()) },
    append: (...nodes: FakeEl[]) => el.children.push(...nodes),
    setAttribute: (k: string, v: string) => (el.attrs[k] = v),
    querySelectorAll: () => [],
    innerHTML: '',
    title: ''
  }
  return el
}

// The round-1 lines of a rendered tree, top to bottom, as readable text ("?" for an undrawn line).
const firstRoundLines = (root: FakeEl): string[] => {
  const firstColumn = root.children[0]
  const matches = firstColumn.children.find(c => c.className.includes('dm-matches')) ?? firstColumn.children[1]
  return matches.children.flatMap(match =>
    match.children
      .filter(line => line.className.startsWith('dm-slot'))
      .map(line =>
        line.className.includes('dm-slot--tbd')
          ? '?'
          : line.children
              .map(c => c.textContent)
              .filter(Boolean)
              .join(' ')
      )
  )
}

const player = (i: number, lk: string): Participant =>
  ({
    firstName: `P${i}`,
    lastName: `L${i}`,
    club: 'TV Winsen',
    lk,
    seedRank: null,
    createdAt: `2026-06-01T10:00:0${i}.000Z`
  }) as unknown as Participant

// A 16-field: LKs 1.0 … 16.0, so seedRank 1..4 are unambiguous (§30.5a: a 16-draw seeds 4).
const field16: Participant[] = Array.from({ length: 16 }, (_, i) => {
  const p = player(i + 1, `${i + 1}.0`)
  return { ...p, seedRank: i < 4 ? i + 1 : null }
})

let renderPreview: typeof import('../src/components/tournament-draw.render').renderPreview

beforeAll(async () => {
  ;(globalThis as unknown as { document: unknown }).document = { createElement }
  ;({ renderPreview } = await import('../src/components/tournament-draw.render'))
})

describe('pre-draw preview, 16-field', () => {
  it('pins Nr. 1 and Nr. 2 to their table lines (DTB §30.5b, no lot)', () => {
    const bracket = createElement('div')
    renderPreview(bracket as unknown as HTMLElement, field16, false)

    const lines = firstRoundLines(bracket.children[0])
    expect(lines[0]).toContain('P1 L1')
    expect(lines[15]).toContain('P2 L2')
  })

  it('never commits Nr. 3 or Nr. 4 to one of the two lot lines — the lot decides that (§30.5b)', () => {
    const bracket = createElement('div')
    renderPreview(bracket as unknown as HTMLElement, field16, false)

    const lines = firstRoundLines(bracket.children[0])
    // Lines 5 and 12 (0-indexed 4 and 11) are prescribed for the Nr. 3/4 group, so both carry the whole
    // group; no line may name one of them alone, which would pre-announce the lot's result.
    for (const line of [lines[4], lines[11]]) {
      expect(line).toContain('P3 L3')
      expect(line).toContain('P4 L4')
      expect(line).toContain('wird gelost')
      expect(line).toContain('3/4')
    }
    const others = lines.filter((_, i) => i !== 4 && i !== 11)
    expect(others.join(' | ')).not.toContain('P3')
    expect(others.join(' | ')).not.toContain('P4')
  })

  it('drops the seed pill on a redacted field but keeps the lot line (ADR-0048)', () => {
    const bracket = createElement('div')
    renderPreview(bracket as unknown as HTMLElement, field16, true)

    const lines = firstRoundLines(bracket.children[0])
    expect(lines[4]).toContain('P3 L3')
    expect(lines[4]).toContain('wird gelost')
    expect(lines[4]).not.toContain('3/4')
  })

  it('leaves the 8-draw untouched — its seeds are both table-fixed, no lot group', () => {
    const field8 = field16.slice(0, 8).map((p, i) => ({ ...p, seedRank: i < 2 ? i + 1 : null }))
    const bracket = createElement('div')
    renderPreview(bracket as unknown as HTMLElement, field8, false)

    const lines = firstRoundLines(bracket.children[0])
    expect(lines[0]).toContain('P1 L1')
    expect(lines[7]).toContain('P2 L2')
    expect(lines.join(' | ')).not.toContain('wird gelost')
  })
})
