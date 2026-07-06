import {
  CHALLENGER_MIN_LK,
  challengerEligibility,
  type CompetitionDraw,
  type ConsolationBlocker,
  CONSOLATION_BLOCKER_REASON,
  consolationBlocker,
  consolationEntrants,
  drawBlocker,
  type DrawBlocker,
  DRAW_BLOCKER_REASON,
  drawBracket,
  drawConsolationBracket,
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
// tests. Main bracket, full or non-full field (§31 byes), sizes 4/8/16.

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
  { ok: true; draw: CompetitionDraw } | { ok: false; error: DrawError; reason: string; tooStrong?: TooStrongEntry[] }

// Drawing the consolation bracket (de: „Nebenrunde auslosen", ADR-0004): the failures are exactly the
// shared ConsolationBlocker (main not drawn, no consolation at this size, already drawn, first matches
// still pending) — so the client's disabled-button reason reads the same rule the server enforces
// (ADR-0011). On success the assembled consolation draw is returned like the main draw.
export type ConsolationOutcome =
  { ok: true; draw: CompetitionDraw } | { ok: false; error: ConsolationBlocker; reason: string }

// What „Nebenrunde auslosen" hands the service: which competition, and the write timestamp (the edge owns
// `now`, keeping the orchestration testable). No Challenger cap — the entrants already cleared it at the
// main draw.
export interface ConsolationParams {
  competition: string
  now: string
}

// Advancing the reveal cursor (ADR-0003): pure playback over the stored sequence. The only failure is
// advancing a field that was never drawn (no reveal sequence to play) — a 404 at the route.
export type AdvanceError = 'NotDrawn'
const NOT_DRAWN_REASON = 'Diese Konkurrenz ist noch nicht ausgelost.'

export type AdvanceOutcome =
  { ok: true; cursor: number; total: number } | { ok: false; error: AdvanceError; reason: string }

// Which way the operator moves the reveal cursor: forward reveals the next lot, back corrects one.
export type AdvanceDirection = 'forward' | 'back'

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

      // The re-run guard (ADR-0026, ADR-0003): a draw is final the moment it is revealed. While it is
      // computed but unrevealed (cursor 0, nothing public) the operator may discard and re-draw — the
      // only legitimate "repeat", a fresh roll. Once the first lot is revealed (cursor > 0, the show is
      // live) the draw is frozen and the re-run is refused. The existing draw is dropped only *after*
      // every precondition below passes (the new bracket is valid), so a refused re-draw never wipes a
      // standing unrevealed draw.
      const existing = await drawStore.findDraw(competition, 'main')
      if (existing && existing.revealCursor > 0) return fail('AlreadyDrawn')

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
          createdAt: now,
          // Break-glass replace: the re-draw is known valid (all guards passed), so swap the standing
          // unrevealed draw out atomically inside the save (ADR-0026) — never a separate delete that a
          // failed save could leave behind.
          replace: existing !== null
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
    },

    /**
     * Advance (or rewind) the main bracket's reveal cursor by one step (ADR-0003). Pure playback: it
     * reads the stored reveal sequence, clamps the new cursor to [0, total], and persists it — it never
     * re-rolls. The cursor is the same whether it moved or hit a bound (forward at `total`, back at 0),
     * so the operator can step idempotently. NotDrawn when the field has no draw yet.
     */
    async advance(competition: string, direction: AdvanceDirection): Promise<AdvanceOutcome> {
      const reveal = await drawStore.getReveal(competition, 'main')
      if (!reveal) return { ok: false, error: 'NotDrawn', reason: NOT_DRAWN_REASON }

      const total = reveal.steps.length
      const next = reveal.cursor + (direction === 'forward' ? 1 : -1)
      const cursor = Math.max(0, Math.min(total, next))
      if (cursor !== reveal.cursor) await drawStore.setCursor(competition, 'main', cursor)
      return { ok: true, cursor, total }
    },

    /**
     * Draw the consolation bracket for one competition (de: „Nebenrunde auslosen", ADR-0004). Gated by the
     * shared `consolationBlocker` (main drawn, size ≥ 8, not already drawn, every first match decided) —
     * the same rule the button's disabled reason reads (ADR-0011). Its entrants are the lost-their-first-
     * match set (`consolationEntrants`) resolved to the field's seeded players (a subset of the main field,
     * so filtering the seeded list keeps them strongest-first). The pure `drawConsolationBracket` reuses the
     * draw procedure — seeded by LK, with byes, unbiased — and it is **published directly** (empty reveal
     * sequence, no reveal show). The matches then schedule and record exactly like main-bracket matches.
     */
    async drawConsolation({ competition, now }: ConsolationParams): Promise<ConsolationOutcome> {
      // The main draw (for the gate + entrants) and the "already drawn?" check are independent reads — run
      // them together rather than serially.
      const [mainDraw, existingConsolation] = await Promise.all([
        drawStore.getDraw(competition, 'main'),
        drawStore.findDraw(competition, 'consolation')
      ])
      const blocker = consolationBlocker(
        mainDraw && { size: mainDraw.size, matches: mainDraw.matches },
        existingConsolation !== null
      )
      if (blocker) return { ok: false, error: blocker, reason: CONSOLATION_BLOCKER_REASON[blocker] }

      // The gate passed, so mainDraw is non-null. The entrants are ids in the main bracket; resolve them to
      // the field's seeded players by filtering `confirmedForDraw` (already strongest-first), so the subset
      // stays in seeding order for the draw. A registration hard-deleted from under the frozen draw would
      // drop out here (ADR-0035) — the < 2 guard then refuses (the same reason the shared gate already
      // returned as `too-few-entrants`) rather than forming a broken bracket.
      const entrantIds = new Set(consolationEntrants(mainDraw!.matches))
      const players = (await registrationsStore.confirmedForDraw(competition)).filter(p => entrantIds.has(p.id))
      if (players.length < 2) {
        return { ok: false, error: 'too-few-entrants', reason: CONSOLATION_BLOCKER_REASON['too-few-entrants'] }
      }

      const { size, seeding, matches } = drawConsolationBracket(players, randomSource)
      try {
        await drawStore.save({
          competition,
          bracket: 'consolation',
          size,
          seeding,
          // Published directly, no reveal show (ADR-0004): an empty reveal sequence is the "no reveal"
          // representation — it reads as fully revealed, so every surface treats the bracket as ready.
          revealSequence: [],
          matches,
          // No Challenger cap on the consolation — its entrants already cleared the main draw's cap.
          challengerMinLk: null,
          createdAt: now
        })
      } catch (err) {
        // A concurrent trigger can pass the findDraw check above and then lose the race to the unique
        // (competition, bracket) index. Re-read: if a consolation draw now exists, the loser is just
        // "already drawn", not a server error — only re-throw a genuine failure.
        if (await drawStore.findDraw(competition, 'consolation'))
          return { ok: false, error: 'already-drawn', reason: CONSOLATION_BLOCKER_REASON['already-drawn'] }
        throw err
      }

      const draw = await drawStore.getDraw(competition, 'consolation')
      if (!draw) throw new Error(`consolation draw vanished after save for ${competition}`)
      return { ok: true, draw }
    }
  }
}
