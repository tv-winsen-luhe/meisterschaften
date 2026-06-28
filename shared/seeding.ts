import { CHALLENGER_MIN_LK, DEFAULT_LK } from './constants'

// Seeding & Challenger eligibility — the "how strong is this entry, and is it eligible for the
// protected field?" rules, owned in one place (ADR-0011: definition once). Split out of the
// registration wire contract (shared/registration.ts): that module owns the form schema and the
// status lifecycle; this one owns the LK-driven ordering and the Challenger cap. Confirmability
// (canConfirm / resolveSeedingBasis) stays with registration — it gates the confirm transition,
// not the seeding order. The draw guard, the seeding preview, and the admin all import from here.

// The number a row is seeded by: its LK parsed, with no resolvable rating ⇒ DEFAULT_LK. The LK scale
// runs 1.0 (strongest) to 25.0 (weakest), so ordering ascending by this puts the strongest first; a
// missing or unratable LK therefore seeds as the weakest (25.0), never the strongest. Owns the
// "string LK → sort number" rule once (CONTEXT: seedingValue) so the participant list and the future
// seeding share one encoding — replacing the SQL CAST / in-memory parseFloat pair a comment kept in
// sync. (LK stays a string on the row; this is the conversion at the sort boundary, ADR-0021.)
export const seedingValue = (lk: string | null): number => {
  const n = parseFloat(lk ?? DEFAULT_LK)
  return Number.isNaN(n) ? Number(DEFAULT_LK) : n
}

// The single-entry Challenger judgment: is this LK too strong for a field capped at `threshold`?
// The LK scale runs 1.0 (strongest) … 25.0 (weakest), so "too strong" is a value *below* the cap.
// Goes through seedingValue, so a missing or unratable LK seeds at DEFAULT_LK (the weakest) and is
// never too strong (glossary: no LK ⇒ counts as 25.0). The core both judgments below share, so the
// "stronger than the cap" rule lives in exactly one place (ADR-0011: definition once).
const isLkTooStrongForChallenger = (lk: string | null, threshold: number): boolean => seedingValue(lk) < threshold

// Which competitions are protected Challenger fields. Owned once (ADR-0011) so the confirm-time hint,
// the seeding affordance, and the draw cap guard never drift on "is this a Challenger field?". Matches
// the `-challenger` family by slug, so a second recreational field (the planned „Damen Freizeit",
// `womens-challenger`) is cap-gated the moment it becomes registerable — fail-closed for a protected
// field, rather than silently bypassing the cap until someone remembers to add it here.
export const isChallengerField = (competition: string): boolean => competition.endsWith('-challenger')

// The Challenger-LK judgment at confirm time, owned once in shared/ (ADR-0011) so the registration
// notifier, the domain, and the admin affordance all read the same rule — no duplicated threshold.
// Gated to the Challenger field and the fixed CHALLENGER_MIN_LK: a stronger entry raises the soft
// confirm-time hint (ADR-0024 — the cap only binds hard at the draw), nudging toward the
// championship field.
export const isTooStrongForChallenger = (competition: string, lk: string | null): boolean =>
  isChallengerField(competition) && isLkTooStrongForChallenger(lk, CHALLENGER_MIN_LK)

// One entry the Challenger eligibility check judges — by LK alone (a structural subset of a
// registration / a seeding row), kept generic so both consumers pass their own richer rows through.
export interface ChallengerEntry {
  lk: string | null
}

// The result of judging a Challenger field: whether it may be drawn, and which entries are too
// strong (in input order) — so the caller can both gate and point at the offenders.
export interface ChallengerEligibilityResult<E extends ChallengerEntry> {
  eligible: boolean
  tooStrong: E[]
}

// The field-level Challenger judgment, owned once in shared/ (ADR-0011): given a Challenger field's
// `entries` and a `threshold`, which entries are too strong for the cap, and is the field therefore
// drawable. This is the **authority** the draw guard reuses (Slice 7) — a too-strong entry blocks
// the field's draw on the frozen LKs (ADR-0024) — and the **affordance** the provisional seeding
// list renders to mark too-strong entries before the draw. Pure and threshold-parameterised (the
// draw will pass the operator-tuned `CHALLENGER_MIN_LK`); it does not gate on competition — the
// caller already holds the Challenger field's entries.
export const challengerEligibility = <E extends ChallengerEntry>(
  entries: readonly E[],
  threshold: number
): ChallengerEligibilityResult<E> => {
  const tooStrong = entries.filter(e => isLkTooStrongForChallenger(e.lk, threshold))
  return { eligible: tooStrong.length === 0, tooStrong }
}
