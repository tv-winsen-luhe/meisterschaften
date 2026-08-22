import type { Match, MatchStatus } from '../../../shared'

// What the admin's two match surfaces may *do* to a match. The **vocabulary** here is shared by the
// Ergebnisse row and the Spielplan card — the settable statuses, and „both players are known", the one
// condition under which there is a match to start and a result to enter (ADR-0080).
//
// `cardActions` below is the *card's* answer alone, and deliberately so. The row has room for a court
// select and for the „Zum Starten erst im Spielplan platzieren" hint, so it composes the same vocabulary
// into a richer control; the card has one court column on a horizontally scrolling grid and must decide
// its two chips outright. Folding the row into `cardActions` would mean returning the row's extra states
// from a function named for the card — so they share the parts that must not diverge, not the layout.

// The two states the status control moves between, in either direction. „beendet" is deliberately not
// among them: it is reached by entering a result, and nothing un-finishes a match — leaving `done` would
// have to decide what happens to a winner already advanced into the parent match (ADR-0079 rule 6, a named
// gap). Not „live" statuses: this event already calls a phase and a court „live", and what these two share
// is only that the control may set them.
export const SETTABLE_STATUSES = ['planned', 'running'] as const satisfies readonly MatchStatus[]
export type SettableStatus = (typeof SETTABLE_STATUSES)[number]

/**
 * Both slots hold a player ⇒ there is a result to enter and a match to start. A slot still naming a feeder
 * („Sieger M3") or a bye is not something the desk can play, so neither door is offered — the `regId` is
 * the same datum `viewSlot` reads to decide its `player` kind, so the two never disagree.
 */
export const bothPlayersKnown = (match: Pick<Match, 'slot1RegId' | 'slot2RegId'>): boolean =>
  match.slot1RegId !== null && match.slot2RegId !== null

// A status write the control would perform: the state it states, and — for „läuft" — the actual court it
// states with it (ADR-0079 rule 1). „geplant" carries none: the Store clears the actual court there, since
// an un-started match is on no court (rule 5).
export interface StatusWrite {
  next: SettableStatus
  liveCourt?: number
}

// What a placed Spielplan card offers (ADR-0080 rules 1 and 3): the result door, and the status control.
export interface CardActions {
  result: boolean
  status: StatusWrite | null
}

/**
 * The two affordances a Spielplan card carries, for one match.
 *
 * The **result door** needs both players and nothing else — a finished match keeps it, because correcting
 * a result is the same door (ADR-0026), and it is exactly what the Ergebnisse row offers as „Korrigieren".
 *
 * The **status control** is offered while the match can still move between „geplant" and „läuft", so a
 * `done` match has none. Starting states the actual court the match is on: the one already stated if it
 * has moved, else its reservation — the grid reads the divergence but never pulls it back (ADR-0079 rule
 * 3), so starting from the grid must not silently re-assert the reserved court. Without any court there is
 * no „läuft" to state at all, which on this surface only happens to a card that is not on the grid.
 */
export const cardActions = (
  match: Pick<Match, 'slot1RegId' | 'slot2RegId' | 'status' | 'court' | 'liveCourt'>
): CardActions => {
  if (!bothPlayersKnown(match)) return { result: false, status: null }
  const court = match.liveCourt ?? match.court
  if (match.status === 'running') return { result: true, status: { next: 'planned' } }
  if (match.status === 'planned' && court !== null)
    return { result: true, status: { next: 'running', liveCourt: court } }
  return { result: true, status: null }
}
