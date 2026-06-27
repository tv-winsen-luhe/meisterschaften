// Draw math, owned once in shared/ so the Übersicht (its first consumer) and the future
// Auslosung read the same rule (CONTEXT: Draw size / Freilose). Pure, no deps — ADR-0021 keeps
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

/** Freilose (byes): the gap between the draw size and the confirmed count (0 when no draw). */
export const byeCount = (confirmed: number): number => {
  const size = drawSize(confirmed)
  return size === 0 ? 0 : size - confirmed
}

/**
 * Matches in the Hauptrunde: `confirmed − 1` to crown the champion (every entrant but the winner
 * loses once; a bye is not a match), plus the Spiel um Platz 3 once a semifinal exists. From four
 * entrants up the round of four always resolves to two contested semifinals (byes only occur in
 * round one), so that playoff is exact — not an estimate.
 */
export const mainDrawMatches = (confirmed: number): number =>
  confirmed < 2 ? 0 : confirmed - 1 + (confirmed >= 4 ? 1 : 0)

/**
 * Matches in the Trostrunde — the consolation knockout (CONTEXT: Nebenrunde, ADR-0004). Its
 * entrants are the Hauptrunde's first-round losers — `confirmed − drawSize/2` (the byes skip R1) —
 * and, being a knockout, it runs `entrants − 1` matches (0 below two).
 *
 * Estimate, not an exact count: the Nebenrunde also takes the players who had a R1 Freilos and then
 * lost in R2 (so every entrant gets ≥2 matches), and how many that is depends on the R2 pairings,
 * not derivable from counts alone. It is therefore a slight under-count for fields with Freilose,
 * and **exact for a full power-of-two field** (no byes) — which is the capacity figure the
 * Gesamtauslastung headlines.
 */
export const consolationMatches = (confirmed: number): number => {
  const size = drawSize(confirmed)
  if (size === 0) return 0
  const firstRoundLosers = confirmed - size / 2
  return firstRoundLosers < 2 ? 0 : firstRoundLosers - 1
}

/** Total matches a field runs: main draw + Trostrunde (R1-loser consolation). */
export const matchCount = (confirmed: number): number => mainDrawMatches(confirmed) + consolationMatches(confirmed)

// TODO (Auslosung): bracket *structure* (seed lines, per-round match counts) currently lives only in
// the public preview's client JS (tournament-draw.astro: SEED_POS / ROUNDS / capacity/2^(r+1)). When the
// real Auslosung is built, lift that structure into a `bracketStructure(size)` here so the preview, the
// Auslosungs-Show, and the Spielplan validator read one source — don't add a second implementation.
