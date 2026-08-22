import type { MatchScore } from './admin'
import type { EnteredOutcome } from './draw'
import { slotGames } from './schedule'

// The match score rules (CONTEXT: Legal score, ADR-0045). Winsen plays two sets + a Match-Tie-Break to 10
// as the third set (never a full third set — DTB §37.1), so the legal score space is *closed*: an illegal
// score is impossible, not merely unwise, and is hard-blocked. These pure predicates are that one
// definition — the server's authority (the result schema's refine) and the drawer's affordance
// (ADR-0011/0022/0033). They read plain `[slot1, slot2]` pairs, order-independent (either player may be
// slot 1).

// A single score entry — a set's games or the MTB's points — is a small non-negative integer. The bound
// mirrors the store columns / the `setScore` wire tuple and is loose on purpose (a set caps near 7, an MTB
// near the high teens): a typo guard, not a scoring rule. Owned here so the predicates and the schema reject
// the same out-of-range values — without this the client gate would pass a `6:-2` or a `100`-point MTB that
// the server 400s, re-opening the very save trap this closes (ADR-0045).
export const SCORE_POINT_MAX = 99
const isScorePoint = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= SCORE_POINT_MAX

// One set's games pair is legal iff both entries are in range and it is `6:0…6:4`, `7:5`, or `7:6` — no
// advantage sets (the tiebreak decides 6:6, so 7:6 is the ceiling), never a tie.
export const legalSet = (pair: readonly [number, number]): boolean => {
  if (!isScorePoint(pair[0]) || !isScorePoint(pair[1])) return false
  const hi = Math.max(pair[0], pair[1])
  const lo = Math.min(pair[0], pair[1])
  if (hi === lo) return false
  if (hi === 6) return lo <= 4
  if (hi === 7) return lo === 5 || lo === 6
  return false
}

// The Match-Tie-Break points pair is legal iff the winner reached 10 with a two-point margin, open-ended:
// `10:0…10:8`, then `11:9`, `12:10`, … (past 10 the game ends the moment the lead hits 2, so the margin
// is exactly 2). No 10:9 (one-point lead), nothing under 10.
export const legalMtb = (pair: readonly [number, number]): boolean => {
  if (!isScorePoint(pair[0]) || !isScorePoint(pair[1])) return false
  const hi = Math.max(pair[0], pair[1])
  const lo = Math.min(pair[0], pair[1])
  if (hi < 10) return false
  if (hi === 10) return lo <= 8
  return lo === hi - 2
}

// The winning slot of one played pair (higher value), or null when blank/tied. The atom the checks read.
const pairWinner = (pair: readonly [number, number]): 1 | 2 | null =>
  pair[0] > pair[1] ? 1 : pair[1] > pair[0] ? 2 : null

// The verdict on a *normal* result's score: `ok` with the winner it decides, or a rejection distinguishing
// `incomplete` (not yet decisive — fill in more) from `illegal` (an impossible score). The one authority
// the result schema refines against and the drawer reads for its Save gate, its read-only winner, and its
// disabled reason (ADR-0045). A filled-but-illegal set is judged illegal **before** completeness, so the
// footer reason matches the row flag the drawer shows for the same set.
export type NormalScoreCheck = { ok: true; winner: 1 | 2 } | { ok: false; reason: 'incomplete' | 'illegal' }

export const checkNormalScore = (score: MatchScore): NormalScoreCheck => {
  const { set1, set2, mtb } = score
  if (set1 !== null && !legalSet(set1)) return { ok: false, reason: 'illegal' }
  if (set2 !== null && !legalSet(set2)) return { ok: false, reason: 'illegal' }
  if (set1 === null || set2 === null) return { ok: false, reason: 'incomplete' }
  // Both sets are legal here, and a legal set is never a tie, so both winners resolve.
  const w1 = pairWinner(set1) as 1 | 2
  const w2 = pairWinner(set2) as 1 | 2
  if (w1 === w2) {
    // Two sets to one player — an MTB was not played, so any MTB value is a contradiction.
    return mtb === null ? { ok: true, winner: w1 } : { ok: false, reason: 'illegal' }
  }
  // A 1:1 split is decided by the MTB.
  if (mtb === null) return { ok: false, reason: 'incomplete' }
  if (!legalMtb(mtb)) return { ok: false, reason: 'illegal' }
  return { ok: true, winner: pairWinner(mtb) as 1 | 2 }
}

// Whether a match-result request's (outcome, score, winner) triple is valid — the first violation, or null.
// The outcome trichotomy (ADR-0045): a **walkover** carries no score; a **retirement** is exempt (its score
// is legitimately partial, the winner explicit); a **normal** result must be legal, decisive, and its winner
// must match the score. One definition — the result schema's authority (server) and the drawer's affordance.
export type ResultScoreError = 'walkover-has-score' | 'normal-incomplete' | 'normal-illegal' | 'winner-mismatch'

export const resultScoreError = (
  outcome: EnteredOutcome | null,
  score: MatchScore,
  winner: 1 | 2
): ResultScoreError | null => {
  if (outcome === 'walkover') {
    return score.set1 !== null || score.set2 !== null || score.mtb !== null ? 'walkover-has-score' : null
  }
  if (outcome === 'retirement') return null
  const check = checkNormalScore(score)
  if (!check.ok) return check.reason === 'incomplete' ? 'normal-incomplete' : 'normal-illegal'
  return check.winner === winner ? null : 'winner-mismatch'
}

// The German message each violation surfaces — the schema refine attaches it (server 400), the drawer can
// read the same map for its inline reason. Shared so the two never drift (ADR-0045).
export const RESULT_SCORE_ERROR_MESSAGE: Record<ResultScoreError, string> = {
  'walkover-has-score': 'Ein Walkover wird ohne Satzergebnis gespeichert.',
  'normal-incomplete': 'Ergebnis unvollständig – der Sieger steht noch nicht fest.',
  'normal-illegal': 'Ungültiges Satzergebnis.',
  'winner-mismatch': 'Der Sieger passt nicht zum eingetragenen Ergebnis.'
}

// U+2007 FIGURE SPACE — a blank exactly as wide as a digit in a tabular font. Every surface that prints a
// score line sets `font-variant-numeric: tabular-nums`, so this is what lets a one-digit entry hold a
// two-digit entry's column without any surface knowing.
const FIGURE_SPACE = '\u2007'

// The width every entry is padded to. Two, because that is the whole legal score space: a set caps at 7 and
// an MTB at two digits (`SCORE_POINT_MAX` is 99, and past 10 the margin is exactly 2), so no entry can
// outgrow the column this reserves.
const ENTRY_WIDTH = 2

/**
 * One slot's score as the line a reader sees — e.g. „6  3 10", or „" when nothing is recorded. The **one**
 * score formatter: the admin results list, the public schedule and the public bracket all print this string,
 * so they cannot disagree about separators the way the two inline joins it replaced did (#305).
 *
 * A leaf on top of `slotGames`, which stays the single „which games" rule (ADR-0045) — this adds only the
 * separator and the column. So an unplayed match and a walkover render empty (no trailing numbers to
 * explain), and a match still on court renders just the sets already saved (ADR-0032 §20).
 *
 * Each entry is padded to a digit-wide column, which is what makes the two contestant lines **line up**.
 * All three surfaces print this line right-aligned, and right alignment lines up the line's *end*, not its
 * sets: a Match-Tie-Break is two digits on the winner's line („6 3 10") and one on the loser's („4 6 8"),
 * so without the padding the loser's whole line slid a character along and no set sat under its own set.
 * The alignment rule belongs *here*, beside the separator, for the same reason the separator does — it is
 * one rule, and three stylesheets each solving it is three chances to disagree.
 *
 * The pad rides **behind** the entry, not in front of it: a column's numbers then line up on their left
 * edge and the second digit of a „10" overhangs to the right, which is how a tennis reader scans a tie-break
 * („10" over „8", the 1 above the 8). Padding in front would right-align inside the column instead and read
 * as a gap punched into the middle of the shorter line. The pad on the *last* entry is what keeps both lines
 * the same length, and equal length is what stops the shared right alignment from shifting one of them —
 * so it is load-bearing rather than trailing noise.
 */
export const scoreLine = (score: MatchScore, slot: 1 | 2): string =>
  slotGames(score, slot)
    .map(games => String(games).padEnd(ENTRY_WIDTH, FIGURE_SPACE))
    .join(' ')
