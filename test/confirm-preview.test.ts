import { describe, expect, it } from 'vitest'
import type { AdminRegistration, CompetitionSlug } from '../shared'
import { confirmPreview, type ConfirmDraft } from '../src/admin/surfaces/confirm-preview'

// confirmPreview is the admin panel's confirm prediction, kept a pure function separate from the
// surface so it is tested in isolation like the other pure rules (auto-advance, can-confirm,
// seeding-basis). Given a row and the operator's live edits, it answers what a confirm would
// result in: the LK badge (a 3-state union, replacing the old lkValue/lkPending/lkFromNuliga
// booleans), confirmability, the Challenger judgment, and the id the confirm payload sends.
const reg = (over: Partial<AdminRegistration> = {}): AdminRegistration => ({
  id: 1,
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: null,
  competition: 'mens',
  firstName: 'Max',
  lastName: 'Muster',
  club: 'TV Winsen',
  email: 'max@example.com',
  phone: null,
  note: null,
  playerId: null,
  lk: null,
  status: 'new',
  ...over
})

const draft = (over: Partial<ConfirmDraft> = {}): ConfirmDraft => ({
  playerId: '',
  noId: false,
  competition: 'mens' as CompetitionSlug,
  ...over
})

describe('confirmPreview — LK badge', () => {
  it('no-id → the default LK, sourced as default', () => {
    expect(confirmPreview(reg(), draft({ noId: true })).lk).toEqual({ state: 'known', lk: '25.0', source: 'default' })
  })

  it('typed id matching the stored linkage → the stored rating, sourced as nuLiga', () => {
    const preview = confirmPreview(reg({ playerId: '12345678', lk: '21.0' }), draft({ playerId: '12345678' }))
    expect(preview.lk).toEqual({ state: 'known', lk: '21.0', source: 'nuliga' })
  })

  it('a fresh complete (8-digit) id whose rating is not on hand → pending', () => {
    expect(confirmPreview(reg(), draft({ playerId: '87654321' })).lk).toEqual({ state: 'pending' })
  })

  it('an 8-digit id that matches the link but with no stored rating yet → pending', () => {
    const preview = confirmPreview(reg({ playerId: '12345678', lk: null }), draft({ playerId: '12345678' }))
    expect(preview.lk).toEqual({ state: 'pending' })
  })

  // The Q4 flip: a half-typed id no longer flashes the stored nuLiga rating — the badge previews
  // the (absent) result, not the stale stored state.
  it('an incomplete id → unknown, even when a stored rating exists', () => {
    const preview = confirmPreview(reg({ playerId: '12345678', lk: '21.0' }), draft({ playerId: '123' }))
    expect(preview.lk).toEqual({ state: 'unknown' })
  })

  // The Q4 flip: a cleared id with no-id off → unknown, not a confident stale badge on an
  // unconfirmable row.
  it('an empty id with no-id off → unknown, even when a stored rating exists', () => {
    const preview = confirmPreview(reg({ playerId: '12345678', lk: '21.0' }), draft({ playerId: '' }))
    expect(preview.lk).toEqual({ state: 'unknown' })
  })

  // 8 chars but not all digits is not a complete nuLiga id (the wire schema rejects it), so it must
  // not promise a fetch — the badge stays unknown rather than flashing pending.
  it('a complete-length but non-numeric id → unknown, not pending', () => {
    expect(confirmPreview(reg(), draft({ playerId: '1234567X' })).lk).toEqual({ state: 'unknown' })
  })

  it('a reopened no-id confirmed row (stored default, no link) → the default', () => {
    const preview = confirmPreview(reg({ playerId: null, lk: '25.0', status: 'confirmed' }), draft({ noId: true }))
    expect(preview.lk).toEqual({ state: 'known', lk: '25.0', source: 'default' })
  })
})

describe('confirmPreview — confirmable', () => {
  it('blocks an empty id with no-id off, carrying the shared reason', () => {
    expect(confirmPreview(reg(), draft()).confirmable).toBe(
      'Zum Bestätigen bitte Spieler-ID eintragen oder „keine ID" (LK 25.0) setzen.'
    )
  })

  it('confirmable with no-id', () => {
    expect(confirmPreview(reg(), draft({ noId: true })).confirmable).toBe(true)
  })

  it('confirmable with a complete id', () => {
    expect(confirmPreview(reg(), draft({ playerId: '87654321' })).confirmable).toBe(true)
  })

  // canConfirm (the shared authority) only checks the id is non-empty — an incomplete id is
  // confirmable even while its LK reads unknown. The preview does not change that authority.
  it('treats an incomplete id as confirmable (the shared authority is unchanged)', () => {
    expect(confirmPreview(reg(), draft({ playerId: '123' })).confirmable).toBe(true)
  })
})

describe('confirmPreview — Challenger judgment', () => {
  it('flags a known nuLiga rating below the threshold in the Challenger field', () => {
    const preview = confirmPreview(
      reg({ playerId: '12345678', lk: '19.0', competition: 'mens-challenger' }),
      draft({ playerId: '12345678', competition: 'mens-challenger' })
    )
    expect(preview.challenger).toEqual({ tooStrong: true, judgedLk: '19.0' })
  })

  it('does not flag the default LK in the Challenger field (25 ≥ 20)', () => {
    const preview = confirmPreview(reg(), draft({ noId: true, competition: 'mens-challenger' }))
    expect(preview.challenger).toEqual({ tooStrong: false, judgedLk: '25.0' })
  })

  it('defers while the LK is pending (no rating to judge yet)', () => {
    const preview = confirmPreview(reg(), draft({ playerId: '87654321', competition: 'mens-challenger' }))
    expect(preview.challenger).toEqual({ tooStrong: false, judgedLk: null })
  })

  it('defers while the LK is unknown', () => {
    const preview = confirmPreview(reg(), draft({ playerId: '123', competition: 'mens-challenger' }))
    expect(preview.challenger).toEqual({ tooStrong: false, judgedLk: null })
  })

  it('never flags outside the Challenger field', () => {
    const preview = confirmPreview(
      reg({ playerId: '12345678', lk: '19.0' }),
      draft({ playerId: '12345678', competition: 'mens' })
    )
    expect(preview.challenger.tooStrong).toBe(false)
  })

  // The guard judges the LIVE competition, which the operator can change in the panel.
  it('re-judges when the operator moves the row into the Challenger field', () => {
    const preview = confirmPreview(
      reg({ playerId: '12345678', lk: '18.0', competition: 'mens' }),
      draft({ playerId: '12345678', competition: 'mens-challenger' })
    )
    expect(preview.challenger).toEqual({ tooStrong: true, judgedLk: '18.0' })
  })
})

describe('confirmPreview — confirm payload id', () => {
  it('clears the id under no-id', () => {
    expect(confirmPreview(reg(), draft({ noId: true })).playerId).toBe('')
  })

  it('passes through a linked id, trimmed', () => {
    expect(confirmPreview(reg(), draft({ playerId: ' 87654321 ' })).playerId).toBe('87654321')
  })

  it('empty when nothing is entered', () => {
    expect(confirmPreview(reg(), draft()).playerId).toBe('')
  })
})
