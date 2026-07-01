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
  type MatchStatus,
  type Placement,
  type RevealStep,
  revealStepSchema,
  type SeedingEntry,
  seedingEntrySchema
} from '../../shared'
import { draws, matches, type DrawRow, type MatchRow, type NewMatchRow } from '../db/schema'
// The result-write helpers (score column mapping + the Advancement diff both adapters apply) live in
// draw.results.ts, so the store module stays within the file budget and the two adapters share one diff.
import { type RecordResultInput, resultPatches, setColumns, toScore } from './draw.results'

// The deep draw Store (ADR-0025): callers speak in draws and brackets, never SQL. It owns the two
// tables the draw writes — the `draws` record (seeding snapshot + reveal sequence + cursor) and
// the materialized `matches` — and the rule that they are written together, atomically. Two adapters
// back it (D1/Drizzle in prod, in-memory in tests), like the registrations Store. It grows one
// operation per slice; this epic writes the main bracket, full or non-full (§31 byes persisted as
// resolved rows: winner set, outcome 'bye').

// Everything one draw persists, handed over in one call so the Store can write it atomically.
export interface SaveDrawInput {
  competition: string
  bracket: Bracket
  size: number
  seeding: SeedingEntry[]
  revealSequence: RevealStep[]
  matches: MatchSlots[]
  // The Challenger cap frozen into this draw (ADR-0024), or null when no cap binds (non-Challenger
  // fields). Snapshotted, not a standing preference.
  challengerMinLk: number | null
  createdAt: string
  // Break-glass re-run of an unrevealed draw (cursor 0, ADR-0026): replace the competition's existing
  // draw + matches in the *same* transaction as the new write, so a failed save can never leave the
  // field draw-less. Default (false) is the first-ever draw, which must not collide with an existing one.
  replace?: boolean
}

// One competition+bracket's reveal state (ADR-0003): the draw size (the bracket shape), the parsed
// reveal sequence (playback artifact), and the cursor — how many steps the draw reveal show has shown.
// The reveal sequence is parsed through its Zod schema at the Store seam (like `seeding`), so a
// malformed `reveal_sequence` column fails loudly here, not as a wrong-looking reveal downstream.
export interface RevealState {
  competition: string
  bracket: Bracket
  size: number
  cursor: number
  steps: RevealStep[]
}

export interface DrawStore {
  /** The draw record for this competition+bracket, or null — the "already drawn?" check (ADR-0027). */
  findDraw(competition: string, bracket: Bracket): Promise<DrawRow | null>

  /**
   * Persist a draw atomically: the draw record (seeding + reveal sequence) and its `matches` rows in
   * one transaction, so a competition is never half-drawn. The (competition, bracket) unique index
   * makes a concurrent double-draw fail rather than write a second bracket. With `replace: true` the
   * competition's existing draw + matches are torn down in the *same* transaction first, so a re-run of
   * an unrevealed draw (ADR-0026) swaps atomically — a save failure cannot leave the field draw-less.
   */
  save(input: SaveDrawInput): Promise<void>

  /** The assembled draw (seeding + materialized bracket) for one competition+bracket, or null. */
  getDraw(competition: string, bracket: Bracket): Promise<CompetitionDraw | null>

  /**
   * Every match row across all competitions + brackets — the public schedule feed's source (it numbers
   * each bracket and resolves feeders over the full set, then emits only the placed matches). Flat, in
   * insertion order; the caller groups by competition+bracket.
   */
  listMatches(): Promise<Match[]>

  /** One match by id, or null — the single-row read the result endpoint resolves the winning slot from. */
  findMatch(id: number): Promise<Match | null>

  /**
   * Place a match on the grid, move it to another cell, or clear it back to the backlog (ADR-0005): set
   * the court + day + slot to `placement`, or null all three with `placement: null`. A pure placement
   * write — it never touches the bracket. The single match-update seam the schedule grid writes through
   * (no raw SQL in handlers); result/status writes extend it in #90.
   */
  placeMatch(id: number, placement: Placement | null): Promise<void>

  /**
   * Move a match's live status (ADR-0032), the signal the public board keys off. Going `running` captures
   * the **actual** court the match is on (`liveCourt`) — the operator's pick, defaulting to the planned
   * court when none is given — so the board can send spectators to the right place even when a match moves
   * to a freed court. `planned` clears the live court (the match has un-started); `done` keeps it (where it
   * was played). A pure status/court write — it never touches the bracket.
   */
  setMatchStatus(id: number, status: MatchStatus, liveCourt?: number): Promise<void>

  /**
   * Record (or correct) a completed result and advance the bracket (CONTEXT: Advancement, ADR-0026). Writes
   * the target match's winner + outcome + set scores, marks it `done`, and runs the pure `applyResult`
   * transform to propagate the winner into the parent slot and a semifinal loser into the third-place
   * playoff. A **winner change** cascade-clears any downstream result that consumed the old winner (those
   * rows revert to `planned`, their scores cleared), so the bracket never holds a player who lost; a
   * score-only correction (same winner) touches nothing downstream. The whole propagation lands atomically.
   */
  recordResult(id: number, input: RecordResultInput): Promise<void>

  /**
   * Opportunistically save (or clear) one set's score while a match is ongoing (ADR-0032 §20): set 1/2 for
   * the two sets, 3 for the Match-Tie-Break. It never resolves the match — no winner, no advancement — so
   * the live board can show „Satz 1: 6:3 · Satz 2 läuft" without the match being over. `score` null clears
   * the set back to unplayed.
   */
  saveSet(id: number, set: 1 | 2 | 3, score: readonly [number, number] | null): Promise<void>

  /**
   * Reset the schedule to the backlog (ADR-0041): clear court/day/slot for every match still `planned`,
   * leaving the draw, brackets, results, and any `running`/`done` match's placement untouched — we never
   * erase where a match was actually played. The placement-only half of „Spielplan zurücksetzen" (the
   * caller also flips `schedule_published` off); it never touches the bracket. Returns nothing — the rebuild
   * loop (reset → Vorschlag → veröffentlichen) reads the cleared backlog on its next load.
   */
  resetSchedule(): Promise<void>

  /**
   * The reveal state (size + parsed reveal sequence + cursor) for one competition+bracket, or null —
   * what the advance reads to clamp the next cursor (ADR-0003). The reveal sequence is parsed at the
   * seam, so a malformed column throws here rather than feeding a wrong-looking reveal.
   */
  getReveal(competition: string, bracket: Bracket): Promise<RevealState | null>

  /** Every drawn competition's reveal state — the public live bracket's source. */
  listReveals(): Promise<RevealState[]>

  /**
   * Set the reveal cursor for one competition+bracket (ADR-0003): pure playback, the caller clamps it
   * to [0, total]. Never touches the bracket or the reveal sequence — advancing reveals, never re-draws.
   */
  setCursor(competition: string, bracket: Bracket, cursor: number): Promise<void>

  /** Every drawn competition the surface lists — assembled the same way as getDraw. */
  listDraws(): Promise<CompetitionDraw[]>

  /**
   * Tear down one competition's draw (debug-only, ADR-0029): delete its draw record(s) and matches
   * across every bracket, returning it to "not drawn" and freeing the unique index for a re-draw.
   * Returns the number of draw records removed (0 when the field was not drawn). Reverses
   * „Jetzt auslosen" — the exception the live path never has (ADR-0026/0027 stand for the operator).
   */
  deleteByCompetition(competition: string): Promise<number>

  /**
   * Tear down every draw (debug-only, ADR-0029): the cascade behind "back to signup". Deletes all
   * draw records and matches; returns the number of draw records removed.
   */
  deleteAll(): Promise<number>
}

// Map a stored match row to the wire shape (the text columns narrow to their domain enums; the
// Zod response schema is the authority that rejects anything that does not).
export const toMatch = (row: MatchRow): Match => ({
  id: row.id,
  competition: row.competition as CompetitionSlug,
  bracket: row.bracket as Bracket,
  round: row.round,
  position: row.position,
  thirdPlace: row.thirdPlace,
  slot1RegId: row.slot1RegId,
  slot2RegId: row.slot2RegId,
  winnerRegId: row.winnerRegId,
  outcome: row.outcome as MatchOutcome | null,
  score: toScore(row),
  court: row.court,
  day: row.day,
  slot: row.slot,
  status: row.status as MatchStatus,
  liveCourt: row.liveCourt
})

// Built once, not per row: toCompetitionDraw runs on every row of listDraws, and the array schema is
// identical each time.
const seedingArraySchema = seedingEntrySchema.array()

// Assemble a draw record + its match rows into the CompetitionDraw the surface reads. The seeding is
// parsed through its Zod schema, not cast: a malformed or stale `seeding` JSON column fails loudly
// here at the store seam rather than as a wrong-looking bracket downstream — the one cast that used
// to break the ADR-0009 type chain. A corrupt row is real inconsistency the atomic write makes
// unreachable, so the throw is intentional: getDraw and listDraws both surface it. Note the blast
// radius — because listDraws maps this over every row, one corrupt row fails the whole draws overview
// (and reset's readmit count), not just its own field. We accept that: a corrupt row is a state that
// should never exist, and degrading per-row would be defensive complexity guarding the unreachable.
export const toCompetitionDraw = (draw: DrawRow, matchRows: MatchRow[]): CompetitionDraw => ({
  competition: draw.competition as CompetitionSlug,
  bracket: draw.bracket as Bracket,
  size: draw.size,
  // The reveal progress the surface gates the bracket on (cursor === total ⇒ fully revealed). The cursor
  // is carried straight through; the total is the reveal sequence length (one step per first-round line).
  cursor: draw.revealCursor,
  total: (JSON.parse(draw.revealSequence) as RevealStep[]).length,
  seeding: seedingArraySchema.parse(JSON.parse(draw.seeding)),
  matches: matchRows.map(toMatch)
})

// Built once (mapped over every row of listReveals), like seedingArraySchema.
const revealSequenceArraySchema = revealStepSchema.array()

// Project a draw row to its reveal state — the reveal sequence parsed at the seam (a malformed
// `reveal_sequence` throws here, the one cast the JSON column would otherwise hide), the cursor and
// size carried straight through.
export const toRevealState = (draw: DrawRow): RevealState => ({
  competition: draw.competition,
  bracket: draw.bracket as Bracket,
  size: draw.size,
  cursor: draw.revealCursor,
  steps: revealSequenceArraySchema.parse(JSON.parse(draw.revealSequence))
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
        slot2RegId: m.slot2RegId,
        // A round-1 bye is already resolved at draw time (winner advances, no score, §32.4).
        winnerRegId: m.winnerRegId,
        outcome: m.outcome,
        // The third-place playoff flag rides along (its loser-feeders fill on Advancement); every other
        // column defaults (unscheduled, planned, no score).
        thirdPlace: m.thirdPlace
      }))
      // D1 caps bound parameters at 100 per query. A match row binds 9 columns, so a 16-draw's 16 rows
      // (= 144 params) overflow a single multi-row insert — split them into chunks of ≤ 10 rows (≤ 90
      // params). All inserts ride one D1 batch = one transaction, so the draw record and every match
      // row land together or not at all; the unique (competition, bracket) index turns a racing second
      // draw into a failed insert.
      const CHUNK = 10
      const matchInserts = Array.from({ length: Math.ceil(matchValues.length / CHUNK) }, (_, k) =>
        db.insert(matches).values(matchValues.slice(k * CHUNK, k * CHUNK + CHUNK))
      )
      const drawInsert = db.insert(draws).values({
        competition: input.competition,
        bracket: input.bracket,
        size: input.size,
        seeding: JSON.stringify(input.seeding),
        revealSequence: JSON.stringify(input.revealSequence),
        challengerMinLk: input.challengerMinLk,
        createdAt: input.createdAt
      })
      // A break-glass re-run tears down the old draw + matches in the *same* batch as the new write, so
      // the swap is atomic (ADR-0026) and frees the unique index before the insert — a save failure can
      // never leave the field draw-less. Deletes span every bracket, mirroring deleteByCompetition; at
      // cursor 0 only `main` exists, so nothing else is touched. The fresh-draw path (no replace) keeps
      // the unique index as the concurrent-double-draw guard.
      if (input.replace) {
        await db.batch([
          db.delete(matches).where(eq(matches.competition, input.competition)),
          db.delete(draws).where(eq(draws.competition, input.competition)),
          drawInsert,
          ...matchInserts
        ])
      } else {
        await db.batch([drawInsert, ...matchInserts])
      }
    },

    async getDraw(competition, bracket) {
      const draw = await this.findDraw(competition, bracket)
      if (!draw) return null
      return toCompetitionDraw(draw, await matchRowsFor(competition, bracket))
    },

    async listMatches() {
      return (await db.select().from(matches)).map(toMatch)
    },

    async findMatch(id) {
      const rows = await db.select().from(matches).where(eq(matches.id, id)).limit(1)
      return rows[0] ? toMatch(rows[0]) : null
    },

    async placeMatch(id, placement) {
      await db
        .update(matches)
        .set({
          court: placement?.court ?? null,
          day: placement?.day ?? null,
          slot: placement?.slot ?? null
        })
        .where(eq(matches.id, id))
    },

    async setMatchStatus(id, status, liveCourt) {
      const patch: Partial<NewMatchRow> = { status }
      if (status === 'running') {
        // The actual court (ADR-0032): the operator's pick, defaulting to the planned court when none is
        // sent — read the row only in that fallback case, not on every transition.
        let court = liveCourt
        if (court === undefined) {
          const row = (await db.select({ court: matches.court }).from(matches).where(eq(matches.id, id)).limit(1))[0]
          court = row?.court ?? undefined
        }
        patch.liveCourt = court ?? null
      } else if (status === 'planned') {
        patch.liveCourt = null // un-started: forget the actual court; `done` keeps where it was played.
      }
      await db.update(matches).set(patch).where(eq(matches.id, id))
    },

    async recordResult(id, input) {
      const target = (await db.select().from(matches).where(eq(matches.id, id)).limit(1))[0]
      if (!target) return
      // Advancement is local to one competition+bracket — load that whole set so feeders/successors resolve.
      const group = await db
        .select()
        .from(matches)
        .where(and(eq(matches.competition, target.competition), eq(matches.bracket, target.bracket)))
      const [first, ...rest] = resultPatches(group, id, input).map(p =>
        db.update(matches).set(p.patch).where(eq(matches.id, p.id))
      )
      // The whole propagation lands in one batch = one transaction, so a cascade can never half-apply.
      await db.batch([first, ...rest])
    },

    async saveSet(id, set, score) {
      await db.update(matches).set(setColumns(set, score)).where(eq(matches.id, id))
    },

    async resetSchedule() {
      // Only `planned` matches go back to the backlog; a `running`/`done` match keeps its court (its
      // placement is where it was actually played, ADR-0041).
      await db.update(matches).set({ court: null, day: null, slot: null }).where(eq(matches.status, 'planned'))
    },

    async getReveal(competition, bracket) {
      const draw = await this.findDraw(competition, bracket)
      return draw ? toRevealState(draw) : null
    },

    async listReveals() {
      return (await db.select().from(draws)).map(toRevealState)
    },

    async setCursor(competition, bracket, cursor) {
      await db
        .update(draws)
        .set({ revealCursor: cursor })
        .where(and(eq(draws.competition, competition), eq(draws.bracket, bracket)))
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
    },

    async deleteByCompetition(competition) {
      // Matches and draw record fall together, in one batch = one transaction (the mirror of save):
      // a competition is never left with orphaned matches and no draw record, or vice versa. The
      // returned draw rows give the count the caller reports.
      const [, removed] = await db.batch([
        db.delete(matches).where(eq(matches.competition, competition)),
        db.delete(draws).where(eq(draws.competition, competition)).returning({ id: draws.id })
      ])
      return removed.length
    },

    async deleteAll() {
      const [, removed] = await db.batch([db.delete(matches), db.delete(draws).returning({ id: draws.id })])
      return removed.length
    }
  }
}
