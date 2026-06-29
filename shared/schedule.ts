// Schedule math, owned once in shared/ so the admin grid (place/move affordance) and the public
// schedule feed read one definition (CONTEXT: Schedule, ADR-0005, ADR-0040). Pure, no deps — the same
// single-source discipline as shared/draw.ts. This file owns the grid shape, the approximate slot time,
// match numbering, feeder resolution, and `validatePlacement` (block the impossible, warn the unwise —
// ADR-0033).

// The courts×time grid the operator places matches on (ADR-0005, ADR-0040). A match is a fixed
// **90 minutes**, but its **start** is set on a **30-minute** cadence, so a `slot` is a 30-minute index
// (a match spans three steps — SLOT_SPAN — and reserves its court for the interval [start, start+90)).
// Each event day has its own first start (both currently 9:00), so `slotTime` is day-aware. The
// numeric shape lives here (the single source both clients size the grid from); the day *labels*
// („Samstag 22.08.") stay in src/data/tournament.ts, the home of the event's date copy. Per-court evening
// windows below make the grid lopsided — the floodlit pair reach later than the dark four (ADR-0040) —
// but the grid height stays uniform (slotsPerDay), the dark courts' late cells disabled.
export const SCHEDULE = {
  courts: 6,
  days: 2,
  // The fixed match length and the start cadence, in minutes. A match spans `matchMinutes / slotMinutes`
  // slots (SLOT_SPAN).
  matchMinutes: 90,
  slotMinutes: 30,
  // 30-minute start slots per day: 9:00 → 20:30 (the latest start the floodlit courts 5 & 6 allow before
  // the 22:00 quiet-hours curfew) at a 30-minute cadence = 24 slots. A uniform grid height for both days;
  // the per-court evening windows (below) gate which of those rows each court may actually take.
  slotsPerDay: 24,
  // Minutes-from-midnight of each day's first start — both days open at the earliest 9:00 per the
  // organizer. Indexed by the event day (0 = Saturday, 1 = Sunday) and read by `slotTime`, so a per-day
  // start stays expressible (ADR-0040) even though the two are equal today.
  dayStartMinutes: [9 * 60, 9 * 60],
  // The floodlit courts (ADR-0040): only courts 5 & 6 have lights, so only they may run on into the dark.
  // They are the overflow valve for a packed Saturday, reaching the 22:00 curfew while the four dark
  // courts must clear in daylight.
  floodlitCourts: [5, 6],
  // Per-court evening windows as fixed clock bounds (minutes from midnight), to be confirmed with the
  // organizer nearer the event (ADR-0040) — deliberately NOT computed from sunset. A match's 90 minutes
  // must *finish* by its court's bound: the four dark courts clear by ~20:00 in daylight (last start
  // 18:30); the floodlit pair may run to the 22:00 quiet-hours curfew (last start 20:30).
  daylightEndMinutes: 20 * 60,
  curfewMinutes: 22 * 60
} as const

// The number of 30-minute slots a 90-minute match spans on the grid — three. A placement reserves its
// court for `[slot, slot + SLOT_SPAN)`, so two same-court matches overlap when their starts are fewer
// than SLOT_SPAN steps apart, and a feeder's 90 minutes are over SLOT_SPAN steps after it starts.
export const SLOT_SPAN = SCHEDULE.matchMinutes / SCHEDULE.slotMinutes

// The grid axes, materialized once so both clients iterate the same ranges: courts are 1-indexed (the
// operator and the public speak „Platz 1"), days and slots are 0-indexed (array/grid coordinates).
export const COURT_NUMBERS: readonly number[] = Array.from({ length: SCHEDULE.courts }, (_, i) => i + 1)
export const DAY_INDICES: readonly number[] = Array.from({ length: SCHEDULE.days }, (_, i) => i)
export const SLOT_INDICES: readonly number[] = Array.from({ length: SCHEDULE.slotsPerDay }, (_, i) => i)

// One match's placement on the grid: a court (1..courts) and a slot (day 0..days−1 + slot index
// 0..slotsPerDay−1). The three travel together — a half-placed match is meaningless — so the store and
// the contract treat them as one all-or-nothing unit (null ⇒ unscheduled, in the backlog).
export interface Placement {
  court: number
  day: number
  slot: number
}

// Minutes-from-midnight of a (day, slot) start — the single arithmetic both `slotTime` (the „ca." label)
// and the evening-window check read, so a clock time and its window bound never drift apart. Day-aware
// via `dayStartMinutes` (ADR-0040); an out-of-range day falls back to the first day's start, never NaN.
const slotStartMinutes = (day: number, slot: number): number =>
  (SCHEDULE.dayStartMinutes[day] ?? SCHEDULE.dayStartMinutes[0]) + slot * SCHEDULE.slotMinutes

/**
 * The approximate clock time of a (day, slot) on the grid, "HH:MM" (24h). Times are explicitly a plan,
 * shown „ca." — the live truth is the match status, not a rewritten time (ADR-0032). Day-aware via
 * `dayStartMinutes` (ADR-0040), so each day can carry its own first start; both days currently open at
 * 9:00, so slot 0 = 09:00, slot 1 = 09:30, … at the 30-minute cadence. An out-of-range day falls back to
 * the first day's start rather than producing NaN.
 */
export const slotTime = (day: number, slot: number): string => {
  const total = slotStartMinutes(day, slot)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Whether a court is floodlit (courts 5 & 6, ADR-0040) — the only courts that may run on past daylight.
// `.some` rather than `.includes` so the `as const` tuple's literal element type doesn't reject a plain
// `number` argument.
export const isFloodlit = (court: number): boolean => SCHEDULE.floodlitCourts.some(c => c === court)

// The latest clock minute (from midnight) a match may *finish* on a court (ADR-0040): the floodlit pair
// (5 & 6) may run to the 22:00 curfew, the four dark courts must clear by the ~20:00 daylight bound.
export const courtEndMinutes = (court: number): number =>
  isFloodlit(court) ? SCHEDULE.curfewMinutes : SCHEDULE.daylightEndMinutes

/**
 * Whether a (court, day, slot) start respects that court's evening window (ADR-0040): the match's fixed
 * 90 minutes must finish by the court's end bound — daylight ~20:00 on the four dark courts, the 22:00
 * curfew on the floodlit pair (5 & 6). The hard `court-window` rule (the server-side authority) and the
 * grid's drop-target gating both read this, so a dark court's late cell is unplaceable on both surfaces.
 */
export const withinEveningWindow = (court: number, day: number, slot: number): boolean =>
  slotStartMinutes(day, slot) + SCHEDULE.matchMinutes <= courtEndMinutes(court)

// The minimal match shape the schedule helpers read — a bracket position with its two slot references.
// Generic over the wire `Match` and the store row so neither has to be imported here (and so the
// helpers never depend on placement/status fields they do not need).
interface MatchPosition {
  id: number
  round: number
  position: number
  slot1RegId: number | null
  slot2RegId: number | null
}

/**
 * Stable per-bracket match numbers (M1, M2, …) by (round asc, position asc), so a feeder reference
 * („Sieger M3") reads the same on the admin grid and the public schedule. The caller passes one
 * bracket's matches; the result maps each match id to its 1-based number. Round-major: round 1's
 * matches are M1..M(size/2), so a later-round match's feeders are always lower-numbered.
 */
export const numberMatches = (matches: MatchPosition[]): Map<number, number> => {
  const ordered = [...matches].sort((a, b) => a.round - b.round || a.position - b.position)
  const numbers = new Map<number, number>()
  ordered.forEach((m, i) => numbers.set(m.id, i + 1))
  return numbers
}

/**
 * The bracket position feeding one slot of a match (feeders are implicit, ADR-0025): the match at
 * (round−1, 2·position) feeds slot 1, (round−1, 2·position+1) feeds slot 2. Round 1 has no feeder
 * (its slots are drawn players or byes), so it returns null.
 */
export const feederPosition = (
  round: number,
  position: number,
  slot: 1 | 2
): { round: number; position: number } | null =>
  round <= 1 ? null : { round: round - 1, position: position * 2 + (slot === 1 ? 0 : 1) }

// What occupies one slot of a scheduled match, resolved for display: a known player (a drawn entrant,
// or a bye/result winner already advanced), an empty round-1 bye line („Freilos"), a not-yet-decided
// feeder pointing at the match whose winner fills it („Sieger M{matchNumber}"), or an `unknown` slot
// („offen") — the graceful degrade when a feeder cannot be resolved (ADR-0035), never a bogus feeder
// number. The single branching rule both the grid and the public feed render from — the consumers only
// supply the regId→name join.
export type SlotView =
  | { kind: 'player'; regId: number }
  | { kind: 'bye' }
  | { kind: 'feeder'; matchNumber: number }
  | { kind: 'unknown' }

/**
 * Resolve one slot of a match to its display view. A filled slot reference is a known player
 * (whatever the round — a round-1 entrant, or a winner already advanced into a later round). An empty
 * round-1 slot is a bye line. An empty later-round slot is an undecided feeder; `matchAt` finds the
 * feeding match so `numbers` can label it „Sieger M{n}". A feeder with no resolvable match degrades to
 * `unknown` („offen", ADR-0035): the bracket is materialized whole at draw time, so this is an
 * inconsistency (e.g. a row hard-deleted under a frozen draw), and the feed serves it rather than
 * emitting a bogus number that would 500 the whole response.
 */
export const viewSlot = (
  match: MatchPosition,
  slot: 1 | 2,
  numbers: Map<number, number>,
  matchAt: (round: number, position: number) => MatchPosition | undefined
): SlotView => {
  const regId = slot === 1 ? match.slot1RegId : match.slot2RegId
  if (regId !== null) return { kind: 'player', regId }
  if (match.round <= 1) return { kind: 'bye' }
  const fp = feederPosition(match.round, match.position, slot)
  const feeder = fp ? matchAt(fp.round, fp.position) : undefined
  const matchNumber = feeder ? numbers.get(feeder.id) : undefined
  return matchNumber ? { kind: 'feeder', matchNumber } : { kind: 'unknown' }
}

// The discriminant of SlotView's resolved-player member, named so `slotLabel` can Exclude it: the repo's
// `no-restricted-syntax` lint rule bans an inline object type in a generic argument (no
// `Exclude<SlotView, { kind: 'player' }>`) and mandates an explicit interface reference instead.
interface PlayerSlotKind {
  kind: 'player'
}

/**
 * The German label for a non-player slot — „Freilos" / „Sieger M{n}" / „offen" — the single copy both
 * the admin grid and the public schedule feed render (#109). Keyed off `SlotView['kind']`; the `player`
 * line is excluded because each surface joins the name its own way (the grid resolves a regId, the feed
 * carries the joined name), so a copy change here lands on both surfaces at once. Structural, so the
 * wire `ScheduleSlot`'s non-player members satisfy it too.
 */
export const slotLabel = (slot: Exclude<SlotView, PlayerSlotKind>): string =>
  slot.kind === 'bye' ? 'Freilos' : slot.kind === 'feeder' ? `Sieger M${slot.matchNumber}` : 'offen'

// One bracket match resolved for display: its stable number and the two SlotViews. Generic over the
// caller's match row (the wire `Match`, the store row) so each keeps its own placement/status fields.
export interface ResolvedMatch<M extends MatchPosition> {
  match: M
  number: number
  slot1: SlotView
  slot2: SlotView
}

/**
 * Resolve a whole bracket's matches to their display views in one pass — the single per-bracket
 * pipeline both the admin grid (`gridMatches`) and the public schedule feed (`schedule()`) read (#109),
 * so match numbers, feeders („Sieger M{n}"), byes, and the „offen" degrade resolve identically on both.
 * Pass one bracket's *full* match set (numbering and feeders are stable only over the whole bracket);
 * read back, per match, its 1-based number and two resolved SlotViews. The consumers add only their own
 * regId→name join and the placement/reveal filtering on top.
 */
export const resolveBracket = <M extends MatchPosition>(matches: M[]): ResolvedMatch<M>[] => {
  const numbers = numberMatches(matches)
  const byPosition = new Map<string, M>()
  for (const m of matches) byPosition.set(`${m.round}-${m.position}`, m)
  const matchAt = (round: number, position: number) => byPosition.get(`${round}-${position}`)
  return matches.map(m => ({
    match: m,
    number: numbers.get(m.id) ?? 0,
    slot1: viewSlot(m, 1, numbers, matchAt),
    slot2: viewSlot(m, 2, numbers, matchAt)
  }))
}

// ── Placement validation (ADR-0033: block the impossible, warn the unwise) ────────────────────────

// The minimal match shape `validatePlacement` reads: a bracket position (so feeders resolve within the
// right competition+bracket), its two player slots, and its current grid cell (null ⇒ in the backlog).
// The wire `Match` and the store row both satisfy this structurally — neither has to be imported here.
interface PlacedMatch {
  id: number
  competition: string
  bracket: string
  round: number
  position: number
  slot1RegId: number | null
  slot2RegId: number | null
  outcome: string | null
  court: number | null
  day: number | null
  slot: number | null
}

// A **hard** violation — a physically impossible state the placement endpoint blocks (ADR-0033).
//  - `feeder-order`: the candidate would start before a match it depends on by round has finished — a
//    feeder whose 90 minutes are not yet over, or a successor it must finish before. `otherMatchId` is
//    the conflicting match.
//  - `court-taken`: the candidate's 90-minute interval overlaps another match already on its court — two
//    matches cannot share one court at one time. Occupancy is **interval overlap** (starts fewer than
//    SLOT_SPAN steps apart), not a shared cell (ADR-0040). `otherMatchId` is the match already there.
//    With `court` bounded to the six courts, this also makes "more matches running at once than courts"
//    structurally impossible (ADR-0033 — the grid's court rows make the court cap structural).
//  - `court-window`: the candidate's 90 minutes would run past its court's evening window — the four dark
//    courts must finish by ~20:00 daylight, the floodlit pair by the 22:00 curfew (ADR-0040). It is about
//    the candidate's own cell, not a clash with another match, so it carries no `otherMatchId`.
export type HardViolation =
  | { rule: 'feeder-order'; otherMatchId: number }
  | { rule: 'court-taken'; otherMatchId: number }
  | { rule: 'court-window' }

// A **soft** violation — a player-load comfort concern the operator may override (ADR-0033).
//  - `player-load`: the player would hold more than 2 matches on the candidate's day. `count` is the total.
//  - `back-to-back`: the player would play two matches in adjacent same-day slots, with no rest gap.
export type SoftViolation =
  | { rule: 'player-load'; regId: number; count: number }
  | { rule: 'back-to-back'; regId: number; otherMatchId: number }

export interface PlacementValidation {
  hard: HardViolation[]
  soft: SoftViolation[]
}

// The match being placed: its `id` (it must appear in the `matches` set so its bracket position and
// players are known) and the proposed grid cell.
export interface PlacementCandidate {
  id: number
  placement: Placement
}

// Day-major slot ordinal across the whole event, so a later day's slot 0 sorts after an earlier day's
// last slot. The one ordering the structural feeder floor and the rest gap read from.
export const absoluteSlot = (day: number, slot: number): number => day * SCHEDULE.slotsPerDay + slot

// A point on the grid's day-major time axis — the minimal shape `endsBefore` compares (the candidate
// placement and any placed match both satisfy it structurally).
interface DaySlot {
  day: number
  slot: number
}

// Whether interval `a`'s 90 minutes are over by the time interval `b` starts — the day-aware feeder-order
// relation (ADR-0040). A match never spans midnight, so any earlier day trivially clears (the overnight
// gap dwarfs 90 minutes); the SLOT_SPAN gap only bites *within* one day. Reasoning on `absoluteSlot`
// alone would wrongly leak a late match's interval across the day boundary (day d's slot 0 sits one step
// after day d−1's last slot), spuriously blocking a legal next-morning successor.
const endsBefore = (a: DaySlot, b: DaySlot): boolean =>
  a.day < b.day || (a.day === b.day && a.slot + SLOT_SPAN <= b.slot)

/**
 * The earliest absolute slot a match may occupy, given its bracket's feeder structure. Equals the
 * longest chain of **real** (non-bye) feeder matches below it, each chain link costing a full
 * 90-minute interval (SLOT_SPAN steps) since a match cannot start until its feeder's 90 minutes are
 * over (ADR-0040). A round-1 bye is never scheduled (CONTEXT: Bye), so it contributes no depth; a match
 * fed entirely through byes stays at 0.
 *
 * Reused by `validatePlacement` (structural feeder-order guard, even against unplaced feeders) and by
 * the grid (proactive grey-out of too-early cells while a match is held).
 */
export const earliestPlaceableSlot = (match: PlacedMatch, matches: readonly PlacedMatch[]): number => {
  const byPosition = new Map<string, PlacedMatch>()
  for (const m of matches) {
    if (m.competition === match.competition && m.bracket === match.bracket)
      byPosition.set(`${m.round}-${m.position}`, m)
  }

  const depth = (round: number, position: number): number => {
    if (round <= 1) return 0
    let max = 0
    for (const which of [1, 2] as const) {
      const fp = feederPosition(round, position, which)!
      const feeder = byPosition.get(`${fp.round}-${fp.position}`)
      if (!feeder || feeder.outcome === 'bye') continue
      max = Math.max(max, SLOT_SPAN + depth(fp.round, fp.position))
    }
    return max
  }

  return depth(match.round, match.position)
}

/**
 * Validate placing one match (the candidate `id`) into a grid cell, against every other match's
 * placement — the single definition of "is this placement sound" (ADR-0033), reused two ways
 * (the ADR-0011 `challengerEligibility` pattern): the place endpoint enforces `hard` as the
 * server-side authority, and the admin grid surfaces `hard` (blocked drops) and `soft` (overridable
 * warnings) as live affordance. Pure and deterministic — no I/O, no clock.
 *
 * `matches` is every match (the candidate included, at its *current* cell); the candidate is reasoned
 * about at the proposed `placement`, the others at their stored cells, so the same call serves both a
 * place-from-backlog and a move. Rests on the one-active-entry invariant (CONTEXT.md): a regId is one
 * person, so player load is a plain count with no cross-field clash to resolve.
 */
// The minimal match shape `suggestSchedule` reads — the same as `PlacedMatch`, reused so the caller
// passes one array to both validation and auto-suggest.
export type { PlacedMatch as SchedulableMatch }

/**
 * Auto-suggest a draft schedule: fill unplaced matches into grid cells, respecting all hard
 * constraints (via `validatePlacement`) and preferring cells without soft warnings. Already-placed
 * matches are treated as fixed — never moved. Deterministic (no clock, no randomness): same input
 * → same plan. Returns only the newly suggested placements (the caller applies them as a draft).
 *
 * Algorithm: greedily assign each unplaced match (round asc, position asc — so round 1 packs from
 * the top) into the first valid cell (day-major, slot within day, court ascending). A cell is
 * "valid" if `validatePlacement` returns zero hard violations. Among valid cells, the one with
 * zero soft warnings wins; if all have warnings, the first valid cell wins. This is a simple
 * greedy fill — not a global optimizer — per the issue spec.
 */
export const suggestSchedule = (matches: readonly PlacedMatch[]): { id: number; placement: Placement }[] => {
  const result: { id: number; placement: Placement }[] = []

  // Mutable working copy: as we suggest placements, we apply them so subsequent candidates see them.
  const working: PlacedMatch[] = matches.map(m => ({ ...m }))

  // Unplaced matches, sorted for deterministic greedy fill: round 1 first, then by position.
  const unplaced = working
    .filter(m => m.court === null && m.outcome !== 'bye')
    .sort((a, b) => a.round - b.round || a.position - b.position)

  for (const match of unplaced) {
    let bestPlacement: Placement | null = null
    let bestHasSoft = true

    // Try every cell in day-major order (day 0 before day 1, slot 0 before slot 1, court 1 before court 2).
    for (let day = 0; day < SCHEDULE.days; day++) {
      for (let slot = 0; slot < SCHEDULE.slotsPerDay; slot++) {
        for (let court = 1; court <= SCHEDULE.courts; court++) {
          const placement: Placement = { court, day, slot }
          const { hard, soft } = validatePlacement(working, { id: match.id, placement })
          if (hard.length > 0) continue
          if (soft.length === 0) {
            // Perfect cell — use it immediately (first soft-free cell in day-major order).
            bestPlacement = placement
            bestHasSoft = false
            break
          }
          if (bestPlacement === null) {
            // First valid cell (has warnings) — record as fallback.
            bestPlacement = placement
          }
        }
        if (bestPlacement && !bestHasSoft) break
      }
      if (bestPlacement && !bestHasSoft) break
    }

    if (bestPlacement) {
      // Apply placement to the working set so subsequent matches see this as occupied.
      const idx = working.findIndex(m => m.id === match.id)
      working[idx] = { ...working[idx], court: bestPlacement.court, day: bestPlacement.day, slot: bestPlacement.slot }
      result.push({ id: match.id, placement: bestPlacement })
    }
  }

  return result
}

export const validatePlacement = (
  matches: readonly PlacedMatch[],
  candidate: PlacementCandidate
): PlacementValidation => {
  const hard: HardViolation[] = []
  const soft: SoftViolation[] = []

  // The candidate must be among `matches` for its round/position/players to be known. An unknown id is
  // the caller's contract violation (the id schema guards it), not a state to reason about.
  const self = matches.find(m => m.id === candidate.id)
  if (!self) return { hard, soft }

  const { day, slot } = candidate.placement
  const here = absoluteSlot(day, slot)

  // The other matches that already hold a cell — the candidate at its proposed cell is judged against these.
  const placed = matches.filter(
    (m): m is PlacedMatch & { court: number; day: number; slot: number } =>
      m.id !== candidate.id && m.court !== null && m.day !== null && m.slot !== null
  )
  const at = (round: number, position: number) =>
    placed.find(
      m =>
        m.competition === self.competition && m.bracket === self.bracket && m.round === round && m.position === position
    )

  // Hard — structural feeder-chain depth: the candidate cannot sit below its earliest placeable slot,
  // even when its feeders are still in the backlog. This is the structural form of the feeder-order
  // rule — it prevents placing a later-round match so early that its feeders would have nowhere to fit.
  const earliest = earliestPlaceableSlot(self, matches)
  if (here < earliest) hard.push({ rule: 'feeder-order', otherMatchId: self.id })

  // Hard — round dependency against *placed* feeders/successors, both directions, reasoning in 90-minute
  // intervals (ADR-0040): each placed feeder's 90 minutes must be over before the candidate starts, and
  // the candidate's must be over before a placed successor starts. Day-aware (see `endsBefore`) so a
  // late-evening feeder never wrongly blocks its next-morning successor.
  for (const which of [1, 2] as const) {
    const fp = feederPosition(self.round, self.position, which)
    const feeder = fp && at(fp.round, fp.position)
    if (feeder && !endsBefore(feeder, candidate.placement)) hard.push({ rule: 'feeder-order', otherMatchId: feeder.id })
  }
  const successor = at(self.round + 1, Math.floor(self.position / 2))
  if (successor && !endsBefore(candidate.placement, successor))
    hard.push({ rule: 'feeder-order', otherMatchId: successor.id })

  // Hard — court occupancy by interval overlap (ADR-0040): a 90-minute match reserves its court for
  // [slot, slot + SLOT_SPAN), so two same-day matches on one court conflict when their starts are fewer
  // than SLOT_SPAN steps apart. With `court` bounded to the six courts, this also makes "more matches
  // running at once than courts" impossible without ever counting (ADR-0033).
  const { court } = candidate.placement
  const taken = placed.find(m => m.court === court && m.day === day && Math.abs(m.slot - slot) < SLOT_SPAN)
  if (taken) hard.push({ rule: 'court-taken', otherMatchId: taken.id })

  // Hard — per-court evening window (ADR-0040): the dark courts 1–4 must finish in daylight by ~20:00,
  // the floodlit pair 5 & 6 may run to the 22:00 curfew. A start whose 90 minutes spill past the court's
  // bound is physically unplayable, so it blocks — the same "block the impossible" posture as court
  // occupancy and feeder order, not a soft nudge.
  if (!withinEveningWindow(court, day, slot)) hard.push({ rule: 'court-window' })

  // Soft — per named player (an undecided feeder/bye slot is null and carries no load yet).
  const players = [self.slot1RegId, self.slot2RegId].filter((r): r is number => r !== null)
  for (const regId of players) {
    const sameDay = placed.filter(m => m.day === day && (m.slot1RegId === regId || m.slot2RegId === regId))
    const load = sameDay.length + 1
    if (load > 2) soft.push({ rule: 'player-load', regId, count: load })
    const adjacent = sameDay.find(m => Math.abs(m.slot - slot) === 1)
    if (adjacent) soft.push({ rule: 'back-to-back', regId, otherMatchId: adjacent.id })
  }

  return { hard, soft }
}
