import type { CompetitionSlug } from '../../../shared'

// A distinct accent per competition, so the operator can tell which field a card belongs to at a glance
// when several competitions are drawn. It rides *alongside* the „M{n} · {competition}" label on the
// schedule match card, never as the only differentiator — a colour-blind or low-vision operator still
// reads the field from the text (issue #120). One hue per field carried in two Tailwind forms — the card's
// left `border` and the competition label's `text` (#142) — held together in a single map so the two can
// never drift apart. Keyed off the slug, so a match keeps its accent from the backlog onto the grid. The
// `Record<CompetitionSlug, …>` makes the mapping total: a new slug fails to compile until it has a colour.
// Purely presentational — no bearing on the validator, API, or public feed.
interface Accent {
  border: string
  text: string
}

const COMPETITION_ACCENT: Record<CompetitionSlug, Accent> = {
  mens: { border: 'border-l-blue-500', text: 'text-blue-600' },
  'mens-challenger': { border: 'border-l-cyan-500', text: 'text-cyan-600' },
  womens: { border: 'border-l-rose-500', text: 'text-rose-600' }
}

// The neutral fallback for an unknown slug — visible as an accent, but plainly not one of the competitions.
const NEUTRAL_ACCENT: Accent = { border: 'border-l-muted-foreground/40', text: 'text-muted-foreground' }

// `Object.hasOwn` rather than a bare lookup + `??`: the param is widened to `string` (the slug arrives
// from data, defensively untyped here), so a slug colliding with a prototype key — `toString`, `constructor`
// — would otherwise resolve to the inherited member and skip the neutral fallback.
const accentFor = (slug: string): Accent =>
  Object.hasOwn(COMPETITION_ACCENT, slug) ? COMPETITION_ACCENT[slug as CompetitionSlug] : NEUTRAL_ACCENT

// The left-border accent (the card chrome) and the matching text accent (the competition label) — two
// reads of one hue, so a recolour or a new field touches a single entry.
export const competitionAccent = (slug: string): string => accentFor(slug).border
export const competitionTextAccent = (slug: string): string => accentFor(slug).text
