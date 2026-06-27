// Shared tennis constants — the single source of truth crossing the worker/client seam.
// Consumed by tournament.ts (re-exported as defaultLk/challengerMinLk) and the worker's
// registration/notify path. The admin string UI still inlines the threshold; it adopts
// these when it becomes the React app on the typed client (VS4 / ADR-0008).

// LK is represented as a dot-decimal string everywhere (DB `text`, wire, this default), not a
// number — a deliberate, deferred call. It is server-authored and read-only on the wire (the
// operator never types one, ADR-0020), so `z.number()` validation would buy ~nothing. The numeric
// consumers — isTooStrongForChallenger and seedingValue (the participant-list sort) — parse the
// string at their boundary and stay fine; the bigger beneficiary, numeric Setzung sorting, still
// does not exist. Converting the stored representation to a real number costs the same later as now
// (and adds a German-comma display formatter), so it is not done speculatively. Revisit when the
// draw/seeding lands: introduce a numeric LK there, at the point that actually needs it.
/** Default LK for players without a nuLiga entry. Used for seeding order. */
export const DEFAULT_LK = '25.0'

// Challenger ist nach oben geschützt: nur LK >= 20 (schwächere Spieler:innen).
// Eine LK darunter ist zu stark → Hinweis Richtung Hauptfeld.
export const CHALLENGER_MIN_LK = 20
