import { bracketDepth, loserOf } from './bracket-topology'
import {
  drawBracket,
  drawSize,
  hasConsolationBracket,
  materializeMatches,
  type DrawPlayer,
  type MatchOutcome,
  type MatchSlots,
  type RandomSource,
  type SeedingEntry
} from './draw'

// The consolation bracket (de: Nebenrunde / Trostrunde; CONTEXT: Consolation bracket, ADR-0004): a
// second KO for the main bracket's first-match losers, so nobody travels in, loses once, and goes home.
// This module owns the two pure rules the trigger needs — *who* enters (the lost-their-first-match set)
// and *when* it may be drawn (every first match decided) — plus the draw itself, which reuses the shared
// draw procedure. Pure and I/O-free: the worker reads the main bracket's matches + the field's seeded
// players and calls in here; the competitions surface reads the same rule for its disabled-button reason
// (the drawBlocker / challengerEligibility pattern, ADR-0011: authority and affordance share one source).

// The minimal match shape the consolation derivation reads — the bracket position, its two slots, the
// resolved winner/outcome, and the third-place flag. A structural subset of the store/wire `Match` and of
// `MatchSlots`, so both satisfy it without either module importing the other (the AdvanceableMatch idiom).
export interface ConsolationMatch {
  round: number
  slot1RegId: number | null
  slot2RegId: number | null
  winnerRegId: number | null
  outcome: MatchOutcome | null
  thirdPlace: boolean
}

// The round-1 bye-holders: the winners of round-1 bye matches. A bye gives a free pass into round 2, so a
// bye-holder's *first real* match is in round 2 — a genuine first match, unlike the round-1 winners beside
// them who already played (and won) one. Whether a bye-holder's round-2 loss feeds the consolation depends
// on whether that round is before the semifinals (see consolationEntrants).
const byeHolders = (matches: readonly ConsolationMatch[]): Set<number> => {
  const holders = new Set<number>()
  for (const m of matches)
    if (m.round === 1 && m.outcome === 'bye' && m.winnerRegId !== null) holders.add(m.winnerRegId)
  return holders
}

/**
 * The players who **lost their first main-bracket match** — the consolation bracket's entrants (CONTEXT:
 * Consolation bracket, ADR-0004): the round-1 losers, plus bye-holders who lose their round-2 match *when
 * that round is before the semifinals*. Round-2+ losers who had already won a match are out.
 *
 * The semifinal caveat is load-bearing: a **semifinal loser is the third-place match's player** (that
 * playoff is their guaranteed second match — the same principle that makes it "the consolation" at draw
 * size 4, CONTEXT: Third-place match), so it is never *also* a consolation entrant. In a size-8 draw round 2
 * **is** the semifinal, so a bye-holder losing there gets the third-place match, not the consolation; only a
 * larger draw (size ≥ 16, whose round 2 lies before the semifinal) folds a bye-holder's round-2 loss in.
 * Without this, a size-8 bye-holder semifinalist would land in both brackets at once (a scheduling conflict).
 *
 * Returned as registration ids in bracket order (round-1 losers top-to-bottom, then the round-2 bye-holder
 * losers); the caller re-sorts them into seeding order. Pure over one competition's `main` match set.
 */
export const consolationEntrants = (matches: readonly ConsolationMatch[]): number[] => {
  const holders = byeHolders(matches)
  // Round 2 lies before the semifinal only from size 16 up (depth ≥ 4); at size 8 (depth 3) round 2 is the
  // semifinal, so its losers belong to the third-place match, not the consolation.
  const roundTwoBeforeSemifinal = bracketDepth(matches) - 1 > 2
  const entrants: number[] = []
  // Round-1 contested losers (a bye has no loser — its holder advanced). For size ≥ 8 round 1 is never the
  // semifinal, so a round-1 loser is always a pre-semifinal first-match loss.
  for (const m of matches) {
    if (m.round === 1 && !m.thirdPlace) {
      const loser = loserOf(m, m.winnerRegId)
      if (loser !== null) entrants.push(loser)
    }
  }
  // Round-2 bye-holder losers — but only when round 2 is before the semifinal, so a size-8 bye-holder
  // semifinalist (bound for the third-place match) is never double-booked into the consolation.
  if (roundTwoBeforeSemifinal) {
    for (const m of matches) {
      if (m.round === 2 && !m.thirdPlace) {
        const loser = loserOf(m, m.winnerRegId)
        if (loser !== null && holders.has(loser)) entrants.push(loser)
      }
    }
  }
  return entrants
}

/**
 * Whether every player's **first match** in the main bracket is decided — the gate for drawing the
 * consolation bracket (CONTEXT: Consolation bracket, ADR-0004). A first match is a contested round-1
 * match for most players, or the round-2 match a round-1 bye-holder first plays. So the gate holds once
 * every contested round-1 match is decided *and* every round-2 match a bye-holder plays is decided (a
 * round-2 match between two round-1 winners is nobody's first match, so it never gates). Pure; the third-
 * place playoff (which shares the final's round) is skipped. Byes count as already decided (§32.4).
 */
export const firstMatchesDecided = (matches: readonly ConsolationMatch[]): boolean => {
  const holders = byeHolders(matches)
  for (const m of matches) {
    if (m.thirdPlace) continue
    if (m.round === 1) {
      const contested = m.slot1RegId !== null && m.slot2RegId !== null
      if (contested && m.winnerRegId === null) return false
    } else if (m.round === 2) {
      const involvesHolder =
        (m.slot1RegId !== null && holders.has(m.slot1RegId)) || (m.slot2RegId !== null && holders.has(m.slot2RegId))
      if (involvesHolder && m.winnerRegId === null) return false
    }
  }
  return true
}

// ── Consolation draw gate (CONTEXT: Consolation bracket, ADR-0004/0011) ──────────────────────────────
// Why the consolation bracket cannot be drawn yet. The single predicate the worker enforces (authority)
// and the competitions surface renders as the disabled „Nebenrunde auslosen" reason (affordance) — defined
// once so the two can never drift, exactly like `drawBlocker` for the main draw (ADR-0011). `null` = drawable.
export type ConsolationBlocker =
  'main-not-drawn' | 'no-consolation' | 'first-matches-pending' | 'too-few-entrants' | 'already-drawn'

// The operator-facing reason per blocker — one source for the server's 400/409 body and the button hint.
export const CONSOLATION_BLOCKER_REASON: Record<ConsolationBlocker, string> = {
  'main-not-drawn': 'Erst nach der Auslosung der Hauptrunde.',
  'no-consolation': 'Keine Nebenrunde bei einem 4er-Feld – das Spiel um Platz 3 ist die Nebenrunde.',
  'first-matches-pending': 'Erst wenn alle ersten Spiele entschieden sind.',
  'too-few-entrants': 'Zu wenige Verlierer der ersten Runde für eine Nebenrunde.',
  'already-drawn': 'Die Nebenrunde ist bereits ausgelost.'
}

// The main draw the gate reads: its `size` (does a consolation bracket exist for a field this size?) and
// its `matches` (are all first matches decided?). A structural subset of CompetitionDraw, so the client
// passes its held draw and the worker passes the assembled one — the same shape from both sides.
export interface ConsolationMainDraw {
  size: number
  matches: readonly ConsolationMatch[]
}

/**
 * The consolation draw gate: the first reason the consolation bracket cannot be drawn, or `null` when it
 * can (CONTEXT: Consolation bracket, ADR-0004). Ordered so the most fundamental reason wins — no main draw
 * yet, then no consolation at this size (a 4-field's third-place match is its consolation), then already
 * drawn (a re-run is refused, ADR-0026), then the first matches still being played, and finally too few
 * first-match losers to form a bracket. Mirrors the steps the consolation draw needs; the store-dependent
 * "already drawn" check is passed in (`consolationExists`) so this stays pure and the client can run it too
 * from the draws it already holds.
 */
export const consolationBlocker = (
  mainDraw: ConsolationMainDraw | null,
  consolationExists: boolean
): ConsolationBlocker | null => {
  if (!mainDraw) return 'main-not-drawn'
  if (!hasConsolationBracket(mainDraw.size)) return 'no-consolation'
  if (consolationExists) return 'already-drawn'
  if (!firstMatchesDecided(mainDraw.matches)) return 'first-matches-pending'
  // Every first match is decided, yet a small/bye-heavy field can leave fewer than two first-match losers
  // (e.g. a 5-player size-8 field: one round-1 loser, the other losers bye-holder semifinalists bound for
  // the third-place match) — too few to form a bracket, so the trigger stays disabled with an honest reason
  // rather than enabling a click that 400s. The client reads the same entrant set the worker draws from.
  if (consolationEntrants(mainDraw.matches).length < 2) return 'too-few-entrants'
  return null
}

// ── The consolation draw (CONTEXT: Draw procedure, ADR-0004) ─────────────────────────────────────────
// The bracket a consolation draw materializes: its size, the frozen seeding, and the KO match rows. No
// reveal sequence — the consolation is published directly, with no draw reveal show (ADR-0004), so the
// caller stores an empty sequence (the "no reveal" representation, which reads as fully revealed).
export interface ConsolationDraw {
  size: number
  seeding: SeedingEntry[]
  matches: MatchSlots[]
}

/**
 * Draw the consolation bracket for its seeded entrants (CONTEXT: Draw procedure, ADR-0004). `players` are
 * the lost-their-first-match set in seeding order (strongest first); randomness enters through the
 * injected `RandomSource`, so the same players + same source always yield the same bracket (the ADR-0010
 * port, deterministic in tests). Reuses the shared `drawBracket` — seeded by LK, with byes, unbiased —
 * then strips the third-place playoff `materializeMatches` appends (the consolation has none, ADR-0004).
 *
 * Two entrants is a special case: the shared draw supports sizes 4/8/16 only (a 2-draw has no seed table,
 * deliberately — the main draw's floor is 4, ADR-0034), yet a heavily-bye field can leave exactly two
 * first-match losers. With two players there is no lot to run — the stronger is seed 1 — so the single
 * final is built directly rather than forcing a size-2 seed table into the shared module. Throws below two
 * (no bracket to form); the gate guarantees ≥ 2 for a real size-≥ 8 field, so that is a defensive guard.
 */
export const drawConsolationBracket = (players: readonly DrawPlayer[], random: RandomSource): ConsolationDraw => {
  if (players.length < 2) throw new Error(`drawConsolationBracket: need at least 2 entrants, got ${players.length}`)
  if (players.length === 2) {
    const [a, b] = players
    return {
      size: 2,
      seeding: [
        { seed: 1, playerId: a.id, lk: a.lk },
        { seed: 2, playerId: b.id, lk: b.lk }
      ],
      matches: [
        {
          round: 1,
          position: 0,
          slot1RegId: a.id,
          slot2RegId: b.id,
          winnerRegId: null,
          outcome: null,
          thirdPlace: false
        }
      ]
    }
  }
  const size = drawSize(players.length)
  const { seeding, slots } = drawBracket({ players: [...players], size, random })
  return { size, seeding, matches: materializeMatches(size, slots).filter(m => !m.thirdPlace) }
}
