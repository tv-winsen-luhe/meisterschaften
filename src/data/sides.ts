import { competitions, type Competition } from './tournament'

// The Damen outreach porch — /damen (CONTEXT.md: Outreach porch, ADR-0052, ADR-0055). A porch is a
// signup-era landing page for one side of the event, handed out by link to its audience. This module is
// the porch's only bespoke content: the German route slug, the two fields it shows (ADR-0051), the
// per-URL preview card, and the targeted lead copy. Everything evergreen stays on the front door and is
// linked, never restated here.
//
// The Herren porch was retired (ADR-0057): the segmented Rundmail is email, so its per-URL OG card is
// inert, and the front door already explains the two competitive Herren fields — so the broad Herren
// send lands on the front door, not a porch. Only the Damen porch survives, because it does work the
// front door structurally cannot (the „nicht gut genug" barrier, the motive split, beginner-welcome —
// all Damen-specific; ADR-0055). SIDES is therefore a single-entry list, kept as a list so a future
// side is data, not a special case.

export interface Side {
  /** German route slug (ADR-0028) — the porch URL. */
  slug: 'damen'
  /** Display name of the side (page title, meta). Data-driven so a future side isn't a special case. */
  name: string
  /**
   * The side's fields (competition ids), in the porch's display order. Two per side (ADR-0051). Damen
   * leads with the social field (`womens-social`), because the probe makes the social B-field the
   * genuine first choice (ADR-0054).
   */
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
    // Social field first: the probe leads with the Damen Doppel-Mixer (ADR-0054).
    fieldIds: ['womens-social', 'womens'],
    ogTitle: 'Damen — spiel mit bei den Winsener Meisterschaften',
    // B-field first, self-choice, no LK numbers, never „Challenger" (Sag/Vermeide guide, 02.07).
    ogDescription:
      'Zwei Felder, du wählst selbst: der gesellige Damen Doppel-Mixer zum Kennenlernen — allein anmelden, Partnerinnen wechseln reihum — oder das Einzel um die Winsener Meisterin. Für jede was dabei, egal wie du spielst. 22.–23.08.',
    // Short phrase first: the hero's date block sits absolutely top-right on desktop, so a long first
    // line collides with it (the front door avoids this with a short „Winsener" first line). „Spiel mit"
    // sits beside the date; „zwei Tage Tennis" drops below it.
    eyebrow: 'Winsener Meisterschaften',
    headline: ['Spiel mit —', 'zwei Tage Tennis'],
    lead: 'Ein geselliger Spieltag zum Kennenlernen — oder Matches um den Titel, wenn dir danach ist. Du wählst selbst, in welchem Feld du spielst; für jede ist was dabei, egal wie du spielst.',
    leadSub: 'Du kannst allein kommen oder zu zweit — eine Partnerin brauchst du nicht, Vorkenntnisse auch nicht.'
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
