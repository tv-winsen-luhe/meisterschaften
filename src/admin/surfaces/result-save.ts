import type { EnteredOutcome, MatchScore, MatchStatus } from '../../../shared'
import { checkNormalScore } from '../../../shared'

// The result drawer's two save paths (ADR-0032, Amendment 2026-08-20), as pure rules the component reads.
// A drawer full of typed numbers either ends the match (the /result write, which advances the bracket) or
// records a **Zwischenstand** — a completed set of a match still on court, posted one set at a time to
// /api/admin/match/set. Kept out of the .tsx so the decision „which path is this" is testable without a DOM,
// the same split the other surfaces keep (auto-advance.ts, confirm-preview.ts).

// One set's write: the set index (3 = the Match-Tie-Break), and its score — `null` clears it back to
// unplayed, which is how a mistyped set is corrected (empty the fields and save).
export interface SetWrite {
  set: 1 | 2 | 3
  score: [number, number] | null
}

/**
 * Whether the drawer offers „Zwischenstand speichern" instead of the result save. Exactly the state where a
 * result cannot be saved yet *because it is not decisive*: a normal outcome (a Walkover/Aufgabe is an ending,
 * not an interim state) on a **running** match whose score is legal but names no winner yet.
 *
 * `running` only, and by design: a `planned` match is started with „Läuft" first, because that transition
 * carries the actual court which only the operator knows — deriving a start from a typed number would point
 * spectators at the planned court. A `done` match is corrected through /result as before. An **illegal**
 * score is not offered either: `checkNormalScore` judges illegality before completeness, so the flagged row
 * still blocks both paths.
 */
export const offersPartialSave = (status: MatchStatus, outcome: EnteredOutcome | null, score: MatchScore): boolean => {
  if (status !== 'running' || outcome !== null) return false
  const check = checkNormalScore(score)
  return !check.ok && check.reason === 'incomplete'
}

const samePair = (a: readonly [number, number] | null, b: readonly [number, number] | null): boolean =>
  a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1]

/**
 * The set writes a Zwischenstand save has to post: one per set whose score differs from what is recorded, in
 * set order, at most three. Only what changed — there is no batch endpoint for three integer pairs
 * (ADR-0021), so an untouched set costs no request. An empty list means there is nothing to save.
 *
 * `mtbInPlay` is whether the drawer is *showing* the Match-Tie-Break row (it shows only at 1:1). Without it
 * the MTB would be written whenever its row is hidden, because a hidden row reads as an empty score: an
 * operator clearing set 2 to retype a digit would silently wipe a recorded MTB along with it. A set the
 * operator cannot currently see is a set they did not change.
 */
export const changedSets = (recorded: MatchScore, entered: MatchScore, mtbInPlay: boolean): SetWrite[] => {
  const writes: SetWrite[] = []
  if (!samePair(recorded.set1, entered.set1)) writes.push({ set: 1, score: entered.set1 })
  if (!samePair(recorded.set2, entered.set2)) writes.push({ set: 2, score: entered.set2 })
  if (mtbInPlay && !samePair(recorded.mtb, entered.mtb)) writes.push({ set: 3, score: entered.mtb })
  return writes
}
