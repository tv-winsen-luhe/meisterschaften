import { z } from 'zod'
import { CLUBS } from './club'
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

// Same shape the legacy isEmail() accepted: one @, one dot, no whitespace.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// The registration lifecycle states (the D1 `status` column): `new` → `confirmed` → `cancelled`
// (CONTEXT.md). Owned here, not in admin.ts: the status model is a lifecycle fact, read by the
// public register/cancel store paths and the seeding cron, so it must not live behind the admin
// contract. admin.ts imports these for its wire schema.
export const REGISTRATION_STATUSES = ['new', 'confirmed', 'cancelled'] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

// "Active entry" — a registration still participating (CONTEXT.md). Defined positively over
// {new, confirmed}: the load-bearing "one active entry per member" invariant is the rule over this
// set, so a future status stays inactive until explicitly classed active here (the safe-failure
// direction). The single home for status ∈ {new, confirmed}, previously inlined across the store,
// the seeding cron (once inverted) and the admin overview.
export const ACTIVE_STATUSES = ['new', 'confirmed'] as const satisfies readonly RegistrationStatus[]
export const isActive = (status: RegistrationStatus): boolean =>
  (ACTIVE_STATUSES as readonly RegistrationStatus[]).includes(status)

// Field max-lengths — the single source for both the schema's `.max(...)` bounds and the signup
// form's `maxlength` attributes (imported in the Astro frontmatter, so it never reaches the client
// bundle). The two can no longer drift. The HTML5 `maxlength` is a loose front-line hint; the schema
// — which also trims, a thing HTML5 cannot express — stays the sole authority (ADR-0022).
export const FIELD_MAX = { firstName: 60, lastName: 60, email: 120, phone: 40, note: 500 } as const

export const registerRequestSchema = z.object({
  competition: z.enum(COMPETITION_SLUGS, { error: 'Bitte wähle eine gültige Konkurrenz.' }),
  firstName: z
    .string()
    .trim()
    .min(1, 'Bitte gib deinen Vornamen an.')
    .max(FIELD_MAX.firstName, 'Bitte gib deinen Vornamen an.'),
  lastName: z
    .string()
    .trim()
    .min(1, 'Bitte gib deinen Nachnamen an.')
    .max(FIELD_MAX.lastName, 'Bitte gib deinen Nachnamen an.'),
  club: z.enum(CLUBS, { error: 'Bitte wähle deinen Verein.' }),
  email: z
    .string()
    .trim()
    .min(1, 'Bitte gib eine gültige E-Mail-Adresse an.')
    .max(FIELD_MAX.email, 'Bitte gib eine gültige E-Mail-Adresse an.')
    .regex(EMAIL_RE, 'Bitte gib eine gültige E-Mail-Adresse an.'),
  phone: z.string().trim().max(FIELD_MAX.phone, 'Handynummer ist zu lang.').optional().default(''),
  note: z
    .string()
    .trim()
    .max(FIELD_MAX.note, `Anmerkung ist zu lang (max. ${FIELD_MAX.note} Zeichen).`)
    .optional()
    .default(''),
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
// matches on email + last name across all competitions, so it needs only those two.
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

// The number a row is seeded by: its LK parsed, with no resolvable rating ⇒ DEFAULT_LK. The LK scale
// runs 1.0 (strongest) to 25.0 (weakest), so ordering ascending by this puts the strongest first; a
// missing or unratable LK therefore seeds as the weakest (25.0), never the strongest. Owns the
// "string LK → sort number" rule once (CONTEXT: seedingValue) so the participant list and the future
// seeding share one encoding — replacing the SQL CAST / in-memory parseFloat pair a comment kept in
// sync. (LK stays a string on the row; this is the conversion at the sort boundary, ADR-0021.)
export const seedingValue = (lk: string | null): number => {
  const n = parseFloat(lk ?? DEFAULT_LK)
  return Number.isNaN(n) ? Number(DEFAULT_LK) : n
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
// at the championship field.
export const isTooStrongForChallenger = (competition: string, lk: string | null): boolean => {
  if (competition !== 'mens-challenger' || !lk) return false
  const n = parseFloat(lk)
  return !Number.isNaN(n) && n < CHALLENGER_MIN_LK
}
