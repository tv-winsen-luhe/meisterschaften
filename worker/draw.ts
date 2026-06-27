import {
  type CompetitionDraw,
  drawBlocker,
  type DrawBlocker,
  DRAW_BLOCKER_REASON,
  drawBracket,
  drawSize,
  materializeMatches,
  type Phase,
  type RandomSource
} from '../shared'
import type { DrawStore } from './store/draw'
import type { RegistrationsStore } from './store/registrations'

// The draw orchestration (ADR-0025, ADR-0027): the worker-side composition behind the draw button (UI: „Jetzt auslosen").
// It guards the preconditions, reads the seeded field, runs the pure `drawBracket`, and writes the
// bracket + draw record atomically through the DrawStore. The math is pure (shared/draw.ts); this is
// only the wiring, so it is driven through the in-memory stores + a deterministic RandomSource in
// tests. Main bracket, full or non-full field (§31 byes), sizes 8/16.

// Why a draw could not start. The pure preconditions are the shared DrawBlocker (so the client's
// affordance reads the same rule, ADR-0011); `AlreadyDrawn` is the one that needs the store and so
// lives only here. Each maps to an operator-facing reason and an HTTP status at the route.
export type DrawError = DrawBlocker | 'AlreadyDrawn'

// A rules-compliant draw is final (ADR-0026) — a re-run is refused, not silently re-drawn.
const ALREADY_DRAWN_REASON = 'Diese Konkurrenz ist bereits ausgelost.'
const reasonFor = (error: DrawError): string =>
  error === 'AlreadyDrawn' ? ALREADY_DRAWN_REASON : DRAW_BLOCKER_REASON[error]

export type DrawOutcome = { ok: true; draw: CompetitionDraw } | { ok: false; error: DrawError; reason: string }

export interface DrawServiceDeps {
  registrationsStore: RegistrationsStore
  drawStore: DrawStore
  randomSource: RandomSource
}

// What the draw button (UI: „Jetzt auslosen") hands the service: which competition, the current phase (the gate), and the
// write timestamp (the edge owns `now`, so the orchestration stays pure-ish and testable).
export interface DrawParams {
  competition: string
  phase: Phase
  now: string
}

export const createDrawService = (deps: DrawServiceDeps) => {
  const { registrationsStore, drawStore, randomSource } = deps

  const fail = (error: DrawError): DrawOutcome => ({ ok: false, error, reason: reasonFor(error) })

  return {
    /**
     * Draw the main bracket for one competition. Gated on the shared draw preconditions (phase, count,
     * supported size) and on the field being un-drawn (ADR-0026). On success the bracket +
     * draw record are persisted atomically and the assembled CompetitionDraw is returned.
     */
    async draw({ competition, phase, now }: DrawParams): Promise<DrawOutcome> {
      const players = await registrationsStore.confirmedForDraw(competition)
      const blocker = drawBlocker(phase, players.length)
      if (blocker) return fail(blocker)
      if (await drawStore.findDraw(competition, 'main')) return fail('AlreadyDrawn')

      const size = drawSize(players.length)
      const { seeding, slots, revealSequence } = drawBracket({ players, size, random: randomSource })
      try {
        await drawStore.save({
          competition,
          bracket: 'main',
          size,
          seeding,
          revealSequence,
          matches: materializeMatches(size, slots),
          createdAt: now
        })
      } catch (err) {
        // A concurrent draw can pass the findDraw check above and then lose the race to the unique
        // (competition, bracket) index. Re-read: if a draw now exists, the loser is just "already
        // drawn" (the expected 409), not a server error — only re-throw a genuine failure.
        if (await drawStore.findDraw(competition, 'main')) return fail('AlreadyDrawn')
        throw err
      }

      // Re-read so the response is the same assembled shape the surface lists (matches carry their
      // persisted ids). We just wrote it, so a null here is a real inconsistency — surface it rather
      // than returning a draw-less success.
      const draw = await drawStore.getDraw(competition, 'main')
      if (!draw) throw new Error(`draw vanished after save for ${competition}/main`)
      return { ok: true, draw }
    }
  }
}
