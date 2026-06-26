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
