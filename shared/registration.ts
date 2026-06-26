import { z } from 'zod'
import { COMPETITION_SLUGS } from './competition'
import { CHALLENGER_MIN_LK, DEFAULT_LK } from './constants'

// The registration write contract — the single source of truth for the POST /api/register
// JSON shape, shared by the worker (server validation) and the client form. camelCase on
// the wire (Zod is the contract); the snake_case D1 columns are translated once in the
// Drizzle mapping. The form's name= attributes move to camelCase atomically with this.
//
// Messages are kept identical to the previous hand-rolled handler (behaviour-preserving):
// every check on a field carries the same German message, and the fields are declared in
// the legacy validation order so the first reported issue matches the old behaviour.

export const CLUBS = ['TV Winsen', 'TSV Winsen'] as const
export type Club = (typeof CLUBS)[number]

// Same shape the legacy isEmail() accepted: one @, one dot, no whitespace.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const registerRequestSchema = z.object({
  competition: z.enum(COMPETITION_SLUGS, { error: 'Bitte wähle eine gültige Konkurrenz.' }),
  firstName: z.string().trim().min(1, 'Bitte gib deinen Vornamen an.').max(60, 'Bitte gib deinen Vornamen an.'),
  lastName: z.string().trim().min(1, 'Bitte gib deinen Nachnamen an.').max(60, 'Bitte gib deinen Nachnamen an.'),
  club: z.enum(CLUBS, { error: 'Bitte wähle deinen Verein.' }),
  email: z
    .string()
    .trim()
    .min(1, 'Bitte gib eine gültige E-Mail-Adresse an.')
    .max(120, 'Bitte gib eine gültige E-Mail-Adresse an.')
    .regex(EMAIL_RE, 'Bitte gib eine gültige E-Mail-Adresse an.'),
  phone: z.string().trim().max(40, 'Handynummer ist zu lang.').optional().default(''),
  note: z.string().trim().max(500, 'Anmerkung ist zu lang (max. 500 Zeichen).').optional().default(''),
  consent: z.literal('yes', { error: 'Bitte bestätige die Einwilligung.' })
})

export type RegisterRequest = z.infer<typeof registerRequestSchema>

// The register endpoint answers with the same envelope the form already understands:
// { ok: true } on success (including the silent honeypot success), { error } otherwise.
export const registerResponseSchema = z.object({ ok: z.literal(true) })
export type RegisterResponse = z.infer<typeof registerResponseSchema>

// The self-service cancellation contract — the single source of truth for the POST
// /api/cancel JSON shape, shared by the worker and the abmelden form. camelCase on the
// wire (the form's name= attributes move to camelCase atomically with this). A cancel
// matches on email + last name across all Konkurrenzen, so it needs only those two.
//
// Messages mirror the previous hand-rolled handler: a missing or malformed email both
// reported the same message, and email was checked before the last name.
export const cancelRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Bitte gib die E-Mail-Adresse deiner Anmeldung an.')
    .regex(EMAIL_RE, 'Bitte gib die E-Mail-Adresse deiner Anmeldung an.'),
  lastName: z.string().trim().min(1, 'Bitte gib deinen Nachnamen an.')
})

export type CancelRequest = z.infer<typeof cancelRequestSchema>

// The cancel endpoint answers with the same envelope the form already understands:
// { ok: true, cancelled: N } — N is how many active entries were withdrawn (0 = no match).
export const cancelResponseSchema = z.object({ ok: z.literal(true), cancelled: z.number().int().nonnegative() })
export type CancelResponse = z.infer<typeof cancelResponseSchema>

// The seeding-relevant fields canConfirm inspects — a structural subset of a registration.
export interface ConfirmableFields {
  playerId: string | null
  lk: string | null
}

// The only seeding input the operator gives (ADR-0020): whether the entry is linked to a nuLiga
// player id, or explicitly has none ("keine nuLiga-ID"). The LK is never part of this input — it
// is derived. The React admin passes the live id field + switch state; the domain confirm passes
// the same, so card and authority provably agree.
export interface SeedingBasisInput {
  playerId: string
  noId?: boolean
}

// Derive the seeding basis from the operator's id/no-id choice, owning the "no resolvable rating
// ⇒ default LK" policy in one tested place (ADR-0020). A linked player id is kept (trimmed) with a
// null LK — the actual rating is fetched from nuLiga by the edge at confirm time. The explicit
// no-id choice clears the id and seeds at DEFAULT_LK. Neither chosen → no basis (canConfirm
// rejects it). The LK is never supplied here; the operator cannot type one.
export const resolveSeedingBasis = ({ playerId, noId = false }: SeedingBasisInput): ConfirmableFields => {
  if (noId) return { playerId: null, lk: DEFAULT_LK }
  return { playerId: playerId.trim() || null, lk: null }
}

// The authoritative confirmation precondition (ADR-0011, sharpened by ADR-0020), living once in
// shared/ so the domain enforces it and the admin renders its reason from the same source. A
// registration is confirmable once it carries a seeding basis: a linked nuLiga player id, or the
// no-id default LK (25.0). Returns true when confirmable, otherwise the German reason.
export const canConfirm = (reg: ConfirmableFields): true | string => {
  const hasPlayerId = Boolean(reg.playerId?.trim())
  const hasLk = Boolean(reg.lk?.trim())
  if (!hasPlayerId && !hasLk) return 'Zum Bestätigen bitte Spieler-ID eintragen oder „keine ID" (LK 25.0) setzen.'
  return true
}

// The Challenger-LK judgment, owned once in shared/ (ADR-0011) so the registration notifier,
// the domain, and the admin affordance all read the same rule — no duplicated threshold. The
// Challenger field is protected upward (only LK >= CHALLENGER_MIN_LK), so a stronger LK hints
// at the Hauptfeld.
export const isTooStrongForChallenger = (competition: string, lk: string | null): boolean => {
  if (competition !== 'mens-challenger' || !lk) return false
  const n = parseFloat(lk)
  return !Number.isNaN(n) && n < CHALLENGER_MIN_LK
}
