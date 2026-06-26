import { describe, expect, it } from 'vitest'
import type { AdminRegistration } from '../shared'
import { nextSelection } from '../src/admin/surfaces/auto-advance'

// nextSelection is the Anmeldungen-triage auto-advance rule (ADR-0019), kept a pure function
// separate from the surface so it is tested in isolation like the other pure predicates
// (can-confirm, seeding-basis). Given the queue as it stood when the operator acted (already
// filtered + sorted) and the id just acted on, it returns the next entry to open: the following
// row, or the previous one if the last was acted on, or null if the queue had no other entry.
const row = (id: number): AdminRegistration => ({
  id,
  createdAt: '2026-06-01T10:00:00.000Z',
  competition: 'mens',
  firstName: 'Max',
  lastName: 'Muster',
  club: 'TV Winsen',
  email: 'max@example.com',
  phone: null,
  note: null,
  playerId: null,
  lk: null,
  status: 'new'
})

describe('nextSelection', () => {
  const queue = [row(10), row(20), row(30)]

  it('picks the following entry when acting on a middle row', () => {
    expect(nextSelection(queue, 20)).toBe(30)
  })

  it('picks the following entry when acting on the first row', () => {
    expect(nextSelection(queue, 10)).toBe(20)
  })

  it('falls back to the previous entry when acting on the last row', () => {
    expect(nextSelection(queue, 30)).toBe(20)
  })

  it('returns null when the acted-on row was the only entry', () => {
    expect(nextSelection([row(10)], 10)).toBeNull()
  })

  it('returns null for an empty queue', () => {
    expect(nextSelection([], 10)).toBeNull()
  })

  it('returns null when the acted-on id is not in the queue', () => {
    expect(nextSelection(queue, 999)).toBeNull()
  })
})
