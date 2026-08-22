// A score line as the projections hand it over, written the way a tennis reader says it. `scoreLine`
// (shared/score.ts) pads every entry to a digit-wide column with U+2007 FIGURE SPACE so the two contestant
// lines line up under each other; that padding is invisible and would make every expectation in the view
// tests („ 6  3 10") unreadable if spelled out. So the tests say `score('6 3 10')` and this applies the
// column, and test/score-line.test.ts spells the codepoints out literally — the one place the padding rule
// itself is pinned, so this helper cannot quietly redefine it.
const FIGURE_SPACE = '\u2007'

export const score = (line: string): string =>
  line === ''
    ? ''
    : line
        .split(' ')
        .map(entry => entry.padEnd(2, FIGURE_SPACE))
        .join(' ')
