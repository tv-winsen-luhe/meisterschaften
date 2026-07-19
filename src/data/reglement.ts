// The tournament's Reglement rows — the exact "so wird gespielt" facts. Kept here as *one* source so
// the front-door Modus section (`index.astro`) cannot drift from any other surface that needs the
// scoring rule, the same single-source pattern `field-explainers.ts` established for the field flips.
// Before this module the rows were a local const in `index.astro`. (The Herren porch was the second
// reader that motivated extracting them; it was retired in ADR-0057, leaving the front door as the sole
// consumer, but the single source stays — it is the right shape for the next one.) English identifiers,
// German user-facing strings (ADR-0028).

export interface ReglementRow {
  /** Stable id so a row can be reused without matching on the German label (which is user-facing copy). */
  key: 'mode' | 'scoring' | 'perDay' | 'competitions' | 'seeding' | 'ranking'
  label: string
  value: string
}

export const reglement: readonly ReglementRow[] = [
  { key: 'mode', label: 'Modus', value: 'K.O. mit Nebenrunde — mind. 2 Matches' },
  { key: 'scoring', label: 'Zählweise', value: '2 Gewinnsätze, bei 1:1 Match-Tie-Break bis 10' },
  { key: 'perDay', label: 'Pro Tag', value: 'Höchstens 2 Einzel' },
  {
    key: 'competitions',
    label: 'Konkurrenz',
    value: 'Einzel (Damen, Herren, Challenger) · dazu Damen Doppel (gesellig)'
  },
  { key: 'seeding', label: 'Setzung', value: 'Nach Leistungsklasse' },
  { key: 'ranking', label: 'Wertung', value: 'Vereinsintern, keine LK-Wertung' }
]

/**
 * One Reglement row by key. Every consumer goes through here so a missing key fails loud (which rule is
 * gone) rather than a cryptic `undefined` in the template — same fail-loud contract as `fieldExplainerFor`.
 */
export const reglementRow = (key: ReglementRow['key']): ReglementRow => {
  const row = reglement.find(r => r.key === key)
  if (!row) throw new Error(`No reglement row for key "${key}"`)
  return row
}
