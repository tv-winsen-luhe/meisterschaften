// Shared tennis constants — the single source of truth crossing the worker/client seam.
// Consumed by tournament.ts (re-exported as defaultLk/challengerMinLk) and the worker's
// registration/notify path. The admin string UI still inlines the threshold; it adopts
// these when it becomes the React app on the typed client (VS4 / ADR-0008).

/** Default LK for players without a nuLiga entry. Used for seeding order. */
export const DEFAULT_LK = '25.0'

// Challenger ist nach oben geschützt: nur LK >= 20 (schwächere Spieler:innen).
// Eine LK darunter ist zu stark → Hinweis Richtung Hauptfeld.
export const CHALLENGER_MIN_LK = 20
