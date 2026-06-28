import type { PublicRevealStep } from './admin'

// The reveal sequence applied up to the cursor — the „revealed bracket" (CONTEXT.md). Given a draw size
// and the reveal steps shown so far, it answers which round-1 lines are filled and which round-2 slots
// already carry a bye-winner. It is the single interpretation both the operator draw reveal show
// (src/admin/draw-bracket.tsx) and the public live bracket (src/components/tournament-draw.astro) render
// over — the renderers stay framework-specific below this seam and compute no bracket logic themselves.
// The bracket *shape* still comes from bracketStructure(size) (the empty topology, ADR-0025); this is the
// same topology filled to the cursor. Pure and bracket-agnostic: it assumes nothing about main vs.
// consolation, or partial vs. full reveal — a fully-revealed sequence (no cursor) interprets the same way.

// A placed player as the public reveal step carries it — non-null on every step that landed a player (a
// §32.4c lot-bye line carries none).
export type PlayerDisplay = NonNullable<PublicRevealStep['player']>

// The player a round-1 bye carried into round 2 — the one round a bye advances a player (§31) — with the
// seed they carry. null when the match is contested, not yet fully revealed, or has no bye.
export interface ByeWinner {
  player: PlayerDisplay
  seed: number | null
}

export interface RevealedBracket {
  // Round-1 lines indexed by position; a gap (undefined) is a line not yet revealed.
  lines: (PublicRevealStep | undefined)[]
  // Per round-1 match (size / 2 of them), the bye-winner advanced into round 2, else null.
  byeWinners: (ByeWinner | null)[]
}

export const revealedBracket = (size: number, steps: PublicRevealStep[]): RevealedBracket => {
  // The revealed first-round lines, indexed by position; gaps are lines not yet drawn.
  const lines: (PublicRevealStep | undefined)[] = new Array(size)
  for (const step of steps) lines[step.position] = step

  // Per round-1 match, the player who advanced through a (fully revealed) bye. Exactly one line a bye
  // (both revealed) ⇒ the other line's player advanced; the bye line itself carries no player to read
  // here (a seed-bye's player sits on its paired line, a lot-bye's neighbour is the drawn advancer). A
  // contested match, an unrevealed line, or the structurally-impossible double-bye all stay null.
  const byeWinners: (ByeWinner | null)[] = []
  for (let m = 0; m < size / 2; m++) {
    const a = lines[2 * m]
    const b = lines[2 * m + 1]
    const oneBye = a && b && (a.kind === 'bye') !== (b.kind === 'bye')
    const advanced = oneBye ? (a.kind === 'bye' ? b : a) : null
    byeWinners[m] = advanced?.player ? { player: advanced.player, seed: advanced.seed } : null
  }
  return { lines, byeWinners }
}
