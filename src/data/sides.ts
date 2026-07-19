import { competitions, type Competition } from './tournament'

// The two outreach porches — /damen and /herren (CONTEXT.md: Outreach porch, ADR-0052, ADR-0054). A
// porch is a signup-era landing page for one side of the event, handed out by link (WhatsApp) to a
// warm, hand-picked audience. This module is the porch's only bespoke content: the German route slug,
// the two fields it shows (ADR-0051), the per-URL WhatsApp preview card (the reason a route beats an
// anchor — ADR-0052), and the targeted lead copy. Everything evergreen stays on the front door and is
// linked, never restated here.
//
// The two porches are not one symmetric object (ADR-0054/0056): Damen is a *validation probe* (the
// social field's format is open — the page leads with the social B-field, presents the competitive
// A-field as the honest second option, and lets the group self-choose by motive). Herren is now a
// *broad conversion surface* at the same structural richness (ADR-0056): two equal competitive doors
// (Hauptfeld + Challenger), belonging-first, with the Challenger framed as fairness — never
// beginner-reassurance. That difference lives in the porch templates and the copy below, not in a flag.

export interface Side {
  /** German route slug (ADR-0028) — the porch URL and the getStaticPaths param. */
  slug: 'damen' | 'herren'
  /** Display name of the side (page title, meta). Data-driven so a future side isn't a special case. */
  name: string
  /**
   * The side's fields (competition ids), in the porch's display order. Two per side (ADR-0051). Herren
   * leads with the championship field; Damen leads with the social field (`womens-social`), because
   * the probe makes the social B-field the genuine first choice (ADR-0054).
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
  },
  {
    slug: 'herren',
    name: 'Herren',
    fieldIds: ['mens', 'mens-challenger'],
    ogTitle: 'Herren — spiel mit bei den Winsener Meisterschaften',
    // Two equal competitive doors, Challenger as fairness (not beginner-reassurance) — the #239 framing
    // (ADR-0056). No „Doppel / ohne Partner" register (Herren has no Doppel); the low-barrier facts are
    // „ohne Mannschaft" and „LK musst du nicht kennen".
    ogDescription:
      'Zwei Felder, beide um einen Titel: das Hauptfeld gegen die Stärksten im Verein und das Challenger-Feld auf Augenhöhe (ab LK 20), vor stärkeren Gegnern geschützt. Ohne Mannschaft, ohne dass du deine LK kennst. 22.–23.08.',
    // Belonging first, then the two equal doors (Herren Rundmail voice, #216). Short first line keeps
    // clear of the hero's absolutely-positioned date block (same reason the Damen headline is short).
    eyebrow: 'Winsener Meisterschaften',
    headline: ['Ein Wochenende,', 'voller Tennis.'],
    lead: 'Der ganze TV Winsen trägt zwei Tage seine Vereinsmeisterschaft aus — volle Anlage, echtes Turnierfeeling. Zwei Felder, beide um einen Titel: das Hauptfeld gegen die Stärksten im Verein, das Challenger-Feld auf Augenhöhe und vor stärkeren Gegnern geschützt.',
    leadSub: 'Ohne Mannschaft, ohne dass du deine Leistungsklasse kennen musst — anmelden reicht.'
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
