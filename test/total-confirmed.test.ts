import { describe, expect, it } from 'vitest'
import { totalConfirmed, type ParticipantsResponse } from '../shared'

// totalConfirmed centralises "what N counts" for the front-door momentum line: the count of confirmed
// entries across all fields, and 0 whenever the PUBLIC_LIST_ENABLED kill-switch is off. It reads only
// the existing ParticipantsResponse shape — no schema change, no worker change.
describe('totalConfirmed', () => {
  const participant: ParticipantsResponse['participants'][number] = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    club: 'TV Winsen',
    competition: 'womens',
    lk: 'LK 10',
    redacted: false,
    seedRank: null
  }

  it('counts confirmed entries for an enabled response', () => {
    const response: ParticipantsResponse = {
      enabled: true,
      participants: [participant, { ...participant, firstName: 'Grace' }]
    }
    expect(totalConfirmed(response)).toBe(2)
  })

  it('returns 0 when the kill-switch is off', () => {
    expect(totalConfirmed({ enabled: false, participants: [] })).toBe(0)
  })

  it('returns 0 for an empty enabled response', () => {
    expect(totalConfirmed({ enabled: true, participants: [] })).toBe(0)
  })
})
