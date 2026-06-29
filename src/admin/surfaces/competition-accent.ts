import type { CompetitionSlug } from '../../../shared'

// A distinct left-border accent per competition, so the operator can tell which field a card belongs to
// at a glance when several competitions are drawn. It rides *alongside* the „M{n} · {competition}" label
// on the schedule match card, never as the only differentiator — a colour-blind or low-vision operator
// still reads the field from the text (issue #120). Keyed off the slug, so a match keeps its accent from
// the backlog onto the grid. The `Record<CompetitionSlug, …>` makes the mapping total: a new slug fails
// to compile until it has a colour. Purely presentational — no bearing on the validator, API, or public feed.
const COMPETITION_ACCENT: Record<CompetitionSlug, string> = {
  mens: 'border-l-blue-500',
  'mens-challenger': 'border-l-cyan-500',
  womens: 'border-l-rose-500'
}

// The neutral fallback for an unknown slug — visible as an accent, but plainly not one of the competitions.
const NEUTRAL_ACCENT = 'border-l-muted-foreground/40'

// `Object.hasOwn` rather than a bare lookup + `??`: the param is widened to `string` (the slug arrives
// from data, defensively untyped here), so a slug colliding with a prototype key — `toString`, `constructor`
// — would otherwise resolve to the inherited member and skip the neutral fallback.
export const competitionAccent = (slug: string): string =>
  Object.hasOwn(COMPETITION_ACCENT, slug) ? COMPETITION_ACCENT[slug as CompetitionSlug] : NEUTRAL_ACCENT
