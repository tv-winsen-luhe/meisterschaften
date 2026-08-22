import { suspensionNotice, type NoticeSurface, type PlaySuspension } from '../../shared/play-suspension'

/** The band's pinned state, toggled by its own sentinel observer. Named here so the component and the observer agree. */
export const CONDENSED_CLASS = 'is-condensed'

/**
 * On `<html>` while a suspension stands. The schedule's day heading un-pins on it: with the band pinned it
 * would be the third pinned layer, which is the count that page's own comment refuses.
 */
export const SUSPENDED_ROOT_CLASS = 'is-play-suspended'

// The Play suspension band's renderer (ADR-0078 rule 8) — the DOM half of `suspension-band.astro`, shared by
// the two surfaces that carry it so „what the band looks like" is decided once.
//
// It renders and it hides; it decides nothing. Which notice a surface gets, and whether there is one at all,
// is `suspensionNotice`'s answer — including the decay of a passed resume time, which is why `now` is
// threaded through rather than read here.
//
// It does publish one fact beyond the band, on the document root: **a suspension is standing**. The pinned
// band is a second permanently visible layer, and the schedule caps itself at two on purpose — three pinned
// layers on a phone is most of the viewport — so while the band stands, the day heading stands down. That is
// a state a page reacts to, not an offset it has to add up: nothing stacks *below* the band, because the one
// thing that used to is exactly what steps aside for it.

/**
 * Paint the band for the state as it reads at `now`, or hide it when play is happening.
 *
 * Hiding rather than removing: the element is delivered with the page and moves between states over a
 * spectator's whole afternoon — a suspension declared, a resume time set, that time passing, the suspension
 * lifted — and each of those is a re-render of the same element.
 */
export const renderSuspensionBand = (
  band: HTMLElement | null,
  suspension: PlaySuspension,
  now: number,
  surface: NoticeSurface
): void => {
  if (!band) return
  const notice = suspensionNotice(suspension, now, surface)
  const root = band.ownerDocument.documentElement
  if (notice === null) {
    band.hidden = true
    root.classList.remove(SUSPENDED_ROOT_CLASS)
    return
  }
  const headline = band.querySelector<HTMLElement>('[data-suspension-headline]')
  const lines = band.querySelector<HTMLElement>('[data-suspension-lines]')
  const condensed = band.querySelector<HTMLElement>('[data-suspension-condensed]')
  if (headline) headline.textContent = notice.headline
  if (lines) {
    lines.replaceChildren(
      ...notice.lines.map(text => {
        const p = document.createElement('p')
        p.textContent = text
        return p
      })
    )
  }
  // The pinned one-liner, finished in the projection like every other string here. It is re-set on each
  // render rather than only on the first, because the resume time it carries decays: at 14:40 the condensed
  // « … · weiter ca. 14:30 Uhr » has been refuted exactly as the full form's line has.
  if (condensed) condensed.textContent = notice.condensed
  band.hidden = false
  root.classList.add(SUSPENDED_ROOT_CLASS)
}
