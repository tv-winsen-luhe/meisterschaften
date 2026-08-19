import type { Segment } from './tournament-draw.render'

// The public bracket's address (#313): the reader's three choices — field, bracket, round — read out of the
// query string and written back into it, so a reload keeps the view and „hier ist dein Draw" is a link
// somebody can send. It is the draw's side of the rule /spielplan's competition filter already follows
// (#310): **English keys and values, the round as a number**, while the route slug stays German — the one
// place ADR-0028 permits exactly that, and the reason the round travels as `2` rather than as
// „Viertelfinale", which is derived at the edge from the round number.
//
// Its own module rather than a corner of the controller, for the reason `drawableCompetitions` is one: what
// a stranger's URL means is a decision — a hand-typed value, a stale bookmark, a field that has no draw —
// and a decision belongs somewhere it can be stated once and tested. Pure and DOM-free; the controller
// supplies the search string and the fields that actually have a tab.

/** The three query parameter keys, English (see the module note). */
const COMPETITION = 'competition'
const BRACKET = 'bracket'
const ROUND = 'round'

/**
 * What the address asks for. `competition` is null when it names no field the page has a draw for — the
 * page then keeps its own default (the championship), because „unknown field" must degrade to a bracket
 * somebody can read rather than to an empty panel (ADR-0035).
 *
 * `segment` and `round` are always answered, and answered *independently* of the field: a link whose field
 * has since been cancelled still says which bracket and round its sender was looking at, and the surviving
 * field is the better place to land than round 1 of the main draw.
 */
export interface DrawSelection {
  competition: string | null
  segment: Segment
  round: number
}

/**
 * The round the address asks for: a whole number of at least 1. Anything else — absent, empty, „zwei",
 * zero, negative, fractional — is the outermost round, which every bracket has.
 *
 * The *upper* end is not decided here on purpose: how deep a bracket is, is a fact of the drawn field, so
 * `bracketView` clamps a round past the final into the tree it actually shows (and re-clamps it when the
 * reader switches to a shallower consolation). Answering it twice would let the two answers drift.
 */
const askedRound = (raw: string | null): number => {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** Reads a `location.search` into the reader's three choices. `slugs` are the fields that have a draw tab. */
export const drawSelection = (search: string, slugs: readonly string[]): DrawSelection => {
  const params = new URLSearchParams(search)
  const competition = params.get(COMPETITION)
  return {
    competition: competition !== null && slugs.includes(competition) ? competition : null,
    // Only the wire value counts. „Nebenrunde" is what the button says, never what the address carries.
    segment: params.get(BRACKET) === 'consolation' ? 'consolation' : 'main',
    round: askedRound(params.get(ROUND))
  }
}

/**
 * A view somebody is actually looking at — the same three choices as `DrawSelection`, except that the field
 * is settled: the address is only ever written for a bracket on screen, and there is always one.
 */
export interface ChosenDraw {
  competition: string
  segment: Segment
  round: number
}

/**
 * The same three choices as query parameters, for the controller to set on the current URL. A record rather
 * than a finished search string, so the page's other parameters (a campaign tag, another surface's state)
 * survive being written past.
 */
export const drawSelectionParams = (selection: ChosenDraw): Record<string, string> => ({
  [COMPETITION]: selection.competition,
  [BRACKET]: selection.segment,
  [ROUND]: String(selection.round)
})
