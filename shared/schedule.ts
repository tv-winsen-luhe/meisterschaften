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
// or a bye/result winner already advanced), an empty round-1 bye line („Freilos"), or a not-yet-decided
// feeder pointing at the match whose winner fills it („Sieger M{matchNumber}"). The single branching
// rule both the grid and the public feed render from — the consumers only supply the regId→name join.
export type SlotView = { kind: 'player'; regId: number } | { kind: 'bye' } | { kind: 'feeder'; matchNumber: number }

/**
 * Resolve one slot of a match to its display view. A filled slot reference is a known player
 * (whatever the round — a round-1 entrant, or a winner already advanced into a later round). An empty
 * round-1 slot is a bye line. An empty later-round slot is an undecided feeder; `matchAt` finds the
 * feeding match so `numbers` can label it „Sieger M{n}". A feeder with no resolvable match yields
 * matchNumber 0 (an unreachable inconsistency — the bracket is materialized whole at draw time).
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
  return { kind: 'feeder', matchNumber: feeder ? (numbers.get(feeder.id) ?? 0) : 0 }
}
