// Presentation metadata for a competition card, keyed by competition id. The card's *content*
// (label, audience, blurb) lives on the Competition itself (tournament.ts); this is only the *look*
// — the colour variant, the category badge, the field type. It lives in one place so the front door
// and the outreach porches (ADR-0052) render identical cards from the same source, and so a restyle
// can never drift between the two surfaces.

export interface CardStyle {
  variant: 'light' | 'dark' | 'blue' | 'clay'
  /** Category badge label (e.g. „Hauptfeld", „Gesellig"). */
  badge: string
  /** „Einzel" / „Doppel" descriptor above the title. */
  type: string
  /** Longer labels („Damen Doppel", „Herren Challenger") take a smaller title clamp. */
  compact?: boolean
  /** Render the label inside a MarkerHighlight brush (implies navy label text over the brush). */
  marker?: boolean
}

export const CARD_STYLES: Record<string, CardStyle> = {
  womens: { variant: 'dark', badge: 'Winsener Meisterin', type: 'Einzel' },
  mens: { variant: 'light', badge: 'Hauptfeld', type: 'Einzel' },
  'womens-social': { variant: 'clay', badge: 'Gesellig', type: 'Doppel', compact: true },
  'mens-challenger': { variant: 'blue', badge: 'Freizeit & Einsteiger', type: 'Einzel', compact: true, marker: true }
}

/**
 * The card style for a competition id. Every rendered card goes through here so a competition without
 * a style fails loud at build with a clear message (which field is missing) rather than a cryptic
 * `undefined` destructure in the card component. `CARD_STYLES` cannot be keyed to a literal-id union —
 * `Competition['id']` is `string` — so this guard is the enforcement point instead.
 */
export const cardStyleFor = (id: string): CardStyle => {
  const style = CARD_STYLES[id]
  if (!style) throw new Error(`No CardStyle for competition "${id}"`)
  return style
}
