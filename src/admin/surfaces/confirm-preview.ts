import {
  canConfirmEntry,
  DEFAULT_LK,
  isCompletePlayerId,
  isTooStrongForChallenger,
  resolveSeedingBasis,
  type AdminRegistration,
  type CompetitionSlug
} from '../../../shared'

// The admin panel's confirm prediction (ADR-0011, ADR-0020): given a row and the operator's live
// edits, what would a confirm result in? Kept a pure function separate from the surface so the
// derivation is tested in isolation, not through rendered React — the same discipline as
// auto-advance / registration-sort. It composes the shared seeding primitives (resolveSeedingBasis,
// canConfirmEntry, isTooStrongForChallenger) so the card and the domain authority read one rule.
//
// It is a PREDICTION, not the server contract: the LK is server-authored (the edge fetches it from
// nuLiga after confirm), so this only forecasts the badge the operator is about to get. The badge
// previews the RESULT of the current edits, not the stored state — a half-typed id reads as unknown
// ("—") rather than flashing the row's stale rating.

// The live panel state the preview reads. A subset of the panel's edit state — club does not affect
// the prediction. Deliberately NOT `ConfirmEdits`: the domain owns that name with a different shape
// (it carries club); this is the in-progress draft being previewed.
export interface ConfirmDraft {
  playerId: string
  noId: boolean
  competition: CompetitionSlug
}

// The LK a confirm would result in, as the panel badges it. Three honest states replace the old
// lkValue / lkPending / lkFromNuliga boolean tangle:
//   - known   the rating is settled: the no-id default (Standard) or a matched nuLiga rating
//   - pending  a complete id is entered but its rating is not on hand — the edge will fetch it
//   - unknown  no rating to forecast: no-id off with an empty or incomplete id → "—"
export type LkPreview =
  { state: 'known'; lk: string; source: 'nuliga' | 'default' } | { state: 'pending' } | { state: 'unknown' }

// The Challenger judgment + the LK it judged (for the dialog title). Reads the LK preview: it can
// only judge a known rating, and defers (tooStrong: false) while pending or unknown.
export interface ChallengerJudgment {
  tooStrong: boolean
  judgedLk: string | null
}

export interface ConfirmPreview {
  lk: LkPreview
  // The shared confirmability authority, surfaced so the panel makes one call. The domain enforces
  // the same canConfirmEntry independently (it is the authority); this only mirrors it for affordance.
  confirmable: true | string
  challenger: ChallengerJudgment
  // The id the confirm payload sends (trimmed; '' under no-id) — so the panel does not re-derive it.
  playerId: string
}

export const confirmPreview = (reg: AdminRegistration, draft: ConfirmDraft): ConfirmPreview => {
  const basis = resolveSeedingBasis({ playerId: draft.playerId, noId: draft.noId })
  // The normalized (trimmed, empty→'') id, derived once — resolveSeedingBasis already owns the trim.
  const id = basis.playerId ?? ''

  const lk = previewLk(reg, draft, id)
  const judgedLk = lk.state === 'known' ? lk.lk : null

  return {
    lk,
    confirmable: canConfirmEntry(basis, draft.competition),
    // isTooStrongForChallenger returns false for a null lk, so no separate null guard is needed.
    challenger: { judgedLk, tooStrong: isTooStrongForChallenger(draft.competition, judgedLk) },
    playerId: id
  }
}

// The LK badge state machine. Order matters: no-id wins (the explicit default), then a typed id that
// matches the stored linkage shows its known rating, then a complete id with no rating on hand is
// pending, and anything else (incomplete or empty id, no-id off) has no result to forecast.
const previewLk = (reg: AdminRegistration, draft: ConfirmDraft, id: string): LkPreview => {
  if (draft.noId) return { state: 'known', lk: DEFAULT_LK, source: 'default' }
  if (id === reg.playerId && reg.lk) return { state: 'known', lk: reg.lk, source: 'nuliga' }
  if (isCompletePlayerId(id)) return { state: 'pending' }
  return { state: 'unknown' }
}
