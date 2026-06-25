import { z } from 'zod'
import { competitionSlug } from './competition'
import { CLUBS } from './registration'

// The admin (operator) contract — the single source of truth for the /api/admin/* JSON
// shapes, shared by the worker (server validation) and the React admin (typed `hc`).
// camelCase on the wire (Zod is the contract); the snake_case D1 columns are translated
// once in the Drizzle mapping. The legacy admin spoke snake_case only because it read DB
// columns straight through; the React admin is new, so this endpoint family is camelCase
// from the start. The CSV /export stays a separate snake_case operator artifact.
//
// Field-validation messages mirror the legacy admin handler (behaviour-preserving for the
// operator): same German text, so a malformed edit reports exactly as before.

export const REGISTRATION_STATUSES = ['new', 'confirmed', 'hidden', 'cancelled'] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

// A registration as the admin list shows it — the full row minus the internal `ip` column
// (the legacy admin SELECT never exposed it either).
export const adminRegistrationSchema = z.object({
  id: z.number().int().positive(),
  createdAt: z.string(),
  competition: competitionSlug,
  firstName: z.string(),
  lastName: z.string(),
  club: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  note: z.string().nullable(),
  playerId: z.string().nullable(),
  lk: z.string().nullable(),
  status: z.enum(REGISTRATION_STATUSES)
})
export type AdminRegistration = z.infer<typeof adminRegistrationSchema>

export const adminListResponseSchema = z.object({ registrations: z.array(adminRegistrationSchema) })
export type AdminListResponse = z.infer<typeof adminListResponseSchema>

// A row id — the key every mutation targets.
const id = z.number('Ungültige ID.').int('Ungültige ID.').positive('Ungültige ID.')

// An optional player id: empty (= cleared / "no nuLiga entry") or exactly 8 digits.
const playerId = z
  .string()
  .trim()
  .refine(v => v === '' || /^\d{8}$/.test(v), 'Spieler-ID muss 8-stellig sein.')

// An optional LK: empty or e.g. "20.3" / "20,3"; commas are normalised to dots on the wire.
const lk = z
  .string()
  .trim()
  .refine(v => v === '' || /^\d{1,2}([.,]\d)?$/.test(v), 'LK-Format ungültig (z. B. 20.3).')
  .transform(v => v.replace(',', '.'))

// Confirm (and re-save a confirmed row): apply the editable fields and move the row to
// 'confirmed'. The domain runs canConfirm on the resulting playerId/lk — the authoritative
// guard — so a confirm that would leave the row without a seeding basis is rejected.
export const confirmRequestSchema = z.object({
  id,
  competition: competitionSlug,
  club: z.enum(CLUBS, { error: 'Bitte wähle einen gültigen Verein.' }),
  playerId,
  lk
})
export type ConfirmRequest = z.infer<typeof confirmRequestSchema>

// lkFetched: the LK pulled from nuLiga when a player id was linked on this save (null when
// none was found / no id given) — the toast feedback the legacy admin showed.
export const confirmResponseSchema = z.object({ ok: z.literal(true), lkFetched: z.string().nullable() })
export type ConfirmResponse = z.infer<typeof confirmResponseSchema>

export const hideRequestSchema = z.object({ id })
export type HideRequest = z.infer<typeof hideRequestSchema>
export const hideResponseSchema = z.object({ ok: z.literal(true) })
export type HideResponse = z.infer<typeof hideResponseSchema>

export const deleteRequestSchema = z.object({ id })
export type DeleteRequest = z.infer<typeof deleteRequestSchema>
export const deleteResponseSchema = z.object({ ok: z.literal(true), deleted: z.number().int().nonnegative() })
export type DeleteResponse = z.infer<typeof deleteResponseSchema>

export const refreshLkResponseSchema = z.object({ ok: z.literal(true), updated: z.number().int().nonnegative() })
export type RefreshLkResponse = z.infer<typeof refreshLkResponseSchema>
