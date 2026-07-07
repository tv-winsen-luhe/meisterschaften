import { competitions, type Competition } from './tournament'

// The two outreach porches — /damen and /herren (CONTEXT.md: Outreach porch, ADR-0052). A porch is a
// thin, signup-era landing page for one side of the event, handed out by link (WhatsApp) to convert a
// targeted audience. This module is the porch's only bespoke content: the German route slug, the two
// fields it shows „als Gleiche" (ADR-0051), the per-URL WhatsApp preview card (the reason a route beats
// an anchor — ADR-0052), and the targeted lead copy. Everything evergreen stays on the front door and
// is linked, never restated here.

export interface Side {
  /** German route slug (ADR-0028) — the porch URL and the getStaticPaths param. */
  slug: 'damen' | 'herren'
  /** Display name of the side (page title, meta). Data-driven so a future side isn't a special case. */
  name: string
  /** The side's fields (competition ids), in display order. Two per side (ADR-0051). */
  fieldIds: readonly string[]
  /** WhatsApp/OG preview card — per-URL, which is what an anchor on the front door cannot carry. */
  ogTitle: string
  ogDescription: string
  /** Targeted hero lead. */
  eyebrow: string
  headline: readonly [string, string]
  /** Lead paragraph (HTML-free) — the one-line pitch under the headline. */
  lead: string
  /** Second, quieter lead line reinforcing the "for you" framing. */
  leadSub: string
}

export const SIDES: readonly Side[] = [
  {
    slug: 'damen',
    name: 'Damen',
    fieldIds: ['womens', 'womens-social'],
    ogTitle: 'Damen — spiel mit bei den Winsener Meisterschaften',
    ogDescription:
      'Zwei Felder für Damen: das Hauptfeld um die Winsener Meisterin und das gesellige Damen Doppel zum Kennenlernen — du meldest dich allein an, keine LK nötig. 22.–23.08.',
    eyebrow: 'Für die Damen',
    headline: ['Dein Wochenende,', 'dein Feld.'],
    lead: 'Ob ehrgeizig um den Titel oder gesellig zum Kennenlernen — bei den Damen gibt es beides, und beides zählt gleich.',
    leadSub: 'Du meldest dich allein an, deine Leistungsklasse musst du dafür nicht kennen.'
  },
  {
    slug: 'herren',
    name: 'Herren',
    fieldIds: ['mens', 'mens-challenger'],
    ogTitle: 'Herren — spiel mit bei den Winsener Meisterschaften',
    ogDescription:
      'Zwei Felder für Herren: das Hauptfeld um den Winsener Meister und das geschützte Challenger-Feld für Freizeit & Einsteiger (ab LK 20). Meld dich an — 22.–23.08.',
    eyebrow: 'Für die Herren',
    headline: ['Dein Wochenende,', 'dein Feld.'],
    lead: 'Spiel um den Titel im Hauptfeld — oder auf Augenhöhe im geschützten Challenger-Feld für Freizeit- und Einsteiger.',
    leadSub: 'Zwei Türen ins gleiche Wochenende. Deine Leistungsklasse musst du dafür nicht kennen.'
  }
] as const

/** The porch for a route slug, or undefined for anything that isn't a side. */
export const getSide = (slug: string): Side | undefined => SIDES.find(s => s.slug === slug)

/** Resolve a side's field ids to their competitions, in display order. */
export const sideFields = (side: Side): Competition[] =>
  side.fieldIds.map(id => {
    const competition = competitions.find(c => c.id === id)
    if (!competition) throw new Error(`Side "${side.slug}" references unknown competition "${id}"`)
    return competition
  })
