import { toCompetitionDraw, toMatch, toRevealState, type DrawStore } from './draw'
import { resultPatches, setColumns } from './draw.results'
import type { DrawRow, MatchRow } from '../db/schema'

// The in-memory adapter holds the raw rows so the orchestration can be driven through this interface
// in tests (no D1). save() mirrors the D1 batch — draw record + match rows in one push, ids assigned
// like AUTOINCREMENT — and enforces the same one-draw-per-(competition,bracket) invariant.
export const createInMemoryDrawStore = (): DrawStore => {
  const drawRows: DrawRow[] = []
  const matchRows: MatchRow[] = []
  let nextDrawId = 1
  let nextMatchId = 1

  const store: DrawStore = {
    async findDraw(competition, bracket) {
      return drawRows.find(d => d.competition === competition && d.bracket === bracket) ?? null
    },

    async save(input) {
      // A break-glass re-run (replace) drops the competition's existing draw + matches first, mirroring
      // the D1 batch's in-transaction delete; a fresh draw still refuses to overwrite (the unique-index
      // guard the D1 adapter enforces).
      if (input.replace) {
        await store.deleteByCompetition(input.competition)
      } else if (await store.findDraw(input.competition, input.bracket)) {
        throw new Error(`draw already exists for ${input.competition}/${input.bracket}`)
      }
      drawRows.push({
        id: nextDrawId++,
        competition: input.competition,
        bracket: input.bracket,
        size: input.size,
        seeding: JSON.stringify(input.seeding),
        revealSequence: JSON.stringify(input.revealSequence),
        revealCursor: 0,
        challengerMinLk: input.challengerMinLk,
        createdAt: input.createdAt
      })
      for (const m of input.matches) {
        matchRows.push({
          id: nextMatchId++,
          competition: input.competition,
          bracket: input.bracket,
          round: m.round,
          position: m.position,
          slot1RegId: m.slot1RegId,
          slot2RegId: m.slot2RegId,
          // A round-1 bye is already resolved at draw time (winner advances, no score, §32.4).
          winnerRegId: m.winnerRegId,
          outcome: m.outcome,
          thirdPlace: m.thirdPlace,
          // A freshly drawn match is unscheduled and `planned`, with no live court and no score — the
          // operator places it (#88) and records its result (#90) later.
          court: null,
          day: null,
          slot: null,
          status: 'planned',
          liveCourt: null,
          set1Slot1: null,
          set1Slot2: null,
          set2Slot1: null,
          set2Slot2: null,
          mtbSlot1: null,
          mtbSlot2: null
        })
      }
    },

    async getDraw(competition, bracket) {
      const draw = await store.findDraw(competition, bracket)
      if (!draw) return null
      return toCompetitionDraw(
        draw,
        matchRows.filter(m => m.competition === competition && m.bracket === bracket)
      )
    },

    async listMatches() {
      return matchRows.map(toMatch)
    },

    async findMatch(id) {
      const row = matchRows.find(m => m.id === id)
      return row ? toMatch(row) : null
    },

    async placeMatch(id, placement) {
      const row = matchRows.find(m => m.id === id)
      if (row) {
        row.court = placement?.court ?? null
        row.day = placement?.day ?? null
        row.slot = placement?.slot ?? null
      }
    },

    async setMatchStatus(id, status, liveCourt) {
      const row = matchRows.find(m => m.id === id)
      if (!row) return
      row.status = status
      // Going running captures the actual court (the pick, defaulting to the planned court); planned forgets
      // it; done keeps where it was played.
      if (status === 'running') row.liveCourt = liveCourt ?? row.court ?? null
      else if (status === 'planned') row.liveCourt = null
    },

    async recordResult(id, input) {
      const target = matchRows.find(m => m.id === id)
      if (!target) return
      const group = matchRows.filter(m => m.competition === target.competition && m.bracket === target.bracket)
      for (const { id: rid, patch } of resultPatches(group, id, input)) {
        const row = matchRows.find(m => m.id === rid)
        if (row) Object.assign(row, patch)
      }
    },

    async saveSet(id, set, score) {
      const row = matchRows.find(m => m.id === id)
      if (row) Object.assign(row, setColumns(set, score))
    },

    async resetSchedule() {
      // Clear only the still-`planned` placements back to the backlog; running/done keep their court.
      for (const row of matchRows) {
        if (row.status === 'planned') {
          row.court = null
          row.day = null
          row.slot = null
        }
      }
    },

    async getReveal(competition, bracket) {
      const draw = await store.findDraw(competition, bracket)
      return draw ? toRevealState(draw) : null
    },

    async listReveals() {
      return drawRows.map(toRevealState)
    },

    async setCursor(competition, bracket, cursor) {
      const draw = drawRows.find(d => d.competition === competition && d.bracket === bracket)
      if (draw) draw.revealCursor = cursor
    },

    async listDraws() {
      return drawRows.map(draw =>
        toCompetitionDraw(
          draw,
          matchRows.filter(m => m.competition === draw.competition && m.bracket === draw.bracket)
        )
      )
    },

    async deleteByCompetition(competition) {
      const removed = drawRows.filter(d => d.competition === competition).length
      // Mutate in place (the arrays are closed over): drop this competition's draw records and
      // matches across every bracket — the in-memory mirror of the D1 batch delete.
      drawRows.splice(0, drawRows.length, ...drawRows.filter(d => d.competition !== competition))
      matchRows.splice(0, matchRows.length, ...matchRows.filter(m => m.competition !== competition))
      return removed
    },

    async deleteAll() {
      const removed = drawRows.length
      drawRows.length = 0
      matchRows.length = 0
      return removed
    }
  }
  return store
}
