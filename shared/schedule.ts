// Schedule math, owned once in shared/ so the admin grid (place/move affordance) and the public
// schedule feed read one definition (CONTEXT: Schedule, ADR-0005). Pure, no deps — the same single-
// source discipline as shared/draw.ts. This epic's tracer (#88) owns the grid shape, the approximate
// slot time, match numbering, and feeder resolution; schedule *validation* (block the impossible, warn
// the unwise — ADR-0033) layers `validatePlacement` onto this file in #89.

// The courts×time grid the operator places matches on (ADR-0005). Fixed 90-minute slots from a 9:00
// first slot, six slots a day across both event days — defaulted to the existing
// src/data/tournament.ts assumption, to be confirmed with the organizer before the weekend. The
// numeric shape lives here (the single source both clients size the grid from); the day *labels*
// („Samstag 22.08.") stay in src/data/tournament.ts, the home of the event's date copy.
export const SCHEDULE = {
  courts: 6,
  slotsPerDay: 6,
  days: 2,
  // Minutes-from-midnight of the first slot (09:00) and the fixed slot length — the two numbers
  // `slotTime` turns a slot index into an approximate clock time from.
  firstSlotMinutes: 9 * 60,
  slotMinutes: 90
} as const

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

/**
 * The approximate clock time of a slot index, "HH:MM" (24h). Times are explicitly a plan, shown „ca."
 * — the live truth is the match status, not a rewritten time (ADR-0032). Slot 0 = 09:00, slot 1 =
 * 10:30, … at the fixed 90-minute cadence. Independent of the day: each day starts at the first slot.
 */
export const slotTime = (slot: number): string => {
  const total = SCHEDULE.firstSlotMinutes + slot * SCHEDULE.slotMinutes
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

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
//  - `feeder-order`: the candidate would share or precede the slot of a match it depends on by round —
//    a match it feeds, or one whose winner feeds it. `otherMatchId` is the conflicting match.
//  - `court-taken`: the candidate's court+day+slot cell already holds another match — two matches cannot
//    share one court at one time. `otherMatchId` is the match already there. With `court` bounded to the
//    six courts, this also makes "more matches in a slot than courts" structurally impossible (ADR-0033 —
//    the grid's court rows make the court cap structural).
export type HardViolation =
  | { rule: 'feeder-order'; otherMatchId: number }
  | { rule: 'court-taken'; otherMatchId: number }

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
// last slot. The one ordering both the feeder rule (strictly after) and the rest gap read from.
export const absoluteSlot = (day: number, slot: number): number => day * SCHEDULE.slotsPerDay + slot

/**
 * The earliest absolute slot a match may occupy, given its bracket's feeder structure. Equals the depth
 * of the longest chain of **real** (non-bye) feeder matches below it: a round-1 bye is never scheduled
 * (CONTEXT: Bye), so it contributes no depth. A match fed entirely through byes stays at 0.
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
      max = Math.max(max, 1 + depth(fp.round, fp.position))
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

  // Hard — round dependency against *placed* feeders/successors, both directions:
  // the candidate must be strictly after each placed feeder, and strictly before a placed successor.
  for (const which of [1, 2] as const) {
    const fp = feederPosition(self.round, self.position, which)
    const feeder = fp && at(fp.round, fp.position)
    if (feeder && here <= absoluteSlot(feeder.day, feeder.slot))
      hard.push({ rule: 'feeder-order', otherMatchId: feeder.id })
  }
  const successor = at(self.round + 1, Math.floor(self.position / 2))
  if (successor && here >= absoluteSlot(successor.day, successor.slot))
    hard.push({ rule: 'feeder-order', otherMatchId: successor.id })

  // Hard — court occupancy: at most one match per court+day+slot cell (the public schedule and the admin
  // grid both render a cell as a single match). With `court` bounded to the six courts, this also makes
  // "more matches in a slot than courts" impossible without ever counting (ADR-0033).
  const { court } = candidate.placement
  const taken = placed.find(m => m.court === court && m.day === day && m.slot === slot)
  if (taken) hard.push({ rule: 'court-taken', otherMatchId: taken.id })

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
