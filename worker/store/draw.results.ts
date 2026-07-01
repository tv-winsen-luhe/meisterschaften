import {
  type AdvanceableMatch,
  applyResult,
  type EnteredOutcome,
  type MatchOutcome,
  type MatchScore
} from '../../shared'
import type { MatchRow, NewMatchRow } from '../db/schema'

// The result-write helpers behind the draw Store's `recordResult` (#90): the score column ↔ wire mapping
// and the Advancement diff both adapters apply. Split from draw.ts so the store stays within the file
// budget, and so the two adapters (D1 + in-memory) share one definition of the row writes a result implies
// — they can never drift on the cascade. Depends only on the shared transform + the schema row types.

// A completed result to record (ADR-0032, ADR-0026): the resolved winner (the edge already mapped the
// winning slot to its registration id), the entered outcome (null = a normal scored result), and the set
// scores. The Store applies the pure Advancement transform from this and overlays the scores + `done`
// status onto the rows.
export interface RecordResultInput {
  winnerRegId: number
  outcome: EnteredOutcome | null
  score: MatchScore
}

// Read a set's `[slot1, slot2]` pair from its two columns: present only when both are written (they
// always travel together), else null (the set was not played). The narrow guard means a half-written set
// never surfaces as a bogus `[n, null]` pair.
export const toPair = (a: number | null, b: number | null): [number, number] | null =>
  a !== null && b !== null ? [a, b] : null

// Assemble a row's six score columns into the wire `MatchScore` (set1/set2/MTB × the two slots).
export const toScore = (row: MatchRow): MatchScore => ({
  set1: toPair(row.set1Slot1, row.set1Slot2),
  set2: toPair(row.set2Slot1, row.set2Slot2),
  mtb: toPair(row.mtbSlot1, row.mtbSlot2)
})

// The six score columns for a `MatchScore` — the inverse of `toScore`, for a write. A null set nulls both
// of its columns.
const scoreColumns = (score: MatchScore) => ({
  set1Slot1: score.set1?.[0] ?? null,
  set1Slot2: score.set1?.[1] ?? null,
  set2Slot1: score.set2?.[0] ?? null,
  set2Slot2: score.set2?.[1] ?? null,
  mtbSlot1: score.mtb?.[0] ?? null,
  mtbSlot2: score.mtb?.[1] ?? null
})

// All score columns nulled — what a cascade-cleared (un-resolved) match's score reverts to.
const NULL_SCORE_COLUMNS = scoreColumns({ set1: null, set2: null, mtb: null })

// The two columns one set's `[slot1, slot2]` score maps to, keyed by set index (1/2 = the two sets, 3 =
// the Match-Tie-Break); `null` clears the set back to unplayed. The single mapping both store adapters'
// `saveSet` writes through, so the D1 ternary and the in-memory mutation can never drift on which columns a
// set touches.
export const setColumns = (set: 1 | 2 | 3, score: readonly [number, number] | null): Partial<NewMatchRow> => {
  const a = score?.[0] ?? null
  const b = score?.[1] ?? null
  return set === 1
    ? { set1Slot1: a, set1Slot2: b }
    : set === 2
      ? { set2Slot1: a, set2Slot2: b }
      : { mtbSlot1: a, mtbSlot2: b }
}

// Project a stored row to the minimal topology shape `applyResult` reasons over (the text `outcome` column
// narrows to the domain enum). The transform reads/writes only these fields; the Store overlays scores +
// status onto the diff it returns.
const toAdvanceable = (row: MatchRow): AdvanceableMatch => ({
  id: row.id,
  competition: row.competition,
  bracket: row.bracket,
  round: row.round,
  position: row.position,
  slot1RegId: row.slot1RegId,
  slot2RegId: row.slot2RegId,
  winnerRegId: row.winnerRegId,
  outcome: row.outcome as MatchOutcome | null,
  thirdPlace: row.thirdPlace
})

// One row's computed update for a recorded result: the row id and the columns to write. Named (the lint
// rule forbids the inline `{…}[]` return type).
interface RowPatch {
  id: number
  patch: Partial<NewMatchRow>
}

// Compute the row writes a recorded result implies, shared by both adapters so the D1 batch and the
// in-memory mutation apply identical changes. The target row gets the winner + outcome + scores + `done`
// status; the pure Advancement diff (`applyResult`) yields the rest — every **downstream row the change
// touched** (a slot refilled, or a result undone) is reset to a clean `planned` match: its slots updated,
// and its winner/outcome/score/live-court/status wiped. That full reset matters not just for an already-
// `done` row but for a `running` one too — a refilled slot invalidates whatever was live on it (the court,
// a saved set), so leaving those would misattribute them to the swapped-in player. The target patch is
// emitted first, so the list is always non-empty (the D1 batch needs a non-empty tuple) and the winner
// write never races a slot-fill on the same row.
export const resultPatches = (rows: MatchRow[], targetId: number, input: RecordResultInput): RowPatch[] => {
  const before = rows.map(toAdvanceable)
  const beforeById = new Map(before.map(m => [m.id, m]))
  const after = applyResult(before, targetId, { winnerRegId: input.winnerRegId, outcome: input.outcome })

  const patches: RowPatch[] = [
    {
      id: targetId,
      patch: { winnerRegId: input.winnerRegId, outcome: input.outcome, status: 'done', ...scoreColumns(input.score) }
    }
  ]
  for (const n of after) {
    if (n.id === targetId) continue
    const b = beforeById.get(n.id)!
    const slotsChanged = n.slot1RegId !== b.slot1RegId || n.slot2RegId !== b.slot2RegId
    const cleared = n.winnerRegId === null && b.winnerRegId !== null
    if (!slotsChanged && !cleared) continue
    // A touched downstream row is reset to a clean planned match. For a forward fill (an empty slot gaining
    // the advancing player) every reset field is already at its default, so this is a no-op beyond the slot;
    // for a refilled `running`/`done` row it wipes the now-invalid winner, score, live court, and status.
    patches.push({
      id: n.id,
      patch: {
        slot1RegId: n.slot1RegId,
        slot2RegId: n.slot2RegId,
        winnerRegId: null,
        outcome: null,
        status: 'planned',
        liveCourt: null,
        ...NULL_SCORE_COLUMNS
      }
    })
  }
  return patches
}
