import { z } from 'zod'
import type { Phase } from './phase'
import { seedingValue } from './registration'

// Draw math, owned once in shared/ so the overview (its first consumer) and the future
// draw read the same rule (CONTEXT: Draw size / byes). Pure, no deps — ADR-0021 keeps
// the admin small, and this is the kind of single-source helper that stops the rule being
// re-derived per surface.

/**
 * The draw size for `confirmed` players: the next power of two ≥ confirmed. This is the raw bracket
 * math — 0 and 1 return 0 (no bracket). It is **not** the castable floor: a field needs ≥4 confirmed to
 * actually be drawn (drawBlocker, ADR-0034), so 2 and 3 round to a size here but are gated as too-few.
 */
export const drawSize = (confirmed: number): number => {
  if (confirmed < 2) return 0
  let size = 2
  while (size < confirmed) size *= 2
  return size
}

/** Byes: the gap between the draw size and the confirmed count (0 when no draw). */
export const byeCount = (confirmed: number): number => {
  const size = drawSize(confirmed)
  return size === 0 ? 0 : size - confirmed
}

/**
 * Matches in the main bracket: `confirmed − 1` to crown the champion (every entrant but the winner
 * loses once; a bye is not a match), plus the third-place match once a semifinal exists. From four
 * entrants up the round of four always resolves to two contested semifinals (byes only occur in
 * round one), so that playoff is exact — not an estimate.
 */
export const mainDrawMatches = (confirmed: number): number =>
  confirmed < 2 ? 0 : confirmed - 1 + (confirmed >= 4 ? 1 : 0)

/**
 * Matches in the consolation bracket (CONTEXT: Consolation bracket, ADR-0004). Its entrants are the
 * main bracket's R1 losers *plus* bye-holders who lose their first real match in R2: a bye gives a
 * player a free pass into R2, but if they lose there it was still their first match — so they enter
 * the consolation like any other first-match loser.
 *
 * Entrants = R1 losers + bye-holders who lose in R2 (worst case). The worst-case count of bye-holder
 * R2 losers is `min(byes, R2 matches)`: every R2 match can eliminate at most one bye-holder, and there
 * cannot be more bye-holder losers than there are byes. This is the planning maximum — the actual
 * count depends on match outcomes, but ±1 is irrelevant for court-load projection.
 *
 * A consolation bracket exists only when draw size ≥ 8 (ADR-0004).
 */
export const consolationMatches = (confirmed: number): number => {
  const size = drawSize(confirmed)
  if (size <= 4) return 0
  const byes = size - confirmed
  const r1Losers = confirmed - size / 2
  const r2Matches = size / 4
  const byeHolderLosers = Math.min(byes, r2Matches)
  const entrants = r1Losers + byeHolderLosers
  return entrants < 2 ? 0 : entrants - 1
}

/** Total matches a field runs: main draw + consolation (R1-loser consolation). */
export const matchCount = (confirmed: number): number => mainDrawMatches(confirmed) + consolationMatches(confirmed)

// ── Bracket structure (ADR-0025) ────────────────────────────────────────────────────────────────
// The single home for the bracket *topology* — seed lines and per-round shape — that the public
// preview's client JS (tournament-draw.astro: SEED_POS / ROUNDS) used to re-derive. The draw, the
// future draw reveal show, and the schedule validator read this one source. Feeders are implicit
// (ADR-0025): a match at (round r, position p) is fed by (r−1, 2p) and (r−1, 2p+1); the topology
// here is what yields them, so they are never stored.

// The two brackets a competition can carry (ADR-0025): the main KO tree (main bracket) and the
// consolation (consolation bracket). Stored/wire values are English (CLAUDE.md — data values are
// never the German ubiquitous-language terms); the German names live only in UI copy. This epic
// only writes `main`; `consolation` exists in the model for ADR-0004's later slice.
export const BRACKETS = ['main', 'consolation'] as const
export type Bracket = (typeof BRACKETS)[number]

// The non-score ways a match can resolve (CONTEXT: Match result). `bye` auto-resolves at draw
// time (the draw writes it for a non-full field, §31); `walkover`/`retirement` are entered during
// Live. Owned here so the `matches.outcome` column and its wire enum read one list.
export const MATCH_OUTCOMES = ['bye', 'walkover', 'retirement'] as const
export type MatchOutcome = (typeof MATCH_OUTCOMES)[number]

// A seed placement group (DTB §30.5b). A single-seed group is *fixed* (Nr. 1 → first line, Nr. 2 →
// last line); a multi-seed group is drawn *by lot* onto its prescribed lines (Nr. 3/4 onto the two
// fixed lines of a 16-draw — the lines are prescribed, the lot only decides which seed lands where).
// `lines` are 0-indexed first-round positions, ordered to match `seeds`.
export interface SeedGroup {
  seeds: number[]
  lines: number[]
}

export interface BracketStructure {
  size: number
  // Number of seeds for this size (DTB §30.5a, plus 4 → 2 by ADR-0034): 8 → 2, 16 → 4. Fields draw at 4, 8, or 16.
  seedCount: number
  // Seed placement in seed order: [Nr.1 fixed], [Nr.2 fixed], then the lot groups (Nr.3/4 …).
  seedGroups: SeedGroup[]
  // Number of rounds in the KO tree (8 → 3, 16 → 4); round r (1-based) has size / 2^r matches.
  rounds: number
}

// Seed lines per draw size, 0-indexed (DTB §30.5b). Nr. 1 → first line, Nr. 2 → last line; the
// 16-draw places Nr. 3/4 by lot onto lines 5 and 12 (0-indexed 4 and 11). Sizes 4, 8, 16 are defined —
// bracketStructure throws for anything else. Size 4 (Nr.1 → line 0, Nr.2 → line 3, both fixed, no lot)
// is our sub-DTB extension: §30.5a's table starts at 8, so a 4-field reuses the 8-field's 2-seed
// pattern (ADR-0034) — letting tiny fields (e.g. a 4-player Damen draw) be cast at all.
const SEED_GROUPS: Record<number, SeedGroup[]> = {
  4: [
    { seeds: [1], lines: [0] },
    { seeds: [2], lines: [3] }
  ],
  8: [
    { seeds: [1], lines: [0] },
    { seeds: [2], lines: [7] }
  ],
  16: [
    { seeds: [1], lines: [0] },
    { seeds: [2], lines: [15] },
    { seeds: [3, 4], lines: [4, 11] }
  ]
}

/**
 * The bracket topology for a draw `size` (a power of two ≥ 2). Throws for sizes whose seed table is
 * not defined here (i.e. anything but 4, 8, or 16 today) — a deliberate small-N guard (ADR-0021), so a
 * new size is an explicit table entry, never a silently mis-seeded bracket.
 */
export const bracketStructure = (size: number): BracketStructure => {
  const seedGroups = SEED_GROUPS[size]
  if (!seedGroups) throw new Error(`bracketStructure: unsupported draw size ${size}`)
  return {
    size,
    seedCount: seedGroups.reduce((n, g) => n + g.seeds.length, 0),
    seedGroups,
    rounds: Math.log2(size)
  }
}

/** Whether a draw of this size has a defined seed table (i.e. drawBracket won't throw). 4, 8, and 16. */
export const isSupportedDrawSize = (size: number): boolean => SEED_GROUPS[size] !== undefined

// The draw sizes that have a seed table, ascending — the sizes the draw can cast and the preview can
// render. Derived from SEED_GROUPS (numeric keys iterate ascending), so a new table entry extends both.
const SUPPORTED_DRAW_SIZES = Object.keys(SEED_GROUPS).map(Number)

/**
 * The draw size the public pre-draw preview renders for a field of `confirmed` players: `drawSize`
 * clamped to the supported range (today 4..16). Below the smallest supported size (0–3 confirmed, the
 * field is still filling) it floors to the smallest real bracket; above the largest it caps there. So
 * the preview always shows a renderable bracket that foreshadows the actual draw, sized from the
 * confirmed field — never from a competition's capacity (CONTEXT: Draw size, ADR-0034).
 *
 * This is a **render clamp, not a castability test** — deliberately broader than `drawBlocker`, which
 * *rejects* a field too small (2–3 → `too-few`, ADR-0034) or too big (17+ → `unsupported-size`). A
 * still-filling (0–3) or over-full (17+) field previews the *nearest* real bracket as a foreshadow; it
 * is not a claim the draw can be cast now (registration may be open, the field may be below the ≥4 floor,
 * or the operator must trim an over-full one). Don't reuse this where the question is "can this be
 * drawn?" — that is `drawBlocker`.
 */
export const displayDrawSize = (confirmed: number): number => {
  const min = SUPPORTED_DRAW_SIZES[0]
  const max = SUPPORTED_DRAW_SIZES[SUPPORTED_DRAW_SIZES.length - 1]
  return Math.min(Math.max(drawSize(confirmed), min), max)
}

/**
 * The provisional seed count the pre-draw surfaces show for a field of `confirmed` players: the number
 * of seeds the real draw would use at this size (`displayDrawSize` → §30.5a count: 4/8 → 2, 16 → 4).
 * One rule for the public preview and the participant list so their seed markers never disagree for the
 * same field (CONTEXT: Seeding). Note the admin seeding board uses a *stricter* count (0 for a size with
 * no seed table) — it must flag a non-castable field, where the public preview clamps to show one.
 */
export const displaySeedCount = (confirmed: number): number => bracketStructure(displayDrawSize(confirmed)).seedCount

// ── Draw gate (CONTEXT: competition lifecycle, ADR-0011/0025/0027) ─────────────────────────────
// Why a competition cannot be drawn yet. The single predicate both the worker enforces (authority)
// and the competitions surface (UI: „Konkurrenzen") renders (affordance) — defined once so the button's disabled reason
// can never drift from the server guard (the canConfirm pattern, ADR-0011). `null` = drawable.
export type DrawBlocker = 'not-tournament' | 'too-few' | 'unsupported-size'

// The operator-facing reason per blocker — one source for the server's 400 body and the button hint.
export const DRAW_BLOCKER_REASON: Record<DrawBlocker, string> = {
  'not-tournament': 'Auslosung erst nach Anmeldeschluss (Phase „Turnier").',
  'too-few': 'Mindestens vier bestätigte Anmeldungen nötig.',
  'unsupported-size': 'Aktuell nur 4er-, 8er- und 16er-Felder.'
}

/**
 * The draw gate for a competition with `confirmed` confirmed entries in the given phase: the first
 * reason it cannot be drawn, or `null` when it can. Mirrors the steps the draw needs — registration
 * closed (`tournament`), at least **four** entries, and a draw size the seed table supports (4/8/16).
 * Four is the smallest field that forms a real knockout: a 2–3 field would draw a bye-semifinal (a
 * player walks to the final, breaking the two-matches-each guarantee), so a field needs ≥4 to be cast —
 * below that the club plays it off another way, not through this KO engine (ADR-0034). Byes are no
 * longer a blocker — §31 fills a non-full field — so the remaining gates are the floor and the size
 * table (a field of 4 is a full 4-draw, 5–8 rounds to 8, 9–16 to 16; under 4 is too-few, 17+ rounds to
 * 32, which has no seed table). The "already drawn" check is not here: it needs the store, so the worker
 * adds it; this is the pure, store-free part the client can run too.
 */
export const drawBlocker = (phase: Phase, confirmed: number): DrawBlocker | null => {
  if (phase !== 'tournament') return 'not-tournament'
  if (confirmed < 4) return 'too-few'
  if (!isSupportedDrawSize(drawSize(confirmed))) return 'unsupported-size'
  return null
}

// ── Random source port (ADR-0002, ADR-0010 port pattern) ────────────────────────────────────────
// The draw's only entropy. Production injects a crypto adapter; tests inject a deterministic fake.
// `int(n)` is an **unbiased** integer in [0, n) — fairness is a product feature here (ADR-0002),
// so the crypto adapter uses rejection sampling, never `value % n` (which skews toward small values).
export interface RandomSource {
  int(n: number): number
}

/** Production RandomSource: `crypto.getRandomValues` with rejection sampling (no modulo bias). */
export const createCryptoRandomSource = (): RandomSource => ({
  int(n) {
    if (n <= 0) throw new Error(`RandomSource.int: n must be positive, got ${n}`)
    if (n === 1) return 0
    // Largest multiple of n that fits in uint32; values at or above it are rejected so every
    // residue class is equally likely (the top, partial band would otherwise over-weight small i).
    const limit = Math.floor(0x1_0000_0000 / n) * n
    const buf = new Uint32Array(1)
    let x = 0
    do {
      crypto.getRandomValues(buf)
      x = buf[0]
    } while (x >= limit)
    return x % n
  }
})

// ── The draw procedure (CONTEXT: Draw procedure, ADR-0025) ──────────────────────────────────────
// Pure: given seeded players and a RandomSource, produce a DTB-seeded bracket — full field or a
// non-full field with byes (§31). The main bracket runs this once with a live reveal; the consolation
// bracket reuses it later with no reveal (ADR-0004).

// A player entering the draw. `id` is the registration id the slots reference; `lk` is snapshotted
// into the seeding record (the seeding freeze, ADR-0010). Players arrive **in seeding order**
// (strongest first) — the caller owns that order (the shared seeding comparator, including the
// createdAt tie-break the draw cannot see); the draw assigns seed numbers 1..seedCount to the first
// `seedCount` of them. drawBracket *verifies* this contract (non-decreasing seedingValue), so a
// mis-sort fails loudly rather than silently producing a wrong bracket.
export interface DrawPlayer {
  id: number
  lk: string | null
}

// One frozen seed: its number, the player, and the LK it was seeded by (the snapshot). A Zod schema,
// not a bare interface, because it crosses a JSON text column (draws.seeding): the Store parses it on
// read so a malformed or stale row fails loudly at the seam, closing the one raw cast in the ADR-0009
// type chain. The type is inferred, so schema and type can never drift.
export const seedingEntrySchema = z.object({
  seed: z.number().int().positive(),
  playerId: z.number().int().positive(),
  lk: z.string().nullable()
})
export type SeedingEntry = z.infer<typeof seedingEntrySchema>

// One reveal step (CONTEXT: Reveal sequence), in §32.4 order: a fixed seed (Nr.1/2), a seed drawn by
// lot (Nr.3/4), the byes (§31), then the unseeded. Most kinds *place* `playerId` onto `position`; a
// `bye` step is the exception — it marks `position` as an empty line and applying it leaves the line
// null. A bye assigned to a seed carries that seed's `playerId`/`seed` (the seed it frees, already
// placed by its own seed step); a remaining bye spread by lot onto a section has no player yet (its
// neighbour is drawn in §32.4c), so `playerId` and `seed` are both null. Applying the sequence sets
// `slots[position] = kind === 'bye' ? null : playerId`.
//
// A Zod schema, not a bare interface, for the same reason as seedingEntrySchema: the reveal sequence
// crosses the `draws.reveal_sequence` JSON text column, so the Store parses it on read (the draw reveal
// show now consumes it) — a malformed or stale row fails loudly at the seam, not as a wrong-looking
// reveal on the beamer. The type is inferred, so schema and type can never drift.
export const REVEAL_KINDS = ['seed-fixed', 'seed-lot', 'bye', 'draw'] as const
export type RevealKind = (typeof REVEAL_KINDS)[number]
export const revealStepSchema = z.object({
  kind: z.enum(REVEAL_KINDS),
  position: z.number().int().nonnegative(),
  playerId: z.number().int().positive().nullable(),
  seed: z.number().int().positive().nullable()
})
export type RevealStep = z.infer<typeof revealStepSchema>

export interface DrawResult {
  // Seeds in seed order (Nr.1 first), each carrying its frozen LK.
  seeding: SeedingEntry[]
  // First-round lines: index = 0-indexed line, value = a registration id, or null for a bye line (an
  // empty line whose paired seed advances without a match). A full field has no nulls.
  slots: (number | null)[]
  // The ordered playback artifact: seeds (fixed, then by lot), then unseeded top-to-bottom.
  revealSequence: RevealStep[]
}

/**
 * Compute a DTB draw. `players` must be in seeding order (strongest first) and number a field that
 * fits `size` — i.e. `drawSize(players.length) === size` (a full power-of-two field, or a non-full
 * field whose byes §31 fills). Throws otherwise. Pure: all randomness comes through `random` (seeds
 * Nr.3/4 by lot §30.5b, the remaining byes by lot across sections §31.2b, then the unseeded einlosen
 * von oben nach unten §32.4), so the same players + same RandomSource always yield the same bracket.
 */
export interface DrawInput {
  players: DrawPlayer[]
  size: number
  random: RandomSource
}

// Distribute `count` remaining byes (those left after the seeds, §31.2b) across the R1 matches in
// `[lo, hi)` (match indices), even across the sections — halves, then quarters, then eighths — drawing
// a lot only on a genuine tie (the §31.2a "auslosen, welche … eine Rast mehr" rule). `isFree` tells a
// match still open from one already holding a seed's bye; a match takes at most one bye (two empty
// lines would leave nobody to advance). Returns the chosen match indices, top-to-bottom.
//
// This balances only the post-seed remainder, so the *total* (seed byes + these) is even per section
// only because today's seed tables place the seeds one per section — Nr.1/Nr.2 in opposite halves,
// Nr.3/4 splitting the other diagonal (§30.5b) — giving every quarter exactly one seed bye before this
// runs. A future seed table that grouped seeds would need this to account for the seed byes too.
// `count` must not exceed the free capacity of `[lo, hi)`; the caller guarantees it (drawSize keeps
// byes below size/2 for the supported sizes) and drawBracket asserts it before calling.
const distributeByes = (
  lo: number,
  hi: number,
  count: number,
  isFree: (match: number) => boolean,
  random: RandomSource
): number[] => {
  if (count === 0) return []
  if (hi - lo === 1) return [lo] // a single match: it is free (count is only routed to capacity)
  const mid = (lo + hi) >> 1
  const freeIn = (a: number, b: number) => {
    let n = 0
    for (let m = a; m < b; m++) if (isFree(m)) n++
    return n
  }
  const leftCap = freeIn(lo, mid)
  const rightCap = freeIn(mid, hi)
  const base = Math.floor(count / 2)
  let leftN = Math.min(base, leftCap)
  let rightN = Math.min(base, rightCap)
  // Hand out whatever the even split could not place (the odd one, or a side that hit its cap), one
  // at a time, lot-deciding only when both sides can still take it.
  for (let rest = count - leftN - rightN; rest > 0; rest--) {
    const leftCan = leftN < leftCap
    const rightCan = rightN < rightCap
    if (leftCan && rightCan) random.int(2) === 0 ? leftN++ : rightN++
    else if (leftCan) leftN++
    else rightN++
  }
  return [...distributeByes(lo, mid, leftN, isFree, random), ...distributeByes(mid, hi, rightN, isFree, random)]
}

export const drawBracket = ({ players, size, random }: DrawInput): DrawResult => {
  if (drawSize(players.length) !== size) {
    throw new Error(`drawBracket: ${players.length} players do not fit a draw of size ${size}`)
  }
  // Verify the seeding-order precondition the interface documents (DrawPlayer): players must arrive
  // strongest-first, i.e. non-decreasing in seedingValue. The caller still *owns* the order (it alone
  // holds the createdAt tie-break among equal LKs, which the module cannot see); this guard only
  // refuses a clearly-stronger player sitting below a weaker one — the silent mis-seed that would
  // otherwise yield a valid-looking but wrong bracket. Equal LKs are a legitimate tie, never rejected.
  for (let i = 1; i < players.length; i++) {
    if (seedingValue(players[i - 1].lk) > seedingValue(players[i].lk)) {
      throw new Error(`drawBracket: players are not in seeding order (strongest first) at index ${i}`)
    }
  }
  const { seedCount, seedGroups } = bracketStructure(size)

  const seeding: SeedingEntry[] = players.slice(0, seedCount).map((p, i) => ({ seed: i + 1, playerId: p.id, lk: p.lk }))

  // During the draw a line is `undefined` (still free), `null` (a bye, set explicitly so the unseeded
  // fill skips it), or a number (a placed player). By the end every line is a seed, a bye, or a draw,
  // so the returned slots hold only numbers and the bye nulls.
  const slots: (number | null)[] = new Array<number | null>(size)
  const revealSequence: RevealStep[] = []

  // (a, §32.4) Seeds, in seed order. A fixed group places straight onto its line; a lot group draws
  // which seed lands on which of its prescribed lines (Fisher-Yates over the line pool — a real
  // shuffle, the last seat needs no draw). Record each seed's line so its bye can find the neighbour.
  const seedLine: number[] = [] // seedLine[seedNo] = first-round line
  for (const group of seedGroups) {
    const pool = [...group.lines]
    group.seeds.forEach(seedNo => {
      const fixed = group.seeds.length === 1
      const idx = pool.length > 1 ? random.int(pool.length) : 0
      const [line] = pool.splice(idx, 1)
      const { playerId } = seeding[seedNo - 1]
      slots[line] = playerId
      seedLine[seedNo] = line
      revealSequence.push({ kind: fixed ? 'seed-fixed' : 'seed-lot', position: line, playerId, seed: seedNo })
    })
  }

  // (b, §32.4 / §31) Byes. First to the seeds in seeding order (highest seed first): each frees the
  // neighbour line of its R1 match (line ^ 1 is the other line of the pair). Then, if more byes than
  // seeds remain, spread the rest by lot evenly across the sections (§31.2b), one per still-free R1
  // match, marking that match's lower line.
  const byes = byeCount(players.length) // === size - players.length, since size === drawSize here
  const seedByes = Math.min(byes, seedCount)
  for (let seedNo = 1; seedNo <= seedByes; seedNo++) {
    const byeLine = seedLine[seedNo] ^ 1
    slots[byeLine] = null
    revealSequence.push({ kind: 'bye', position: byeLine, playerId: seeding[seedNo - 1].playerId, seed: seedNo })
  }
  if (byes > seedByes) {
    const isFree = (match: number) => slots[2 * match] === undefined && slots[2 * match + 1] === undefined
    const remaining = byes - seedByes
    let freeMatches = 0
    for (let m = 0; m < size / 2; m++) if (isFree(m)) freeMatches++
    // One bye per free match, max. drawSize keeps byes below size/2 for 4/8/16, so this always holds;
    // assert it so a new size or seed table that broke the invariant fails here, not by silently
    // overwriting a placed player inside distributeByes.
    if (remaining > freeMatches) {
      throw new Error(`drawBracket: ${remaining} byes exceed ${freeMatches} free matches in a draw of size ${size}`)
    }
    for (const match of distributeByes(0, size / 2, remaining, isFree, random)) {
      const byeLine = 2 * match + 1
      slots[byeLine] = null
      revealSequence.push({ kind: 'bye', position: byeLine, playerId: null, seed: null })
    }
  }

  // (c, §32.4) The unseeded, einlosen von oben nach unten: walk the still-free lines top→bottom and
  // draw a random remaining unseeded player into each (bye lines are null, not undefined, so skipped).
  // The pot starts in seeding order; the last free line takes the last player with no draw.
  const pot = players.slice(seedCount)
  for (let line = 0; line < size; line++) {
    if (slots[line] !== undefined) continue
    const idx = pot.length > 1 ? random.int(pot.length) : 0
    const [player] = pot.splice(idx, 1)
    slots[line] = player.id
    revealSequence.push({ kind: 'draw', position: line, playerId: player.id, seed: null })
  }

  return { seeding, slots, revealSequence }
}

// A materialized match (ADR-0025): a bracket position with its two slot references and, once decided,
// its winner + outcome. Feeders are implicit, so rounds after the first carry null slots until results
// advance players into them — except a round-1 bye, which the draw resolves immediately.
export interface MatchSlots {
  round: number
  position: number
  slot1RegId: number | null
  slot2RegId: number | null
  winnerRegId: number | null
  outcome: MatchOutcome | null
}

/**
 * Turn a `slots` array (first-round lines, byes as null) into the KO tree's match rows. Round 1
 * (1-based) pairs adjacent lines (2p, 2p+1); later rounds are empty positions whose feeders are
 * implicit via (round, position). A round-1 match with one empty line is a **bye**: it auto-resolves
 * (winner = the present player, `outcome = 'bye'`, no score, §32.4). Winners then propagate forward
 * round by round through `feeders`, so each bye winner lands in its round-2 slot and the bracket is
 * consistent the moment it is drawn. Only round 1 auto-resolves; a null slot in any later round is an
 * undecided feeder, never a bye — so when two round-1 byes happen to feed the same round-2 match (e.g.
 * a 5-player 8-draw) both winners advance and that round-2 match is simply contested, not a second bye.
 * The main bracket KO tree only — third-place match and the consolation bracket are separate slices.
 * Total rows = size − 1.
 */
export const materializeMatches = (size: number, slots: (number | null)[]): MatchSlots[] => {
  const { rounds } = bracketStructure(size)
  const matches: MatchSlots[] = []
  // The winner of each match in the previous round, by position — what feeds the next round's slots.
  let feeders: (number | null)[] = slots.map(s => s ?? null)
  for (let round = 1; round <= rounds; round++) {
    const count = size / 2 ** round
    const winners: (number | null)[] = new Array<number | null>(count).fill(null)
    for (let position = 0; position < count; position++) {
      const slot1RegId = feeders[2 * position] ?? null
      const slot2RegId = feeders[2 * position + 1] ?? null
      // A round-1 bye (exactly one slot filled) resolves now and advances its player; everything else
      // stays open (a contested match, or a later round whose feeders are not yet decided).
      const isBye = round === 1 && (slot1RegId === null) !== (slot2RegId === null)
      const winnerRegId = isBye ? (slot1RegId ?? slot2RegId) : null
      winners[position] = winnerRegId
      matches.push({ round, position, slot1RegId, slot2RegId, winnerRegId, outcome: isBye ? 'bye' : null })
    }
    feeders = winners
  }
  return matches
}
