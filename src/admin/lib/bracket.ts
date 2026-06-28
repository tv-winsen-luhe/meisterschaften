// Round column labels for the admin's bracket views (the competitions card and the draw show) — display
// copy, not topology (the shape comes from the shared bracketStructure, ADR-0025). Read from the back so
// an 8- and a 16-draw share one list; a deeper field falls back to „Runde N".
const ROUND_LABELS_FROM_END = ['Finale', 'Halbfinale', 'Viertelfinale', 'Achtelfinale']

export const roundLabel = (round: number, totalRounds: number): string =>
  ROUND_LABELS_FROM_END[totalRounds - round] ?? `Runde ${round}`
