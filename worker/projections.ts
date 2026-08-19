import {
  bracketDepth,
  type CompetitionDraw,
  type CompetitionSlug,
  clubSchema,
  isCancelledCompetition,
  isFullyRevealed,
  type LiveBracket,
  type LiveBracketSlot,
  type Match,
  type PublicCompetitionBracket,
  type PublicDraw,
  redactLiveBracket,
  redactRevealDraw,
  type ResolvedMatch,
  resolveBracket,
  type ScheduleMatch,
  type ScheduleSlot,
  type SlotView,
  strengthRedacted,
  winningSlot
} from '../shared'
import type { Club } from '../shared'
import type { AppStateStore } from './store/app-state'
import type { DrawStore } from './store/draw'
import type { RegistrationsStore, RevealPlayer } from './store/registrations'

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
  appStateStore: AppStateStore
}

// The public schedule feed (ADR-0041): the publish flag plus the matches the spectator may see. When the
// flag is off the page shows „noch nicht veröffentlicht" and `matches` carries no planned reveal (only
// live truth — a running/done match — survives the gate, which today is empty until #90/#91).
export interface ScheduleFeed {
  published: boolean
  matches: ScheduleMatch[]
}

// Resolve one fully-revealed competition+bracket draw into its live wire shape (ADR-0046): the `matches`
// aggregate run through the shared `resolveBracket` (the same resolver the schedule feed and admin grid
// read), with each filled slot joined to its player name + LK, a seeded player's seed number, and the
// winning slot mapped from `winnerRegId`. Feeders („Sieger M{n}"), losers („Verlierer M{n}"), byes, and the
// „offen" degrade (ADR-0035) ride through as their SlotView kinds — the client renders the label. This is
// the after-reveal interpretation `resolveBracket(matches)` gives, replacing the during-reveal reveal
// steps (CONTEXT: Revealed bracket). `players` is the shared name join built once across all live fields.
const buildLiveBracket = (draw: CompetitionDraw, players: Map<number, RevealPlayer>): LiveBracket => {
  // The seed number a placed player carries (from the frozen seeding), so a seed keeps its badge as it
  // advances round by round — mirroring how the reveal show marks a bye-winner's seed forward.
  const seedByPlayer = new Map(draw.seeding.map(s => [s.playerId, s.seed]))
  const toSlot = (view: SlotView): LiveBracketSlot => {
    if (view.kind === 'player') {
      const p = players.get(view.regId)
      // A named slot with no registration row (only reachable if a row was hard-deleted under a frozen
      // draw) degrades to „offen" like the schedule feed, never a whole-feed 500 (ADR-0035).
      return p
        ? {
            kind: 'player',
            firstName: p.firstName,
            lastName: p.lastName,
            lk: p.lk,
            seed: seedByPlayer.get(view.regId) ?? null
          }
        : { kind: 'unknown' }
    }
    if (view.kind === 'feeder') return { kind: 'feeder', matchNumber: view.matchNumber }
    if (view.kind === 'loser') return { kind: 'loser', matchNumber: view.matchNumber }
    if (view.kind === 'unknown') return { kind: 'unknown' }
    return { kind: 'bye' }
  }
  const matches = resolveBracket(draw.matches).map(({ match: m, number, slot1, slot2 }) => ({
    round: m.round,
    position: m.position,
    thirdPlace: m.thirdPlace,
    number,
    // The winning slot (1/2) the page bolds (CONTEXT: Bracket topology) — null while undecided, or when the
    // winner is neither slot (a hard-deleted registration, ADR-0035). Same rule the schedule feed reads.
    winner: winningSlot(m),
    // The result on the bracket's **own** wire (ADR-0070): status, outcome and score travel here rather
    // than being joined off the schedule feed, because this feed is gated on the reveal cursor alone while
    // the schedule is gated on the publish flag (ADR-0041). Joining them would silently couple a recorded
    // result to a plan the operator can reset — the cheap change ADR-0070 exists to forbid.
    status: m.status,
    // A round-1 bye is bracket structure, not a result a cell reports („Freilos" already says it), so the
    // store's `bye` outcome degrades to null for the wire's entered-outcome enum — the same mapping the
    // schedule feed makes.
    outcome: m.outcome === 'bye' ? null : m.outcome,
    score: m.score,
    slot1: toSlot(slot1),
    slot2: toSlot(slot2)
  }))
  // The un-redacted base: `redactLiveBracket` flips `redacted` to true (and nulls the slots) for a
  // protected field; a championship field ships as built (ADR-0048).
  return { size: draw.size, totalRounds: bracketDepth(draw.matches), redacted: false, matches }
}

export const createProjections = (deps: ProjectionsDeps) => {
  const { drawStore, registrationsStore, appStateStore } = deps

  // Every competition's main-bracket reveal state. The one fetch+filter both projections share — the live
  // bracket needs them all (it slices each to its cursor), the schedule feed keeps only the fully-revealed
  // ones (ADR-0036). The fully-revealed gate (isFullyRevealed) is *not* shared — it is schedule-only — so
  // it stays at the call site, not in here. The consolation bracket has no reveal show (ADR-0004), so it
  // never appears.
  const mainReveals = async () => (await drawStore.listReveals()).filter(r => r.bracket === 'main')

  // What a reveal step shows of a player: the name and the frozen LK, and nothing else the shared join type
  // happens to carry. Named rather than inlined so the reveal wire's shape is stated in one place.
  const revealStepPlayer = (p: RevealPlayer | undefined) =>
    p ? { firstName: p.firstName, lastName: p.lastName, lk: p.lk } : undefined

  // The full main-bracket reveal, sliced to each field's cursor (ADR-0003): every drawn competition's reveal
  // with the revealed prefix's players joined in by name + LK (the reveal sequence carries only ids). The
  // unrevealed tail never leaves the server, so a spectator cannot read the outcome ahead of the show — the
  // suspense is server-enforced. Both public and operator reads build on this; the public one redacts
  // protected fields on top (ADR-0044). Only the main bracket has a reveal show; the consolation bracket
  // publishes directly (ADR-0004).
  const buildReveals = async (): Promise<PublicDraw[]> => {
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
      // The un-redacted base, which both reveals ship as-is today (no field is redacted, ADR-0061).
      // publicDraws passes it through `strengthRedacted` first, which would flip this to true.
      redacted: false,
      // Only the revealed prefix — `cursor` ≤ total (clamped by advance), so the slice is safe.
      steps: r.steps.slice(0, r.cursor).map(s => ({
        kind: s.kind,
        position: s.position,
        seed: s.seed,
        // A lot-bye line has no player; every placed step joins its registration row. A missing id
        // (only reachable if a slot's registration was hard-deleted out from under a frozen draw)
        // degrades to null rather than throwing — the reveal still renders, that line just blank.
        //
        // Projected field by field rather than handed over whole: the join type is shared with the
        // schedule feed, which needs the `club` for its crest (#309), and a reveal step shows a name and an
        // LK. A spread here would put every field a *different* surface later needs onto this wire by
        // accident, which is how a wire grows a field nobody decided to publish.
        player: s.playerId !== null ? (revealStepPlayer(players.get(s.playerId)) ?? null) : null
      }))
    }))
  }

  return {
    /**
     * The public bracket (ADR-0046), a **two-phase** projection switched per competition on its main
     * bracket's reveal cursor:
     *   - **while revealing** (`cursor < total`) — the cursor-sliced reveal steps, unchanged (ADR-0003):
     *     the unrevealed tail never leaves the server. Strength travels with them (LK + seed), so the
     *     draw is checkable live; a redacted field would lose both here (none is today, ADR-0061).
     *   - **once fully revealed** — the resolved main bracket (+ „Spiel um Platz 3") and, the moment it is
     *     drawn (no reveal show, ADR-0004), the resolved consolation bracket, both from the `matches`
     *     aggregate (ADR-0025) so winners advance to the champion. The gate is full-reveal **only**, never
     *     the schedule publish flag — a recorded result is reality (ADR-0032), not the plan (ADR-0041).
     *     The live wire reads the same `strengthRedacted` decision as the reveal, on both brackets.
     *
     * The Access-free endpoint the off-site bracket polls; the operator's beamer reads the reveal-only
     * operatorDraws() under Access, which never redacts whatever this one decides (ADR-0044).
     */
    async publicDraws(): Promise<PublicCompetitionBracket[]> {
      // Three independent reads: the cursor-sliced reveal build (the revealing phase), the full draw set
      // (a fully-revealed field resolves its live bracket from the matches aggregate), and the cancelled
      // set. No dependency between them on a user-facing path, so fetch together.
      const [reveals, draws, cancelled] = await Promise.all([
        buildReveals(),
        drawStore.listDraws(),
        appStateStore.getCancelledCompetitions()
      ])
      const revealByComp = new Map(reveals.map(r => [r.competition, r]))

      // The drawn brackets per competition. `listDraws` returns one entry per competition+bracket; the
      // **main** bracket's reveal cursor is the per-competition phase switch (a consolation only ever
      // exists once its main is fully revealed, so it never appears in the revealing phase).
      const mainByComp = new Map<CompetitionSlug, CompetitionDraw>()
      const consolationByComp = new Map<CompetitionSlug, CompetitionDraw>()
      for (const d of draws) {
        // A cancelled competition leaves the wire here, server-side (ADR-0062 §4): the flag is *read*, not
        // re-derived, and it is read on the draw set rather than inside `buildReveals` — that build is
        // shared with the never-filtered operatorDraws (ADR-0044), and gating the public wire on the draw
        // set drops both phases of the two-phase bracket together (a revealing field only reaches the
        // response through `mainByComp`). The cost is a name join for a field about to be discarded, on a
        // path where a cancelled competition is normally unreachable anyway — a drawn field cannot be
        // cancelled and a cancelled one cannot be drawn. The filter stands regardless, because the
        // projection owes the same answer as every other wire whatever the write side let through.
        if (isCancelledCompetition(cancelled, d.competition)) continue
        if (d.bracket === 'main') mainByComp.set(d.competition, d)
        else if (d.bracket === 'consolation') consolationByComp.set(d.competition, d)
      }

      // Join names once across every live field's filled slots (both brackets) — the resolved bracket shows
      // the player, unlike the reveal which ships only its revealed prefix (already joined by buildReveals).
      const ids = new Set<number>()
      for (const main of mainByComp.values()) {
        if (!isFullyRevealed(main)) continue
        const consolation = consolationByComp.get(main.competition)
        for (const m of [...main.matches, ...(consolation?.matches ?? [])]) {
          if (m.slot1RegId !== null) ids.add(m.slot1RegId)
          if (m.slot2RegId !== null) ids.add(m.slot2RegId)
        }
      }
      const players = await registrationsStore.revealPlayers([...ids])

      const brackets: PublicCompetitionBracket[] = []
      for (const [competition, main] of mainByComp) {
        // The one strength decision this field's public wire carries, read once and applied the same way in
        // both phases below (CONTEXT: Strength redaction). False for every competition today (ADR-0061).
        const redact = strengthRedacted(competition)
        if (!isFullyRevealed(main)) {
          // Revealing: the cursor-sliced reveal steps — the suspense invariant (ADR-0003).
          const reveal = revealByComp.get(competition)
          if (reveal) brackets.push({ phase: 'revealing', ...(redact ? redactRevealDraw(reveal) : reveal) })
          continue
        }
        // Live: resolve the main bracket (+ third place) and, once drawn, the consolation from the matches
        // aggregate (ADR-0025), applying the same decision to both.
        const mainBracket = buildLiveBracket(main, players)
        const consolationDraw = consolationByComp.get(competition)
        const consolationBracket = consolationDraw ? buildLiveBracket(consolationDraw, players) : null
        brackets.push({
          phase: 'live',
          competition: main.competition,
          main: redact ? redactLiveBracket(mainBracket) : mainBracket,
          consolation: consolationBracket && redact ? redactLiveBracket(consolationBracket) : consolationBracket
        })
      }
      return brackets
    },

    /**
     * The operator's full main-bracket reveal (ADR-0044): the same cursor slice and suspense invariant as
     * publicDraws(), but **never** redacted, so the beamer draw show always keeps the LK + seed it needs to
     * run a draw (ADR-0024). Served only under Access (GET /api/admin/draw/reveal). With no field redacted
     * today it agrees with publicDraws step for step (ADR-0061); it stays as the seam that would diverge.
     */
    async operatorDraws(): Promise<PublicDraw[]> {
      return buildReveals()
    },

    /**
     * The public schedule (ADR-0005, ADR-0041): the publish flag plus every **placed** match the
     * spectator may see, with its slots resolved for display. Numbering and feeder resolution run over each
     * bracket's *full* match set (so „Sieger M3" is stable), then only the placed, real matches are emitted
     * — a bye is auto-resolved and never played, so it is never scheduled. Player names are joined like
     * publicDraws; a feeder shows its match number, a round-1 bye line shows „Freilos".
     *
     * The publish gate is a **plan** gate, not a blanket feed kill (ADR-0041): when unpublished, a
     * still-`planned` match's forward-looking placement is withheld (no leak), but a `running`/`done`
     * match's actual court + status are current truth and are served regardless — load-bearing for the
     * live board (#91), which must never be blanked out from under a running match.
     */
    async schedule(): Promise<ScheduleFeed> {
      // Four independent reads on a user-facing path: placed matches, reveal states, the publish flag and
      // the cancelled set hit different tables with no dependency between them, so fetch them together
      // rather than serially.
      const [allMatches, reveals, draws, published, cancelled] = await Promise.all([
        drawStore.listMatches(),
        mainReveals(),
        drawStore.listDraws(),
        appStateStore.getSchedulePublished(),
        appStateStore.getCancelledCompetitions()
      ])

      // A cancelled competition leaves the feed server-side (ADR-0062 §4), before numbering and slot
      // resolution — the board must show no match for a field that does not take place, and dropping the
      // matches here keeps the „Sieger M{n}" numbering of the remaining fields untouched.
      const all = allMatches.filter(m => !isCancelledCompetition(cancelled, m.competition))

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
      // Each bracket's depth (its highest round) — the `totalRounds` the shared `roundLabel` reads from
      // the end (so the final is always `totalRounds`). Derived per group from the full match set, then
      // keyed by competition+bracket for the per-placed-match emit.
      const totalRoundsByGroup = new Map<string, number>()
      for (const [key, group] of groups) {
        for (const r of resolveBracket(group)) resolved.set(r.match.id, r)
        totalRoundsByGroup.set(key, bracketDepth(group))
      }

      // Join names only for the players actually shown — the placed matches' filled slots. A still-
      // `planned` match needs the publish flag; a `running`/`done` match is live truth and passes the gate
      // regardless (the plan gate, ADR-0041), so a started match is never blanked when the flag is off.
      const placed = all.filter(
        m =>
          m.court !== null &&
          m.day !== null &&
          m.slot !== null &&
          m.outcome !== 'bye' &&
          revealed(m) &&
          (published || m.status !== 'planned')
      )
      const ids = new Set<number>()
      for (const m of placed) {
        if (m.slot1RegId !== null) ids.add(m.slot1RegId)
        if (m.slot2RegId !== null) ids.add(m.slot2RegId)
      }
      const players = await registrationsStore.revealPlayers([...ids])

      // The seed a placed player carries, keyed by the bracket they are placed in — the same per-bracket
      // frozen seeding `buildLiveBracket` reads, so a player wears the same number on the schedule row and
      // in the bracket cell rather than two surfaces deriving it differently (#309). A strength-redacted
      // field yields no seeds at all: the schedule is a public wire like any other, and a new surface must
      // not become the hole a withheld field leaks through (ADR-0048, ADR-0061).
      const seedByGroupPlayer = new Map<string, number>()
      for (const d of draws) {
        if (strengthRedacted(d.competition)) continue
        for (const s of d.seeding) seedByGroupPlayer.set(`${d.competition}|${d.bracket}|${s.playerId}`, s.seed)
      }

      // The club behind the crest, narrowed at the one point the registrations table's untyped text becomes
      // a typed wire value. An unrecognised club degrades to null — no crest beats the wrong crest, and the
      // feed serves either way (ADR-0035).
      const toClub = (club: string): Club | null => clubSchema.safeParse(club).data ?? null

      // Resolve one slot's SlotView (shared rule) into the wire shape, joining the player name. Both ways a
      // referent can vanish under a frozen draw degrade to the same honest „offen" line (`unknown`,
      // ADR-0035), never a whole-feed 500 and never the „Freilos" free-pass lie: a named player with no row
      // (a registration hard-deleted), and a feeder the shared rule could not resolve. „Freilos" is reserved
      // for a true round-1 bye, where there genuinely is no opponent.
      const toSlot = (view: SlotView, match: Match): ScheduleSlot => {
        if (view.kind === 'player') {
          const p = players.get(view.regId)
          return p
            ? {
                kind: 'player',
                firstName: p.firstName,
                lastName: p.lastName,
                club: toClub(p.club),
                seed: seedByGroupPlayer.get(`${match.competition}|${match.bracket}|${view.regId}`) ?? null
              }
            : { kind: 'unknown' }
        }
        if (view.kind === 'feeder') return { kind: 'feeder', matchNumber: view.matchNumber }
        if (view.kind === 'loser') return { kind: 'loser', matchNumber: view.matchNumber }
        if (view.kind === 'unknown') return { kind: 'unknown' }
        return { kind: 'bye' }
      }

      const matches = placed.map(m => {
        const r = resolved.get(m.id)!
        // The winning **slot** (1/2) the page bolds (CONTEXT: Bracket topology) — null when the match is
        // undecided, or when the winner is neither slot (only reachable if a slot's registration was
        // hard-deleted under a frozen draw, ADR-0035).
        const winner = winningSlot(m)
        return {
          id: m.id,
          competition: m.competition,
          bracket: m.bracket,
          number: r.number,
          round: m.round,
          // The third-place playoff marker (#90): it shares the final's round, so the page labels it from
          // this flag rather than deriving „Finale" from round === totalRounds.
          thirdPlace: m.thirdPlace,
          // The bracket position (#159) — the public draw joins each matchup to its court/time on it.
          position: m.position,
          totalRounds: totalRoundsByGroup.get(`${m.competition}|${m.bracket}`) ?? m.round,
          // The **actual** court once the match is running/done (ADR-0032): the live court captured at the
          // `running` transition, falling back to the planned court before it starts — so a spectator is
          // never sent to a stale planned court when a match moved to a freed one. The planned `court` is
          // non-null by the `placed` filter; `liveCourt` is null until the match goes running.
          court: m.liveCourt ?? m.court!,
          day: m.day!,
          slot: m.slot!,
          status: m.status,
          // The live result (#91, ADR-0032): the winning slot (above), the entered outcome, and the set
          // scores — so the board shows what happened without a second fetch. A `bye` outcome never reaches
          // here (byes are filtered above), so it degrades to null for the wire's entered-outcome enum.
          winner,
          outcome: m.outcome === 'bye' ? null : m.outcome,
          score: m.score,
          slot1: toSlot(r.slot1, m),
          slot2: toSlot(r.slot2, m)
        }
      })

      return { published, matches }
    }
  }
}
