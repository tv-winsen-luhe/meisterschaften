import { describe, expect, it } from 'vitest'
import { courtBudgetProjection, matchCount } from '../shared'

// courtBudgetProjection is the planning cockpit's court-budget math (CONTEXT: Court budget, ADR-0043):
// given each field's active and capacity counts, the social-mixer reservation and the weekend budget,
// it sums the match load now and at full fill against the one shared 72-slot budget, and flags whether
// a full field would overbook it. Pure, built on matchCount (the one draw-math source), so the cockpit
// can never disagree with the draw on how many matches a field of N runs.
//
// A field draws at most `capacity` into its bracket (the cut, ADR-0043): the surplus are reserves who
// add no bracket matches — so a field's load is matchCount(min(active, capacity)), never the raw active
// count. That also keeps every figure within the supported draw sizes (capacity ≤ 16).
describe('courtBudgetProjection', () => {
  // The three live fields' real caps: Damen 8, Herren 16, Herren Challenger 16.
  const liveFields = [
    { active: 0, capacity: 8 },
    { active: 0, capacity: 16 },
    { active: 0, capacity: 16 }
  ]

  it('sums the live load over the fields (matchCount per field)', () => {
    const fields = [
      { active: 4, capacity: 8 },
      { active: 8, capacity: 16 }
    ]
    const result = courtBudgetProjection(fields, 10, 72)
    expect(result.load).toBe(matchCount(4) + matchCount(8))
    expect(result.used).toBe(result.load + 10)
  })

  it('clamps an over-subscribed field to its capacity — reserves add no matches', () => {
    // 19 active in a 16-cap field draws 16; the 3 reserves do not add bracket matches. Without the
    // clamp matchCount(19) would also reach an unsupported draw size (32) — the clamp avoids that too.
    const result = courtBudgetProjection([{ active: 19, capacity: 16 }], 0, 72)
    expect(result.load).toBe(matchCount(16))
  })

  it('projects the full-fill load from every field’s capacity', () => {
    const result = courtBudgetProjection(liveFields, 10, 72)
    expect(result.fullLoad).toBe(matchCount(8) + matchCount(16) + matchCount(16))
    expect(result.projected).toBe(result.fullLoad + 10)
  })

  it('does not overbook at the real caps (full fill + reservation fits 72)', () => {
    // matchCount(8)=11, matchCount(16)=23 → 57 full; +10 reserved = 67 ≤ 72.
    const result = courtBudgetProjection(liveFields, 10, 72)
    expect(result.projected).toBe(67)
    expect(result.projectedOver).toBe(false)
    expect(result.over).toBe(false)
  })

  it('flags projectedOver when raising a cap would burst the budget at full fill', () => {
    // Raise both 16-fields' load by over-filling: a hypothetical larger budget pressure. Here the
    // reservation alone pushes the full projection past a tighter budget.
    const result = courtBudgetProjection(liveFields, 10, 60)
    expect(result.fullLoad).toBe(57)
    expect(result.projected).toBe(67)
    expect(result.projectedOver).toBe(true)
    // The live load is still 0 here (no active), so the live gauge is not over — only the projection is.
    expect(result.over).toBe(false)
  })

  it('flags over when the current load already exceeds the budget', () => {
    const result = courtBudgetProjection([{ active: 16, capacity: 16 }], 60, 72)
    expect(result.used).toBe(matchCount(16) + 60)
    expect(result.over).toBe(true)
  })

  it('an empty event has zero load and overbooks nothing', () => {
    const result = courtBudgetProjection([], 0, 72)
    expect(result).toMatchObject({ load: 0, fullLoad: 0, used: 0, projected: 0, over: false, projectedOver: false })
  })
})
