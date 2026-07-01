import { describe, expect, it } from 'vitest'
import { createInMemoryDrawStore } from '../worker/store/draw.memory'
import type { MatchSlots } from '../shared'

// The draw store's result-entry seam (#90): status transitions (with the live court), result writes that
// advance the bracket, the winner-change cascade, and the opportunistic per-set save — driven through the
// in-memory adapter. The pure transform is covered in advancement.test.ts; here the persistence diff.

describe('in-memory draw store · status + result entry (#90)', () => {
  // A full 4-draw: two semifinals (round 1), the final (round 2, position 0), and the third-place playoff
  // (round 2, position 1). Ids are assigned by insertion order, so 1/2 = semis, 3 = final, 4 = third place.
  const bracket: MatchSlots[] = [
    { round: 1, position: 0, slot1RegId: 1, slot2RegId: 2, winnerRegId: null, outcome: null, thirdPlace: false },
    { round: 1, position: 1, slot1RegId: 3, slot2RegId: 4, winnerRegId: null, outcome: null, thirdPlace: false },
    { round: 2, position: 0, slot1RegId: null, slot2RegId: null, winnerRegId: null, outcome: null, thirdPlace: false },
    { round: 2, position: 1, slot1RegId: null, slot2RegId: null, winnerRegId: null, outcome: null, thirdPlace: true }
  ]
  const drawn = async () => {
    const store = createInMemoryDrawStore()
    await store.save({
      competition: 'mens',
      bracket: 'main',
      size: 4,
      seeding: [],
      revealSequence: [],
      matches: bracket,
      challengerMinLk: null,
      createdAt: 'now'
    })
    return store
  }
  const byId = async (store: Awaited<ReturnType<typeof drawn>>, id: number) =>
    (await store.listMatches()).find(m => m.id === id)!

  it('persists the third-place flag through the draw', async () => {
    const store = await drawn()
    expect((await byId(store, 4)).thirdPlace).toBe(true)
    expect((await byId(store, 1)).thirdPlace).toBe(false)
  })

  it('setMatchStatus → running captures the live court (defaulting to the planned court)', async () => {
    const store = await drawn()
    await store.placeMatch(1, { court: 2, day: 0, slot: 0 })
    // No explicit court → falls back to the planned court (2).
    await store.setMatchStatus(1, 'running')
    expect(await byId(store, 1)).toMatchObject({ status: 'running', liveCourt: 2 })
    // An explicit court overrides — the match moved to a freed court 5.
    await store.setMatchStatus(1, 'running', 5)
    expect(await byId(store, 1)).toMatchObject({ status: 'running', liveCourt: 5 })
    // Back to planned forgets the live court; the planned placement stays.
    await store.setMatchStatus(1, 'planned')
    expect(await byId(store, 1)).toMatchObject({ status: 'planned', liveCourt: null, court: 2 })
  })

  it('recordResult writes the winner + score + done, and advances the winner into the final', async () => {
    const store = await drawn()
    await store.recordResult(1, { winnerRegId: 1, outcome: null, score: { set1: [6, 3], set2: [6, 4], mtb: null } })
    const semi = await byId(store, 1)
    expect(semi).toMatchObject({ winnerRegId: 1, outcome: null, status: 'done' })
    expect(semi.score).toEqual({ set1: [6, 3], set2: [6, 4], mtb: null })
    // The winner advances into the final's slot 1 (semifinal position 0 → slot 1).
    expect((await byId(store, 3)).slot1RegId).toBe(1)
    // The loser drops into the third-place playoff's slot 1.
    expect((await byId(store, 4)).slot1RegId).toBe(2)
  })

  it('recordResult keeps a Match-Tie-Break score and a retirement outcome', async () => {
    const store = await drawn()
    await store.recordResult(2, {
      winnerRegId: 3,
      outcome: 'retirement',
      score: { set1: [6, 0], set2: [3, 6], mtb: [10, 7] }
    })
    const semi = await byId(store, 2)
    expect(semi).toMatchObject({ winnerRegId: 3, outcome: 'retirement', status: 'done' })
    expect(semi.score).toEqual({ set1: [6, 0], set2: [3, 6], mtb: [10, 7] })
  })

  it('a winner change cascade-clears the dependent final result and reverts it to planned', async () => {
    const store = await drawn()
    // Resolve both semis and the final: 1 beats 2, 3 beats 4, then 1 beats 3 in the final.
    await store.recordResult(1, { winnerRegId: 1, outcome: null, score: { set1: [6, 0], set2: [6, 0], mtb: null } })
    await store.recordResult(2, { winnerRegId: 3, outcome: null, score: { set1: [6, 0], set2: [6, 0], mtb: null } })
    await store.recordResult(3, { winnerRegId: 1, outcome: null, score: { set1: [7, 5], set2: [6, 4], mtb: null } })
    await store.setMatchStatus(3, 'running', 1) // the final had even been started

    // Correct semifinal 1: the winner was 1, now 2. Player 1 had gone on to win the final.
    await store.recordResult(1, { winnerRegId: 2, outcome: null, score: { set1: [4, 6], set2: [2, 6], mtb: null } })

    expect((await byId(store, 1)).winnerRegId).toBe(2)
    // The final re-fills its slot with the new winner 2 and is cleared back to an un-played planned match.
    const final = await byId(store, 3)
    expect(final).toMatchObject({ slot1RegId: 2, winnerRegId: null, outcome: null, status: 'planned', liveCourt: null })
    expect(final.score).toEqual({ set1: null, set2: null, mtb: null })
    // The third-place playoff's slot 1 now holds the new loser (1).
    expect((await byId(store, 4)).slot1RegId).toBe(1)
  })

  it('resets a still-running (not yet decided) downstream match when an upstream winner is corrected', async () => {
    const store = await drawn()
    // Resolve both semis so the final has both players (1 vs 3), then *start* the final running on court 4
    // with one set saved — but do NOT record its result (it stays `running`, winner still null).
    await store.recordResult(1, { winnerRegId: 1, outcome: null, score: { set1: [6, 0], set2: [6, 0], mtb: null } })
    await store.recordResult(2, { winnerRegId: 3, outcome: null, score: { set1: [6, 0], set2: [6, 0], mtb: null } })
    await store.setMatchStatus(3, 'running', 4)
    await store.saveSet(3, 1, [6, 3])
    expect(await byId(store, 3)).toMatchObject({ status: 'running', liveCourt: 4 })

    // Correct semifinal 1 (winner 1 → 2). The final's slot 1 is refilled with 2, so its live state (court,
    // saved set) belonged to the now-removed player 1 and must be wiped — not carried onto 2.
    await store.recordResult(1, { winnerRegId: 2, outcome: null, score: { set1: [4, 6], set2: [4, 6], mtb: null } })
    const final = await byId(store, 3)
    expect(final).toMatchObject({ slot1RegId: 2, status: 'planned', liveCourt: null })
    expect(final.score).toEqual({ set1: null, set2: null, mtb: null })
  })

  it('a score-only correction leaves the downstream bracket untouched', async () => {
    const store = await drawn()
    await store.recordResult(1, { winnerRegId: 1, outcome: null, score: { set1: [6, 0], set2: [6, 0], mtb: null } })
    await store.recordResult(2, { winnerRegId: 3, outcome: null, score: { set1: [6, 0], set2: [6, 0], mtb: null } })
    await store.recordResult(3, { winnerRegId: 1, outcome: null, score: { set1: [6, 4], set2: [6, 4], mtb: null } })
    // Re-record semifinal 1 with the SAME winner but a corrected score.
    await store.recordResult(1, { winnerRegId: 1, outcome: null, score: { set1: [7, 5], set2: [6, 4], mtb: null } })
    expect((await byId(store, 1)).score).toEqual({ set1: [7, 5], set2: [6, 4], mtb: null })
    // The final still stands — same winner downstream, nothing cascaded.
    expect(await byId(store, 3)).toMatchObject({ slot1RegId: 1, winnerRegId: 1, status: 'done' })
  })

  it('saveSet writes one set opportunistically without resolving the match', async () => {
    const store = await drawn()
    await store.saveSet(1, 1, [6, 3])
    expect((await byId(store, 1)).score).toEqual({ set1: [6, 3], set2: null, mtb: null })
    // The match is not resolved by an opportunistic set save.
    expect(await byId(store, 1)).toMatchObject({ winnerRegId: null, status: 'planned' })
    // A later set, then clearing the first back to unplayed.
    await store.saveSet(1, 2, [4, 6])
    await store.saveSet(1, 1, null)
    expect((await byId(store, 1)).score).toEqual({ set1: null, set2: [4, 6], mtb: null })
  })
})
