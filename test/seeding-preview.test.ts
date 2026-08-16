import { describe, expect, it } from 'vitest'
import type { AdminRegistration, CompetitionSlug, RegistrationStatus } from '../shared'
import { seedingFieldPreview } from '../src/admin/surfaces/seeding-preview'

// seedingFieldPreview is the provisional seeding list's per-field derivation (CONTEXT: Field cut,
// ADR-0043/0047), kept a pure function separate from the surface so it is tested in isolation rather
// than through rendered React — the same discipline as confirm-preview.
//
// The distinction it owns: the **list** shows the active field (new + confirmed), because the cut is
// planning and an unconfirmed entry still occupies a spot; the **seeds** preview the actual draw,
// which runs on the confirmed entries alone. Conflating the two made the header read one number while
// every other admin surface read another, and sized the preview's bracket off a field the draw would
// never produce.
const reg = (over: Partial<AdminRegistration> = {}): AdminRegistration => ({
  id: 1,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: null,
  competition: 'mens-challenger' as CompetitionSlug,
  firstName: 'Max',
  lastName: 'Muster',
  club: 'TV Winsen',
  email: 'max@example.com',
  phone: null,
  note: null,
  status: 'confirmed' as RegistrationStatus,
  playerId: null,
  lk: '22.0',
  ...over
})

// The prod field from the report: eight confirmed Challenger entries plus one still-unconfirmed row
// that carries no LK yet.
const challengerField = (): AdminRegistration[] => [
  ...['20.9', '21.4', '21.8', '22.2', '22.7', '24.0', '24.5', '25.0'].map((lk, i) =>
    reg({ id: i + 1, lk, createdAt: `2026-06-0${i + 1}T10:00:00.000Z` })
  ),
  reg({ id: 9, status: 'new', lk: null, createdAt: '2026-06-25T18:07:00.000Z' })
]

describe('seedingFieldPreview', () => {
  it('reports the active, confirmed and pending counts separately (the 9-vs-8 report)', () => {
    const field = seedingFieldPreview(challengerField(), 'mens-challenger', 16)

    expect(field.active).toBe(9) // the list: everyone still in, confirmed or not
    expect(field.confirmed).toBe(8) // what the Konkurrenzen card and the draw see
    expect(field.pending).toBe(1)
    expect(field.rows).toHaveLength(9)
  })

  it('sizes the seed count off the confirmed field, not the unconfirmed surplus', () => {
    const field = seedingFieldPreview(challengerField(), 'mens-challenger', 16)

    // Eight confirmed → an 8-draw → 2 seeds (§30.5a). Counting the ninth, unconfirmed row pushed the
    // preview to a 16-draw with 4 seeds — a bracket the draw would not produce.
    expect(field.seedCount).toBe(2)
    expect(field.rows.filter(r => r.seed !== null)).toHaveLength(2)
  })

  it('never puts a seed on an unconfirmed row — the draw would not seed it', () => {
    // The pending row is the LK-strongest of the field, so a seed order over the active set would
    // hand it Nr. 1.
    const { rows } = seedingFieldPreview(
      [
        ...challengerField().slice(0, 8),
        reg({ id: 9, status: 'new', lk: '20.1', createdAt: '2026-06-25T18:07:00.000Z' })
      ],
      'mens-challenger',
      16
    )

    expect(rows.find(r => r.reg.id === 9)?.seed).toBeNull()
    expect(rows.find(r => r.seed === 1)?.reg.lk).toBe('20.9') // the strongest *confirmed* entry
  })

  it('keeps the cut over the active field — an unconfirmed entry still occupies a spot', () => {
    const field = seedingFieldPreview(challengerField(), 'mens-challenger', 8)

    expect(field.inField).toBe(8)
    expect(field.reserves).toBe(1)
    expect(field.provisional).toBe(false) // a Challenger cut is fix (registration order never drifts)
  })

  it('ignores cancelled rows entirely', () => {
    const field = seedingFieldPreview(
      [...challengerField(), reg({ id: 10, status: 'cancelled' })],
      'mens-challenger',
      16
    )

    expect(field.active).toBe(9)
    expect(field.rows).toHaveLength(9)
  })

  it('flags too-strong Challenger entries against the cap', () => {
    const field = seedingFieldPreview([...challengerField(), reg({ id: 10, lk: '12.0' })], 'mens-challenger', 16)

    expect(field.tooStrongCount).toBe(1)
    expect(field.rows.find(r => r.reg.id === 10)?.tooStrong).toBe(true)
  })
})
