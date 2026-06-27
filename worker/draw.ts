import {
  CHALLENGER_MIN_LK,
  challengerEligibility,
  type CompetitionDraw,
  drawBlocker,
  type DrawBlocker,
  DRAW_BLOCKER_REASON,
  drawBracket,
  type DrawPlayer,
  drawSize,
  isChallengerField,
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
// affordance reads the same rule, ADR-0011); `AlreadyDrawn` needs the store; `ChallengerTooStrong`
// is the hard Challenger cap binding on the frozen LKs (ADR-0024). Each maps to an operator-facing
// reason and an HTTP status at the route.
export type DrawError = DrawBlocker | 'AlreadyDrawn' | 'ChallengerTooStrong'

// A rules-compliant draw is final (ADR-0026) — a re-run is refused, not silently re-drawn.
const ALREADY_DRAWN_REASON = 'Diese Konkurrenz ist bereits ausgelost.'
const reasonFor = (error: DrawBlocker | 'AlreadyDrawn'): string =>
  error === 'AlreadyDrawn' ? ALREADY_DRAWN_REASON : DRAW_BLOCKER_REASON[error]

// The Challenger block reason — names the threshold and the offender count so the toast alone tells
// the operator what to fix; the levers are the field-wide threshold or removing the entry (ADR-0024).
const challengerReason = (count: number, threshold: number): string =>
  `Challenger-Feld kann nicht ausgelost werden: ${count} ${count === 1 ? 'Eintrag' : 'Einträge'} stärker als LK ${threshold}. Schwellwert anpassen oder Eintrag entfernen.`

// An entry too strong for the Challenger cap, returned so the operator can point at the offenders.
// Just the id (names are joined client-side from the admin list) and the frozen LK it was judged on —
// structurally the DrawPlayer the eligibility predicate already returns.
export type TooStrongEntry = DrawPlayer

export type DrawOutcome =
  | { ok: true; draw: CompetitionDraw }
  | { ok: false; error: DrawError; reason: string; tooStrong?: TooStrongEntry[] }

export interface DrawServiceDeps {
  registrationsStore: RegistrationsStore
  drawStore: DrawStore
  randomSource: RandomSource
}

// What the draw button (UI: „Jetzt auslosen") hands the service: which competition, the current phase
// (the gate), the operator-tuned Challenger cap (omitted ⇒ the CHALLENGER_MIN_LK default, ADR-0024),
// and the write timestamp (the edge owns `now`, so the orchestration stays pure-ish and testable).
export interface DrawParams {
  competition: string
  phase: Phase
  challengerMinLk?: number
  now: string
}

export const createDrawService = (deps: DrawServiceDeps) => {
  const { registrationsStore, drawStore, randomSource } = deps

  const fail = (error: DrawBlocker | 'AlreadyDrawn'): DrawOutcome => ({ ok: false, error, reason: reasonFor(error) })

  const failTooStrong = (tooStrong: DrawPlayer[], threshold: number): DrawOutcome => ({
    ok: false,
    error: 'ChallengerTooStrong',
    reason: challengerReason(tooStrong.length, threshold),
    tooStrong
  })

  return {
    /**
     * Draw the main bracket for one competition. Gated on the shared draw preconditions (phase, count,
     * supported size) and on the field being un-drawn (ADR-0026). On success the bracket +
     * draw record are persisted atomically and the assembled CompetitionDraw is returned.
     */
    async draw({ competition, phase, challengerMinLk, now }: DrawParams): Promise<DrawOutcome> {
      const players = await registrationsStore.confirmedForDraw(competition)
      const blocker = drawBlocker(phase, players.length)
      if (blocker) return fail(blocker)
      if (await drawStore.findDraw(competition, 'main')) return fail('AlreadyDrawn')

      // The Challenger cap binds here, on the frozen LKs (ADR-0024): snapshot the threshold, judge the
      // field with the shared predicate (Slice 6, the single authority), and on a violation write
      // nothing — the only levers are this field-wide threshold or removing the entry, never a
      // per-player override. Non-Challenger fields carry no cap (null snapshot).
      const isChallenger = isChallengerField(competition)
      const frozenChallengerMinLk = isChallenger ? (challengerMinLk ?? CHALLENGER_MIN_LK) : null
      if (frozenChallengerMinLk !== null) {
        const { eligible, tooStrong } = challengerEligibility(players, frozenChallengerMinLk)
        if (!eligible) return failTooStrong(tooStrong, frozenChallengerMinLk)
      }

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
          challengerMinLk: frozenChallengerMinLk,
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
