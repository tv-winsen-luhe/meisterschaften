import {
  CHALLENGER_MIN_LK,
  challengerEligibility,
  type CompetitionDraw,
  drawBlocker,
  type DrawBlocker,
  DRAW_BLOCKER_REASON,
  drawBracket,
  type DrawPlayer,
  type CompetitionSlug,
  drawSize,
  isChallengerField,
  materializeMatches,
  type Phase,
  type PublicDraw,
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
  | { ok: true; draw: CompetitionDraw }
  | { ok: false; error: DrawError; reason: string; tooStrong?: TooStrongEntry[] }

// Advancing the reveal cursor (ADR-0003): pure playback over the stored sequence. The only failure is
// advancing a field that was never drawn (no reveal sequence to play) — a 404 at the route.
export type AdvanceError = 'NotDrawn'
const NOT_DRAWN_REASON = 'Diese Konkurrenz ist noch nicht ausgelost.'

export type AdvanceOutcome =
  | { ok: true; cursor: number; total: number }
  | { ok: false; error: AdvanceError; reason: string }

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
     * The public live bracket (ADR-0003): every drawn competition's main bracket reveal, **sliced to the
     * cursor** — only the steps already revealed are sent, with each one's player joined in by name + LK
     * (the reveal sequence carries only ids). The unrevealed tail never leaves the server, so a spectator
     * polling the endpoint cannot read the outcome ahead of the show — the suspense is server-enforced,
     * not a client-side display gate. Only the main bracket has a reveal show; the consolation bracket
     * publishes directly (ADR-0004).
     */
    async publicDraws(): Promise<PublicDraw[]> {
      const reveals = (await drawStore.listReveals()).filter(r => r.bracket === 'main')

      // Join names only for the revealed prefix — never read player rows for steps still to come.
      const ids = new Set<number>()
      for (const r of reveals) {
        for (const s of r.steps.slice(0, r.cursor)) if (s.playerId !== null) ids.add(s.playerId)
      }
      const players = await registrationsStore.revealPlayers([...ids])

      return reveals.map(r => ({
        // The store speaks `string`; the wire contract narrows to CompetitionSlug (the route's Zod parse
        // is the authority that rejects anything else), exactly as the match/draw projections do.
        competition: r.competition as CompetitionSlug,
        size: r.size,
        cursor: r.cursor,
        total: r.steps.length,
        // Only the revealed prefix — `cursor` ≤ total (clamped by advance), so the slice is safe.
        steps: r.steps.slice(0, r.cursor).map(s => ({
          kind: s.kind,
          position: s.position,
          seed: s.seed,
          // A lot-bye line has no player; every placed step joins its registration row. A missing id
          // (only reachable if a slot's registration was hard-deleted out from under a frozen draw)
          // degrades to null rather than throwing — the reveal still renders, that line just blank.
          player: s.playerId !== null ? (players.get(s.playerId) ?? null) : null
        }))
      }))
    }
  }
}
