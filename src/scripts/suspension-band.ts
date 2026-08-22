import { suspensionNotice, type NoticeSurface, type PlaySuspension } from '../../shared/play-suspension'

// The Play suspension band's renderer (ADR-0078 rule 8) — the DOM half of `suspension-band.astro`, shared by
// the two surfaces that carry it so „what the band looks like" is decided once.
//
// It renders and it hides; it decides nothing. Which notice a surface gets, and whether there is one at all,
// is `suspensionNotice`'s answer — including the decay of a passed resume time, which is why `now` is
// threaded through rather than read here.

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
  if (notice === null) {
    band.hidden = true
    return
  }
  const headline = band.querySelector<HTMLElement>('[data-suspension-headline]')
  const lines = band.querySelector<HTMLElement>('[data-suspension-lines]')
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
  band.hidden = false
}
