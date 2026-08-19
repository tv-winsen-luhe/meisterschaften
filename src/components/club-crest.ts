import type { Club } from '../../shared'

// The club crest, shared by the public surfaces that fly one (#309): the participant list, which has shown
// it since the list existed, and now the schedule's match row — where it stands in for the country flag the
// reference tournaments put beside a name. We have no nations, but we do have club affiliation, and that is
// what this audience reads.
//
// Extracted the moment there was a second caller, and no earlier: two inline copies of „does this club
// string contain TSV" is exactly the divergence #305 removed from the score formatter, and the match row's
// whole thesis is that a thing which appears on two surfaces exists once.

// The two crests, read off a component's dataset and handed in so this module stays free of the DOM it did
// not build. The assets are bundled per surface (Astro fingerprints them), so the URLs are the page's to
// know and never this module's.
export interface Logos {
  tv: string
  tsv: string
}

/**
 * The crest `img` for a club, alt-texted with the club's name — it identifies who someone plays for, so it
 * is content, not decoration. Lazy, because a schedule page carries one per contestant line.
 *
 * Switches on the exact club rather than sniffing the string for „TSV": the value is a closed set on the
 * wire (shared/club.ts), so an equality test is both simpler and honest about that.
 */
export const crestImage = (club: Club, logos: Logos): HTMLImageElement => {
  const img = document.createElement('img')
  img.src = club === 'TSV Winsen' ? logos.tsv : logos.tv
  img.alt = club
  img.loading = 'lazy'
  return img
}
