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
// the `-challenger` family by slug, so any future recreational field is cap-gated the moment it becomes
// registerable — fail-closed for a protected field, rather than silently bypassing the cap until
// someone remembers to add it here.
export const isChallengerField = (competition: string): boolean => competition.endsWith('-challenger')

// Which competitions are unseeded — the Social mixer (CONTEXT: Social mixer, ADR-0051). Matches the
// `-social` family by slug, mirroring isChallengerField's `-challenger`, so a second social field is
// recognised the moment it exists. An unseeded field carries no LK and is never seeded, cut by
// strength, or drawn: seedability is a property of the competition, not of every registration. The
// confirm relaxation (canConfirmEntry), the cut order below, the seed-rank suppression on the public
// list, and the draw guard all read this one predicate.
export const isUnseededCompetition = (competition: string): boolean => competition.endsWith('-social')

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

// ── The one order: seeding, cut, list (CONTEXT: Seeding / Field cut / Reserve, ADR-0065, ADR-0047) ─
// **One comparator orders every field**: strongest first by LK, registration time breaking ties only
// among equal LKs. It is the order the draw seeds on (worker confirmedForDraw / drawBracket), the order
// the cut admits by, and the order the public list and the operator Setzliste display — on all four
// competitions, the protected Challenger included (ADR-0065 superseded the per-field-type cut of
// ADR-0043; `cutsByStrength` and `compareForCut` are gone with it). Owned here (ADR-0011: definition
// once) so no surface can drift from the draw — the class of defect ADR-0047 fixed.

// One entry the order reads: a structural subset of a registration (lk + createdAt), generic so every
// consumer passes its own richer rows through.
export interface FieldCutEntry {
  lk: string | null
  createdAt: string
}

// The comparator: `seedingValue` ascending (the LK scale runs 1.0 strongest … 25.0 weakest, so ascending
// is strongest first), then `createdAt` as the **tie-break only**. The tie-break is load-bearing, not
// decorative: equal LKs are common at this scale (ADR-0021) and `drawBracket` verifies a non-decreasing
// seeding order, so the sort must be deterministic — but registration time decides nothing about strength.
// `createdAt` is a sortable string (the same `localeCompare` the queue sort uses), so it needs no parsing.
export const bySeedingLk = (a: FieldCutEntry, b: FieldCutEntry): number =>
  seedingValue(a.lk) - seedingValue(b.lk) || a.createdAt.localeCompare(b.createdAt)

// Which of a field's entries have **no resolved LK** — `lk` still null, because the nuLiga match has not
// landed yet or a lookup failed (resolveLkOnConfirm is best-effort: no rating, no id, or an outage all
// write nothing). Confirming needs a *seeding basis*, not an LK (canConfirm), so a confirmed row can sit
// here. Since ADR-0065 the cut admits by LK, and `seedingValue(null)` ⇒ 25.0 would make a missing rating
// admission-deciding — so the draw refuses a seeded field holding one (worker/draw.ts) rather than
// silently cutting it as the weakest. The provisional cut still shows it at 25.0; only the freeze blocks.
export const unresolvedLkEntries = <E extends ChallengerEntry>(entries: readonly E[]): E[] =>
  entries.filter(e => e.lk === null)

// The provisional seed ranks for a field's entries (ADR-0047): rank them strongest-first by LK
// (bySeedingLk) and hand ranks 1..`seedCount` to the top. `seedCount` is the caller's — a surface passes
// the DTB seed count for the field's draw size, or 0 below the draw floor. Returns a Map from each seeded
// entry to its 1-based seed number; unseeded entries are absent (the caller reads `null`). Pure: it copies
// before sorting, so the caller keeps its own display order (registration date for a Challenger list)
// while its seeds are still the LK-strongest — the whole point of ADR-0047.
export const provisionalSeedRanks = <E extends FieldCutEntry>(
  entries: readonly E[],
  seedCount: number
): Map<E, number> => {
  const ranked = [...entries].sort(bySeedingLk)
  const ranks = new Map<E, number>()
  for (let i = 0; i < seedCount && i < ranked.length; i++) ranks.set(ranked[i], i + 1)
  return ranks
}

// One ranked entry: its 1-based position in the cut order and whether it falls below the cut (a
// reserve — still `confirmed`, simply not drawn; CONTEXT: Reserve).
export interface RankedCutEntry<E> {
  entry: E
  position: number
  reserve: boolean
}

// The result of cutting a field: the active entries in cut order with their reserve flag, and the counts
// either side of the line. **Every** cut is provisional — it acts on LKs that drift until the seeding
// freeze (ADR-0024), so the line moves as LKs sync and no spot is secure until the draw. That used to be
// a per-field-type `provisional` flag; since one comparator cuts every field it is constantly true, and a
// flag that is never false is not information (ADR-0065).
export interface FieldCutResult<E> {
  ranked: RankedCutEntry<E>[]
  inField: number
  reserves: number
}

// Cut a field's `entries` (its **active** rows — new + confirmed) at `capacity`: order them by the one
// comparator (bySeedingLk), then mark everything from index `capacity` on as a reserve. The cut decides
// *who is in*, the seeding decides *where* — and since ADR-0065 both read the same order. Takes no
// competition: there is no per-field-type rule left. Pure: it copies before sorting, so the caller's
// array is left untouched.
export const fieldCut = <E extends FieldCutEntry>(entries: readonly E[], capacity: number): FieldCutResult<E> => {
  const ranked = [...entries].sort(bySeedingLk).map((entry, i) => ({ entry, position: i + 1, reserve: i >= capacity }))
  const inField = Math.min(ranked.length, capacity)
  return { ranked, inField, reserves: ranked.length - inField }
}
