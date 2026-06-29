import {
  type CompetitionSlug,
  isFullyRevealed,
  type Match,
  type PublicDraw,
  type ResolvedMatch,
  resolveBracket,
  type ScheduleMatch,
  type ScheduleSlot,
  type SlotView
} from '../shared'
import type { DrawStore } from './store/draw'
import type { RegistrationsStore } from './store/registrations'

// The draw read-model (ADR-0025): the public projections over the drawn state — the live bracket and
// the schedule feed. Split from the draw orchestration (worker/draw.ts): that module *mutates* state
// (draw + advance, the write side, with the RandomSource), this one only *reads and reshapes* it for
// the public surfaces. The two share the same DrawStore + RegistrationsStore ports and know nothing of
// each other; the composition root wires them independently. Read features (the consolation bracket
// reveal, the live board) land here, not in the draw service.
//
// Both methods enforce the reveal-cursor suspense invariant — the unrevealed tail never leaves the
// server (publicDraws slices to the cursor, ADR-0003; schedule gates on a fully-revealed draw,
// ADR-0036) — so a spectator polling these endpoints can never read the outcome ahead of the show.

export interface ProjectionsDeps {
  drawStore: DrawStore
  registrationsStore: RegistrationsStore
}

export const createProjections = (deps: ProjectionsDeps) => {
  const { drawStore, registrationsStore } = deps

  // Every competition's main-bracket reveal state. The one fetch+filter both projections share — the live
  // bracket needs them all (it slices each to its cursor), the schedule feed keeps only the fully-revealed
  // ones (ADR-0036). The fully-revealed gate (isFullyRevealed) is *not* shared — it is schedule-only — so
  // it stays at the call site, not in here. The consolation bracket has no reveal show (ADR-0004), so it
  // never appears.
  const mainReveals = async () => (await drawStore.listReveals()).filter(r => r.bracket === 'main')

  return {
    /**
     * The public live bracket (ADR-0003): every drawn competition's main bracket reveal, **sliced to the
     * cursor** — only the steps already revealed are sent, with each one's player joined in by name + LK
     * (the reveal sequence carries only ids). The unrevealed tail never leaves the server, so a spectator
     * polling the endpoint cannot read the outcome ahead of the show — the suspense is server-enforced,
     * not a client-side display gate. Only the main bracket has a reveal show; the consolation bracket
     * publishes directly (ADR-0004).
     */
    async publicDraws(): Promise<PublicDraw[]> {
      const reveals = await mainReveals()

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
    },

    /**
     * The public schedule (ADR-0005): every **placed** match across all competitions, with its slots
     * resolved for display. Numbering and feeder resolution run over each bracket's *full* match set
     * (so „Sieger M3" is stable), then only the placed, real matches are emitted — a bye is auto-resolved
     * and never played, so it is never scheduled. Player names are joined like publicDraws; a feeder shows
     * its match number, a round-1 bye line shows „Freilos". The live board (#91) reads the same feed.
     */
    async schedule(): Promise<ScheduleMatch[]> {
      // Two independent reads on a user-facing path: the placed matches and the reveal states hit different
      // tables with no dependency between them, so fetch them together rather than sequentially.
      const [all, reveals] = await Promise.all([drawStore.listMatches(), mainReveals()])

      // Honor the main reveal cursor (ADR-0036): a placed `main` match leaves the server only once its
      // competition's draw is fully revealed — the schedule feed must not leak pairings ahead of the reveal
      // show, the same suspense invariant publicDraws() enforces by slicing to the cursor (ADR-0003). A
      // rewound bracket drops below `total` and its matches vanish again. The consolation bracket has no
      // reveal show (ADR-0004), so it carries no gate. Fail closed: a `main` match whose competition has no
      // reveal record (unreachable for a real draw) stays hidden.
      const revealedMain = new Set(
        reveals.filter(r => isFullyRevealed({ cursor: r.cursor, total: r.steps.length })).map(r => r.competition)
      )
      const revealed = (m: Match) => m.bracket !== 'main' || revealedMain.has(m.competition)

      // Group by competition+bracket, then resolve each bracket's numbering + slot views *once* (not
      // per placed match) through the shared per-bracket resolver — the same pipeline the admin grid
      // reads (#109). Numbering and feeder resolution depend only on the bracket, so the result is keyed
      // by match id for the per-placed-match emit below.
      const groups = new Map<string, Match[]>()
      for (const m of all) {
        const key = `${m.competition}|${m.bracket}`
        const group = groups.get(key) ?? []
        group.push(m)
        groups.set(key, group)
      }
      const resolved = new Map<number, ResolvedMatch<Match>>()
      for (const group of groups.values()) {
        for (const r of resolveBracket(group)) resolved.set(r.match.id, r)
      }

      // Join names only for the players actually shown — the placed matches' filled slots.
      const placed = all.filter(
        m => m.court !== null && m.day !== null && m.slot !== null && m.outcome !== 'bye' && revealed(m)
      )
      const ids = new Set<number>()
      for (const m of placed) {
        if (m.slot1RegId !== null) ids.add(m.slot1RegId)
        if (m.slot2RegId !== null) ids.add(m.slot2RegId)
      }
      const players = await registrationsStore.revealPlayers([...ids])

      // Resolve one slot's SlotView (shared rule) into the wire shape, joining the player name. Both ways a
      // referent can vanish under a frozen draw degrade to the same honest „offen" line (`unknown`,
      // ADR-0035), never a whole-feed 500 and never the „Freilos" free-pass lie: a named player with no row
      // (a registration hard-deleted), and a feeder the shared rule could not resolve. „Freilos" is reserved
      // for a true round-1 bye, where there genuinely is no opponent.
      const toSlot = (view: SlotView): ScheduleSlot => {
        if (view.kind === 'player') {
          const p = players.get(view.regId)
          return p ? { kind: 'player', firstName: p.firstName, lastName: p.lastName } : { kind: 'unknown' }
        }
        if (view.kind === 'feeder') return { kind: 'feeder', matchNumber: view.matchNumber }
        if (view.kind === 'unknown') return { kind: 'unknown' }
        return { kind: 'bye' }
      }

      return placed.map(m => {
        const r = resolved.get(m.id)!
        return {
          id: m.id,
          competition: m.competition,
          bracket: m.bracket,
          number: r.number,
          // Non-null by the `placed` filter; the contract narrows the nullable columns.
          court: m.court!,
          day: m.day!,
          slot: m.slot!,
          status: m.status,
          slot1: toSlot(r.slot1),
          slot2: toSlot(r.slot2)
        }
      })
    }
  }
}
