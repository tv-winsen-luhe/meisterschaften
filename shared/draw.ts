import type { Phase } from './phase'

// Draw math, owned once in shared/ so the overview (its first consumer) and the future
// draw read the same rule (CONTEXT: Draw size / byes). Pure, no deps — ADR-0021 keeps
// the admin small, and this is the kind of single-source helper that stops the rule being
// re-derived per surface.

/**
 * The draw size for `confirmed` players: the next power of two ≥ confirmed. A draw needs at
 * least two players — below that there is no bracket, so 0 and 1 return 0.
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
 * Matches in the consolation bracket — the consolation knockout (CONTEXT: Consolation bracket, ADR-0004). Its
 * entrants are the main bracket's first-round losers — `confirmed − drawSize/2` (the byes skip R1) —
 * and, being a knockout, it runs `entrants − 1` matches (0 below two).
 *
 * A consolation bracket exists only when the main bracket first round lies *before* the semifinals — i.e.
 * **draw size ≥ 8** (ADR-0004). At draw size 4 the first round *is* the semifinal, so its two
 * losers are exactly the pair the third-place match already plays — there is no separate consolation bracket
 * (and below four there is neither). So size ≤ 4 ⇒ 0, not the `entrants − 1` the formula would give.
 *
 * Estimate, not an exact count: the consolation bracket also takes the players who had a R1 bye and then
 * lost in R2 (so every entrant gets ≥2 matches), and how many that is depends on the R2 pairings,
 * not derivable from counts alone. It is therefore a slight under-count for fields with byes,
 * and **exact for a full power-of-two field** (no byes) — which is the capacity figure the
 * total utilization headlines.
 */
export const consolationMatches = (confirmed: number): number => {
  const size = drawSize(confirmed)
  if (size <= 4) return 0
  const firstRoundLosers = confirmed - size / 2
  return firstRoundLosers < 2 ? 0 : firstRoundLosers - 1
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
// time; `walkover`/`retirement` are entered during Live. Owned here so the `matches.outcome` column
// and its wire enum read one list; this epic (full fields, no byes) writes none of them.
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
  // Number of seeds for this size (DTB §30.5a): 8 → 2, 16 → 4. Our fields are 8 or 16.
  seedCount: number
  // Seed placement in seed order: [Nr.1 fixed], [Nr.2 fixed], then the lot groups (Nr.3/4 …).
  seedGroups: SeedGroup[]
  // Number of rounds in the KO tree (8 → 3, 16 → 4); round r (1-based) has size / 2^r matches.
  rounds: number
}

// Seed lines per draw size, 0-indexed (DTB §30.5b). Nr. 1 → first line, Nr. 2 → last line; the
// 16-draw places Nr. 3/4 by lot onto lines 5 and 12 (0-indexed 4 and 11). Only the sizes our
// fields use (8, 16) are defined — bracketStructure throws for anything else.
const SEED_GROUPS: Record<number, SeedGroup[]> = {
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
 * not defined here (i.e. anything but 8 or 16 today) — a deliberate small-N guard (ADR-0021), so a
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

/** Whether a draw of this size has a defined seed table (i.e. drawBracket won't throw). 8 and 16. */
export const isSupportedDrawSize = (size: number): boolean => SEED_GROUPS[size] !== undefined

// ── Draw gate (CONTEXT: competition lifecycle, ADR-0011/0025/0027) ─────────────────────────────
// Why a competition cannot be drawn yet. The single predicate both the worker enforces (authority)
// and the competitions surface (UI: „Konkurrenzen") renders (affordance) — defined once so the button's disabled reason
// can never drift from the server guard (the canConfirm pattern, ADR-0011). `null` = drawable.
export type DrawBlocker = 'not-tournament' | 'too-few' | 'not-full-field' | 'unsupported-size'

// The operator-facing reason per blocker — one source for the server's 400 body and the button hint.
export const DRAW_BLOCKER_REASON: Record<DrawBlocker, string> = {
  'not-tournament': 'Auslosung erst nach Anmeldeschluss (Phase „Turnier").',
  'too-few': 'Mindestens zwei bestätigte Anmeldungen nötig.',
  'not-full-field': 'Nur volle Felder (Zweierpotenz, keine Freilose) können ausgelost werden.',
  'unsupported-size': 'Aktuell nur 8er- und 16er-Felder.'
}

/**
 * The draw gate for a competition with `confirmed` confirmed entries in the given phase: the first
 * reason it cannot be drawn, or `null` when it can. Mirrors the steps the draw needs — registration
 * closed (`tournament`), at least two entries, a full power-of-two field (no byes this epic), and
 * a size the seed table supports (8/16). The "already drawn" check is not here: it needs the store,
 * so the worker adds it; this is the pure, store-free part the client can run too.
 */
export const drawBlocker = (phase: Phase, confirmed: number): DrawBlocker | null => {
  if (phase !== 'tournament') return 'not-tournament'
  if (confirmed < 2) return 'too-few'
  const size = drawSize(confirmed)
  if (size !== confirmed) return 'not-full-field'
  if (!isSupportedDrawSize(size)) return 'unsupported-size'
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
// Pure: given seeded players and a RandomSource, produce a DTB-seeded full-field bracket. Full field
// only (a power-of-two field, no byes) for this epic. The main bracket runs it once with a live
// reveal; the consolation bracket will reuse it later with no reveal (ADR-0004).

// A player entering the draw. `id` is the registration id the slots reference; `lk` is snapshotted
// into the seeding record (the seeding freeze, ADR-0010). Players arrive **in seeding order**
// (strongest first) — the caller owns that order (the shared seeding comparator); the draw assigns
// seed numbers 1..seedCount to the first `seedCount` of them.
export interface DrawPlayer {
  id: number
  lk: string | null
}

// One frozen seed: its number, the player, and the LK it was seeded by (the snapshot).
export interface SeedingEntry {
  seed: number
  playerId: number
  lk: string | null
}

// One reveal step (CONTEXT: Reveal sequence): it places one player onto one first-round line and
// carries why — a fixed seed (Nr.1/2), a seed drawn by lot (Nr.3/4), or an unseeded draw (§32.4).
// `seed` is the seed number for seed steps, null for `draw`. This epic has no `bye` kind (full field).
export type RevealKind = 'seed-fixed' | 'seed-lot' | 'draw'
export interface RevealStep {
  kind: RevealKind
  position: number
  playerId: number
  seed: number | null
}

export interface DrawResult {
  // Seeds in seed order (Nr.1 first), each carrying its frozen LK.
  seeding: SeedingEntry[]
  // First-round lines: index = 0-indexed line, value = registration id. Full field ⇒ no nulls.
  slots: number[]
  // The ordered playback artifact: seeds (fixed, then by lot), then unseeded top-to-bottom.
  revealSequence: RevealStep[]
}

/**
 * Compute a full-field DTB draw. `players` must be in seeding order (strongest first) and number a
 * power of two matching `size`. Throws otherwise — a full field is the contract here. Pure: all
 * randomness comes through `random` (seeds Nr.3/4 by lot, then the unseeded einlosen von oben nach
 * unten, §32.4), so the same players + same RandomSource always yield the same bracket.
 */
export interface DrawInput {
  players: DrawPlayer[]
  size: number
  random: RandomSource
}

export const drawBracket = ({ players, size, random }: DrawInput): DrawResult => {
  if (players.length !== size) throw new Error(`drawBracket: expected a full field of ${size}, got ${players.length}`)
  const { seedCount, seedGroups } = bracketStructure(size)

  const seeding: SeedingEntry[] = players.slice(0, seedCount).map((p, i) => ({ seed: i + 1, playerId: p.id, lk: p.lk }))

  const slots: number[] = new Array<number>(size)
  const revealSequence: RevealStep[] = []

  // Seeds, in seed order. A fixed group places straight onto its line; a lot group draws which seed
  // lands on which of its prescribed lines (Fisher-Yates over the line pool — a real shuffle, the
  // last seat needs no draw). Each placement is one reveal step.
  for (const group of seedGroups) {
    const pool = [...group.lines]
    group.seeds.forEach(seedNo => {
      const fixed = group.seeds.length === 1
      const idx = pool.length > 1 ? random.int(pool.length) : 0
      const [line] = pool.splice(idx, 1)
      const { playerId } = seeding[seedNo - 1]
      slots[line] = playerId
      revealSequence.push({ kind: fixed ? 'seed-fixed' : 'seed-lot', position: line, playerId, seed: seedNo })
    })
  }

  // The unseeded, einlosen von oben nach unten (§32.4): walk the free lines top→bottom and draw a
  // random remaining unseeded player into each. The pot starts in seeding order; the last line takes
  // the last player with no draw.
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

// A materialized match (ADR-0025): a bracket position with its two slot references. Feeders are
// implicit, so rounds after the first carry null slots until results advance players into them.
export interface MatchSlots {
  round: number
  position: number
  slot1RegId: number | null
  slot2RegId: number | null
}

/**
 * Turn a full first-round `slots` array into the KO tree's match rows. Round 1 (1-based) pairs
 * adjacent lines (2p, 2p+1); later rounds are empty positions whose feeders are implicit via
 * (round, position). The main bracket KO tree only — third-place match and the consolation bracket are separate
 * slices. Total rows = size − 1.
 */
export const materializeMatches = (size: number, slots: number[]): MatchSlots[] => {
  const { rounds } = bracketStructure(size)
  const matches: MatchSlots[] = []
  for (let round = 1; round <= rounds; round++) {
    const count = size / 2 ** round
    for (let position = 0; position < count; position++) {
      matches.push({
        round,
        position,
        slot1RegId: round === 1 ? (slots[2 * position] ?? null) : null,
        slot2RegId: round === 1 ? (slots[2 * position + 1] ?? null) : null
      })
    }
  }
  return matches
}
