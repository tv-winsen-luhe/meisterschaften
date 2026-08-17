import {
  bracketStructure,
  CHALLENGER_MIN_LK,
  challengerEligibility,
  drawSize,
  fieldCut,
  isActive,
  isChallengerField,
  isSupportedDrawSize,
  provisionalSeedRanks,
  type AdminRegistration
} from '../../../shared'

// The provisional seeding list's per-field derivation (CONTEXT: Field cut, ADR-0065/0047), kept a pure
// function separate from the surface so the rules are tested in isolation rather than through rendered
// React — the same discipline as confirm-preview.
//
// It holds one distinction the surface used to blur, because the two answers come from two different
// populations:
//   • the **list and the cut** run over the *active* field (new + confirmed): a spot is occupied the
//     moment someone registers, so planning who is in and who is a reserve cannot wait on a confirm.
//   • the **seeds** preview the *draw*, and the draw runs on the **confirmed** entries alone
//     (competitions-surface / drawBlocker). Sizing them off the active field previewed a bracket the
//     draw would not produce — one unconfirmed row turned 8 confirmed into a 16-draw with 4 seeds
//     instead of an 8-draw with 2 — and could hand seed Nr. 1 to someone who is not in the draw at all.
// The counts are reported separately (active / confirmed / pending) so the header can say which is
// which, instead of showing a number no other admin surface agrees with.

// One row of the provisional seeding: the registration, its position in the cut order (1-based), its
// seed number if it is a drawn seed (DTB §30.5a — null when unseeded or unconfirmed; since ADR-0065 the
// cut order is the seeding order, so a seed's position matches its rank), whether it falls below the cut,
// and — for the Challenger field — whether its LK is too strong for the cap.
export interface SeedingRow {
  reg: AdminRegistration
  position: number
  seed: number | null
  reserve: boolean
  tooStrong: boolean
}

export interface SeedingFieldPreview {
  rows: SeedingRow[]
  // The three populations the operator needs to tell apart: everyone still in (the list), the subset the
  // draw would take, and the difference — the rows still awaiting a confirm.
  active: number
  confirmed: number
  pending: number
  inField: number
  reserves: number
  seedCount: number
  tooStrongCount: number
}

// Derive one competition's provisional seeding from the admin list: the active rows in cut order with
// the cut drawn at `capacity`, the seed numbers the draw would hand out, and the Challenger cap flags.
// Pure — pass a field's capacity in; the surface owns the content-model lookup.
export const seedingFieldPreview = (
  registrations: readonly AdminRegistration[],
  slug: string,
  capacity: number | undefined
): SeedingFieldPreview => {
  // The cut ranks the active field (new + confirmed); a `new` row already carries a derived LK when
  // matchOnRegister found it a nuLiga match at signup.
  const active = registrations.filter(r => r.competition === slug && isActive(r.status))
  // A field with no capacity (a planned field, not registerable today) gets no cut — pass the full
  // count as the cap so nothing is a reserve. The three live fields all carry a capacity.
  const cut = fieldCut(active, capacity ?? active.length)
  const inFieldEntries = cut.ranked.filter(r => !r.reserve).map(r => r.entry)
  // Seeds preview the *drawn* field, which is the confirmed one: the DTB seed count for the draw size
  // that many entries produce, and only for the supported sizes (4/8/16) — bracketStructure throws
  // otherwise. Ranked by LK for **every** field (provisionalSeedRanks, ADR-0047); the ranks are still
  // *computed*, never read off the row position, even though the two orders now coincide (ADR-0065).
  const confirmedInField = inFieldEntries.filter(r => r.status === 'confirmed')
  const size = drawSize(confirmedInField.length)
  const seedCount = isSupportedDrawSize(size) ? bracketStructure(size).seedCount : 0
  const seedRankOf = provisionalSeedRanks(confirmedInField, seedCount)
  // The Challenger field is judged against the current cap (over the active set); other fields have
  // none, so the too-strong set stays empty.
  const tooStrong = isChallengerField(slug) ? challengerEligibility(active, CHALLENGER_MIN_LK).tooStrong : []
  const tooStrongIds = new Set(tooStrong.map(r => r.id))
  const rows: SeedingRow[] = cut.ranked.map(({ entry, position, reserve }) => ({
    reg: entry,
    position,
    seed: reserve ? null : (seedRankOf.get(entry) ?? null),
    reserve,
    tooStrong: tooStrongIds.has(entry.id)
  }))
  const confirmed = active.filter(r => r.status === 'confirmed').length
  return {
    rows,
    active: active.length,
    confirmed,
    pending: active.length - confirmed,
    inField: cut.inField,
    reserves: cut.reserves,
    seedCount,
    tooStrongCount: tooStrong.length
  }
}
