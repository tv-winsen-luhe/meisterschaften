import type { D1Database } from '@cloudflare/workers-types'
import { drizzle } from 'drizzle-orm/d1'
import { and, eq } from 'drizzle-orm'
import {
  type Bracket,
  type CompetitionDraw,
  type CompetitionSlug,
  type Match,
  type MatchOutcome,
  type MatchSlots,
  type RevealStep,
  type SeedingEntry
} from '../../shared'
import { draws, matches, type DrawRow, type MatchRow, type NewMatchRow } from '../db/schema'

// The deep draw Store (ADR-0025): callers speak in draws and brackets, never SQL. It owns the two
// tables the draw writes — the `draws` record (seeding snapshot + reveal sequence + cursor) and
// the materialized `matches` — and the rule that they are written together, atomically. Two adapters
// back it (D1/Drizzle in prod, in-memory in tests), like the registrations Store. It grows one
// operation per slice; this epic writes the main bracket of a full field.

// Everything one draw persists, handed over in one call so the Store can write it atomically.
export interface SaveDrawInput {
  competition: string
  bracket: Bracket
  size: number
  seeding: SeedingEntry[]
  revealSequence: RevealStep[]
  matches: MatchSlots[]
  createdAt: string
}

export interface DrawStore {
  /** The draw record for this competition+bracket, or null — the "already drawn?" check (ADR-0027). */
  findDraw(competition: string, bracket: Bracket): Promise<DrawRow | null>

  /**
   * Persist a draw atomically: the draw record (seeding + reveal sequence) and its `matches` rows in
   * one transaction, so a competition is never half-drawn. The (competition, bracket) unique index
   * makes a concurrent double-draw fail rather than write a second bracket.
   */
  save(input: SaveDrawInput): Promise<void>

  /** The assembled draw (seeding + materialized bracket) for one competition+bracket, or null. */
  getDraw(competition: string, bracket: Bracket): Promise<CompetitionDraw | null>

  /** Every drawn competition the surface lists — assembled the same way as getDraw. */
  listDraws(): Promise<CompetitionDraw[]>
}

// Map a stored match row to the wire shape (the text columns narrow to their domain enums; the
// Zod response schema is the authority that rejects anything that does not).
const toMatch = (row: MatchRow): Match => ({
  id: row.id,
  competition: row.competition as CompetitionSlug,
  bracket: row.bracket as Bracket,
  round: row.round,
  position: row.position,
  slot1RegId: row.slot1RegId,
  slot2RegId: row.slot2RegId,
  winnerRegId: row.winnerRegId,
  outcome: row.outcome as MatchOutcome | null
})

// Assemble a draw record + its match rows into the CompetitionDraw the surface reads.
const toCompetitionDraw = (draw: DrawRow, matchRows: MatchRow[]): CompetitionDraw => ({
  competition: draw.competition as CompetitionSlug,
  bracket: draw.bracket as Bracket,
  size: draw.size,
  seeding: JSON.parse(draw.seeding) as SeedingEntry[],
  matches: matchRows.map(toMatch)
})

export const createD1DrawStore = (d1: D1Database): DrawStore => {
  const db = drizzle(d1)

  const matchRowsFor = (competition: string, bracket: Bracket) =>
    db
      .select()
      .from(matches)
      .where(and(eq(matches.competition, competition), eq(matches.bracket, bracket)))

  return {
    async findDraw(competition, bracket) {
      const rows = await db
        .select()
        .from(draws)
        .where(and(eq(draws.competition, competition), eq(draws.bracket, bracket)))
        .limit(1)
      return rows[0] ?? null
    },

    async save(input) {
      const matchValues: NewMatchRow[] = input.matches.map(m => ({
        competition: input.competition,
        bracket: input.bracket,
        round: m.round,
        position: m.position,
        slot1RegId: m.slot1RegId,
        slot2RegId: m.slot2RegId
      }))
      // One D1 batch = one transaction: the draw record and the match rows land together or not at
      // all. The unique (competition, bracket) index turns a racing second draw into a failed insert.
      // The matches go in as a single multi-row insert (two statements total, not one per row).
      await db.batch([
        db.insert(draws).values({
          competition: input.competition,
          bracket: input.bracket,
          size: input.size,
          seeding: JSON.stringify(input.seeding),
          revealSequence: JSON.stringify(input.revealSequence),
          createdAt: input.createdAt
        }),
        db.insert(matches).values(matchValues)
      ])
    },

    async getDraw(competition, bracket) {
      const draw = await this.findDraw(competition, bracket)
      if (!draw) return null
      return toCompetitionDraw(draw, await matchRowsFor(competition, bracket))
    },

    async listDraws() {
      const drawRows = await db.select().from(draws)
      const matchRows = await db.select().from(matches)
      return drawRows.map(draw =>
        toCompetitionDraw(
          draw,
          matchRows.filter(m => m.competition === draw.competition && m.bracket === draw.bracket)
        )
      )
    }
  }
}

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
      if (await store.findDraw(input.competition, input.bracket)) {
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
          winnerRegId: null,
          outcome: null
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

    async listDraws() {
      return drawRows.map(draw =>
        toCompetitionDraw(
          draw,
          matchRows.filter(m => m.competition === draw.competition && m.bracket === draw.bracket)
        )
      )
    }
  }
  return store
}
