// Schedule math, owned once in shared/ so the admin grid (place/move affordance) and the public
// schedule feed read one definition (CONTEXT: Schedule, ADR-0005, ADR-0040). Pure; its only dependency is
// the bracket-topology adjacency rule (ADR-0049) — the same single-source discipline as shared/draw.ts.
// This file owns the grid shape, the approximate slot time, match numbering, feeder *resolution* (against
// topology's `winnerFeeders` / `winnerTarget` / `semifinalPositions`), and `validatePlacement` (block the
// impossible, warn the unwise — ADR-0033).
import { bracketDepth, semifinalPositions, winnerFeeders, winnerTarget, type BracketPosition } from './bracket-topology'

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
  curfewMinutes: 22 * 60,
  // The minimum comfortable rest between a player's two matches (ADR-0040), in minutes — a fixed bound to
  // confirm with the organizer nearer the event, not computed. A rest gap (`nextStart − previousEnd`)
  // under this raises a soft, overridable warning; an actual interval overlap is the harder „one person,
  // two courts" block, not this nudge.
  minRestMinutes: 60
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

// The minimal shape the backlog predicate reads — a match carries a court only once placed on the grid.
interface MaybePlaced {
  court: number | null
}

/**
 * Whether a match is still in the backlog: drawn and revealed, but not yet on a court (UI: „Nicht
 * geplant"). A null court is the whole test — byes and un-revealed bracket matches are already filtered
 * out upstream before this sees them (ADR-0036). The single definition of „unplaced" the admin backlog
 * tray filters by and the publish confirm counts (#156, ADR-0041), so the count the warning names can
 * never drift from the tray the operator sees.
 */
export const isUnplaced = (match: MaybePlaced): boolean => match.court === null

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

// The minimal match shape the schedule helpers read — a bracket position with its two slot references and
// whether it is the third-place playoff (its slots are fed by the semifinal losers, not the implicit
// winner-feeders). Generic over the wire `Match` and the store row so neither has to be imported here (and
// so the helpers never depend on placement/status fields they do not need).
interface MatchPosition {
  id: number
  round: number
  position: number
  slot1RegId: number | null
  slot2RegId: number | null
  thirdPlace?: boolean
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
 * The bracket position feeding one slot of a match — the single-slot read over `bracket-topology`'s
 * `winnerFeeders` (ADR-0049): the match at (round−1, 2·position) feeds slot 1, (round−1, 2·position+1)
 * feeds slot 2. Round 1 has no feeder (its slots are drawn players or byes), so it returns null.
 */
export const feederPosition = (round: number, position: number, slot: 1 | 2): BracketPosition | null =>
  winnerFeeders(round, position)?.[slot - 1] ?? null

// What occupies one slot of a scheduled match, resolved for display: a known player (a drawn entrant,
// or a bye/result winner already advanced), an empty round-1 bye line („Freilos"), a not-yet-decided
// feeder pointing at the match whose winner fills it („Sieger M{matchNumber}"), a third-place playoff slot
// waiting on the *loser* of a semifinal („Verlierer M{matchNumber}"), or an `unknown` slot („offen") — the
// graceful degrade when a feeder cannot be resolved (ADR-0035), never a bogus feeder number. The single
// branching rule both the grid and the public feed render from — the consumers only supply the regId→name
// join.
export type SlotView =
  | { kind: 'player'; regId: number }
  | { kind: 'bye' }
  | { kind: 'feeder'; matchNumber: number }
  | { kind: 'loser'; matchNumber: number }
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
  // The third-place playoff is fed by the semifinal *losers* (`semifinalPositions`), not the implicit
  // winner-feeders the topology expresses — so an open slot names the semifinal it waits on as „Verlierer
  // M{n}", slot 1 the first semifinal, slot 2 the second. A missing semifinal degrades to „offen" like any
  // feeder.
  if (match.thirdPlace) {
    const feeder = semifinalPositions(match.round)[slot - 1]
    const semi = matchAt(feeder.round, feeder.position)
    const matchNumber = semi ? numbers.get(semi.id) : undefined
    return matchNumber ? { kind: 'loser', matchNumber } : { kind: 'unknown' }
  }
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
 * The German label for a non-player slot — „Freilos" / „Sieger M{n}" / „Verlierer M{n}" / „offen" — the
 * single copy both the admin grid and the public schedule feed render (#109). Keyed off `SlotView['kind']`;
 * the `player` line is excluded because each surface joins the name its own way (the grid resolves a regId,
 * the feed carries the joined name), so a copy change here lands on both surfaces at once. Structural, so
 * the wire `ScheduleSlot`'s non-player members satisfy it too.
 */
export const slotLabel = (slot: Exclude<SlotView, PlayerSlotKind>): string =>
  slot.kind === 'bye'
    ? 'Freilos'
    : slot.kind === 'feeder'
      ? `Sieger M${slot.matchNumber}`
      : slot.kind === 'loser'
        ? `Verlierer M${slot.matchNumber}`
        : 'offen'

// The minimal score shape `slotGames` reads — the best-of-2 + Match-Tie-Break columns, each a `[slot1,
// slot2]` pair or null. Structural, so the wire `MatchScore` satisfies it without schedule.ts importing the
// admin contract (which imports this file).
interface SlotScores {
  set1: readonly [number, number] | null
  set2: readonly [number, number] | null
  mtb: readonly [number, number] | null
}

/**
 * One slot's games across the three sets, in order — e.g. `[6, 4, 10]` for the games (or MTB points) that
 * slot won. An unplayed set contributes nothing, so a not-yet-started (or walkover) match yields `[]` and a
 * mid-match with one saved set yields just that set (ADR-0032 §20). The single source both the admin
 * results surface (`scoreFor`) and the public live board join into a score line (#91) — each surface picks
 * its own separator, so the „which games" rule can never drift between them.
 */
export const slotGames = (score: SlotScores, slot: 1 | 2): number[] =>
  [score.set1, score.set2, score.mtb].map(pair => (pair ? pair[slot - 1] : null)).filter((n): n is number => n !== null)

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

// The German round name for a bracket match — the single copy both the admin grid card and the public
// schedule card render (#142), so „Achtelfinale" reads identically on both surfaces. Read from the *end*
// of the bracket (Finale, Halbfinale, …) so a 4-, 8-, or 16-draw shares one list: `totalRounds` is the
// bracket's own depth (its highest round, derived from its match set), so the final is always
// `totalRounds` and a deeper-than-Achtelfinale round falls back to „Runde N".
const ROUND_NAMES_FROM_FINAL = ['Finale', 'Halbfinale', 'Viertelfinale', 'Achtelfinale'] as const

// One match's place in its bracket, for `roundLabel`. `bracket` is the discriminator string (main /
// consolation), kept as `string` like the other helpers here so no module has to import the Bracket type.
export interface RoundLabelInput {
  bracket: string
  round: number
  totalRounds: number
  // The third-place placement match (de: „Spiel um Platz 3") — a fixed playoff, not a round, so it reads
  // its own label rather than a round name (CONTEXT: Third-place match). Defaults false.
  thirdPlace?: boolean
}

/**
 * The German round label for a bracket match — Achtelfinale … Finale for the **main** bracket (by the
 * bracket's own depth), a „Nebenrunde · …" form for the **consolation** bracket (so a consolation final
 * never reads as the real one, ADR-0004), and „Spiel um Platz 3" for the third-place match. The single
 * definition both the admin grid card and the public schedule card render (#142), replacing the
 * admin-only `roundLabel`.
 */
export const roundLabel = ({ bracket, round, totalRounds, thirdPlace = false }: RoundLabelInput): string => {
  if (thirdPlace) return 'Spiel um Platz 3'
  const name = ROUND_NAMES_FROM_FINAL[totalRounds - round] ?? `Runde ${round}`
  return bracket === 'consolation' ? `Nebenrunde · ${name}` : name
}

// The bracket's depth (its highest round) is `bracketDepth`, homed in `bracket-topology` (ADR-0049) and
// re-exported through the shared barrel — the `totalRounds` both surface cards hand `roundLabel` (#142) and
// the last round the finals-day rule reserves for Sunday (ADR-0040). This file reads it for `isFinalsDayMatch`.

// ── Public draw ↔ schedule join (#159) ────────────────────────────────────────────────────────────

// The minimal placed-match shape the public-draw annotation reads: a bracket node addressed by its
// topology (competition+bracket+round+position) plus the grid cell it sits on. Structural, so the wire
// `ScheduleMatch` satisfies it without schedule.ts importing the admin contract (which imports this file).
interface ScheduledNode {
  competition: string
  bracket: string
  round: number
  position: number
  court: number
  day: number
  slot: number
}

// Court + approximate start time for one bracket node — the annotation the public draw renders under a
// matchup („Platz 3 · Sa ca. 14:00"). `court` and `day` are the grid cell; `time` is the bare „HH:MM"
// slotTime (the „ca." plan-not-promise qualifier, ADR-0032, is page copy). The day *label* also stays at
// the edge (the page maps day → „Sa"/„So"); this carries only the index.
export interface NodeSchedule {
  court: number
  day: number
  time: string
}

/**
 * The topology address of a bracket node — `(competition, bracket, round, position)` joined — the key both
 * a schedule match and a public draw node resolve to. The join keys on **topology, not match-number**: the
 * public draw feed is position-addressed (its node at column r, match m is round r+1, position m), so the
 * schedule's own round/position is what they meet on, never a match number threaded between the surfaces.
 */
export const scheduleNodeKey = (competition: string, bracket: string, round: number, position: number): string =>
  `${competition}|${bracket}|${round}|${position}`

/**
 * Index placed schedule matches by bracket topology (`scheduleNodeKey`) so the public draw can annotate
 * each matchup with its court + approximate time without opening the separate /spielplan page (#159). The
 * draw is position-addressed and a later round resolves through the schedule's own round/position the same
 * way, so round-1 and deeper matches index identically. Pass the matches the schedule feed serves — the
 * publish gate and reveal cursor already filter it, so an unplaced or withheld match is simply absent from
 * the input and yields no entry, and the bracket reads cleanly without it.
 */
export const indexScheduleByNode = (matches: readonly ScheduledNode[]): Map<string, NodeSchedule> => {
  const index = new Map<string, NodeSchedule>()
  for (const m of matches)
    index.set(scheduleNodeKey(m.competition, m.bracket, m.round, m.position), {
      court: m.court,
      day: m.day,
      time: slotTime(m.day, m.slot)
    })
  return index
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
  // The third-place playoff, fed by the semifinal losers — its feeder chain is the two semifinals, not the
  // implicit winner-feeders, so `earliestPlaceableSlot` and `validatePlacement` route it specially.
  thirdPlace?: boolean
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
//  - `player-overlap`: a player in the candidate would be in two time-overlapping matches at once — one
//    person, two courts, physically impossible (ADR-0040). Now expressible thanks to the interval model;
//    it bites when a round-1 loser drops into the consolation bracket the same day. `regId` is the shared
//    player, `otherMatchId` the match they already hold.
export type HardViolation =
  | { rule: 'feeder-order'; otherMatchId: number }
  | { rule: 'court-taken'; otherMatchId: number }
  | { rule: 'court-window' }
  | { rule: 'player-overlap'; regId: number; otherMatchId: number }

// A **soft** violation — a player-comfort or scheduling-shape concern the operator may override (ADR-0033).
//  - `player-load`: the player would hold more than 2 matches on the candidate's day. `count` is the total.
//  - `short-rest`: the player's rest between two same-day matches (`nextStart − previousEnd`) would be under
//    `minRestMinutes` (ADR-0040). It only covers non-overlapping matches — an actual overlap is the hard
//    `player-overlap` block, not a rest nudge. `otherMatchId` is the player's other match.
//  - `finals-day`: a main-bracket semifinal or final placed off Sunday (the last event day). Sunday is
//    finals day (ADR-0040), so an earlier placement is nudged — never blocked; a final *may* be played on
//    Saturday. `round` is the candidate's round (the surface phrases the reminder from it). The rule value
//    is English (CLAUDE.md — wire/data values); the German term survives only in the user-facing copy.
export type SoftViolation =
  | { rule: 'player-load'; regId: number; count: number }
  | { rule: 'short-rest'; regId: number; otherMatchId: number }
  | { rule: 'finals-day'; round: number }

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
// last slot. The structural feeder floor (`earliestPlaceableSlot` vs `here`) is ordered against it.
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
    const feeders = winnerFeeders(round, position)
    if (!feeders) return 0
    let max = 0
    for (const fp of feeders) {
      const feeder = byPosition.get(`${fp.round}-${fp.position}`)
      if (!feeder || feeder.outcome === 'bye') continue
      max = Math.max(max, SLOT_SPAN + depth(fp.round, fp.position))
    }
    return max
  }

  // The third-place playoff is fed by the two semifinals (`semifinalPositions`) — the losers, not the
  // implicit winner-feeders — so its floor is one full interval after the deeper semifinal's own chain.
  if (match.thirdPlace) {
    let max = 0
    for (const { round, position } of semifinalPositions(match.round)) {
      const semi = byPosition.get(`${round}-${position}`)
      if (!semi || semi.outcome === 'bye') continue
      max = Math.max(max, SLOT_SPAN + depth(round, position))
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

// Whether a match is a main-bracket semifinal or final — the rounds reserved for the finals day (Sunday)
// (ADR-0040): `round ≥ depth − 1`, main bracket only (the consolation bracket and earlier rounds carry no
// preference). The `bracket === 'main'` guard comes first, so a consolation match skips the depth scan
// entirely. The single predicate `targetDay` (auto-suggest) and `validatePlacement` (the soft nudge)
// share, so the plan the suggest builds and the warnings it raises can never disagree. Exported so the
// auto-suggest (shared/suggest-schedule.ts) reads the very same finals-day predicate this file's soft rule does.
export const isFinalsDayMatch = (match: PlacedMatch, matches: readonly PlacedMatch[]): boolean =>
  match.bracket === 'main' &&
  match.round >=
    bracketDepth(matches.filter(m => m.competition === match.competition && m.bracket === match.bracket)) - 1

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
  for (const fp of winnerFeeders(self.round, self.position) ?? []) {
    const feeder = at(fp.round, fp.position)
    if (feeder && !endsBefore(feeder, candidate.placement)) hard.push({ rule: 'feeder-order', otherMatchId: feeder.id })
  }
  const target = winnerTarget(self.round, self.position)
  const successor = at(target.round, target.position)
  if (successor && !endsBefore(candidate.placement, successor))
    hard.push({ rule: 'feeder-order', otherMatchId: successor.id })

  // Hard — the third-place playoff's loser-feeders (`semifinalPositions`, not the implicit winner-feeders
  // the topology yields). The playoff cannot start until both feeding semifinals' 90 minutes are over;
  // conversely a semifinal must end before a placed playoff starts. The structural floor above already
  // guards against *unplaced* semifinals; this binds the candidate to where they (or the playoff) are
  // actually placed, both ways.
  if (self.thirdPlace) {
    for (const { round, position } of semifinalPositions(self.round)) {
      const semi = at(round, position)
      if (semi && !endsBefore(semi, candidate.placement)) hard.push({ rule: 'feeder-order', otherMatchId: semi.id })
    }
  } else {
    const thirdPlace = placed.find(
      m => m.thirdPlace && m.competition === self.competition && m.bracket === self.bracket
    )
    if (
      thirdPlace &&
      semifinalPositions(thirdPlace.round).some(s => s.round === self.round && s.position === self.position) &&
      !endsBefore(candidate.placement, thirdPlace)
    ) {
      hard.push({ rule: 'feeder-order', otherMatchId: thirdPlace.id })
    }
  }

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

  // Soft — finals day (ADR-0040): the main bracket's semifinals and final belong on Sunday (the last event
  // day). Placed earlier they are nudged, never blocked — a final *may* be played on Saturday, it is just
  // not the plan. The same `isFinalsDayMatch` predicate the auto-suggest's `targetDay` reads, so the plan
  // and the warnings agree.
  if (isFinalsDayMatch(self, matches) && day !== SCHEDULE.days - 1) soft.push({ rule: 'finals-day', round: self.round })

  // Hard + soft — per named player (an undecided feeder/bye slot is null and carries no clash/load yet).
  // The interval model makes "one person on two courts at once" expressible for the first time, so it is a
  // hard block; the comfort concerns (too little rest, too many matches) stay soft (ADR-0040).
  const players = [self.slot1RegId, self.slot2RegId].filter((r): r is number => r !== null)
  for (const regId of players) {
    const sameDay = placed.filter(m => m.day === day && (m.slot1RegId === regId || m.slot2RegId === regId))
    // Soft — more than 2 matches for this player on the candidate's day.
    const load = sameDay.length + 1
    if (load > 2) soft.push({ rule: 'player-load', regId, count: load })
    // Per other same-day match (the filter already pins the day, so a plain slot delta is the start-time
    // gap in minutes): a 90-minute interval overlap is the hard "two courts at once" block; once the
    // intervals clear, an under-`minRestMinutes` rest gap (`nextStart − previousEnd`) is a soft nudge.
    for (const m of sameDay) {
      const rest = Math.abs(slot - m.slot) * SCHEDULE.slotMinutes - SCHEDULE.matchMinutes
      if (rest < 0) hard.push({ rule: 'player-overlap', regId, otherMatchId: m.id })
      else if (rest < SCHEDULE.minRestMinutes) soft.push({ rule: 'short-rest', regId, otherMatchId: m.id })
    }
  }

  return { hard, soft }
}
