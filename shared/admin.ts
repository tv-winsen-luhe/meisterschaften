import { z } from 'zod'
import { competitionSlug } from './competition'
import { CLUBS } from './registration'

// The admin (operator) contract — the single source of truth for the /api/admin/* JSON
// shapes, shared by the worker (server validation) and the React admin (typed `hc`).
// camelCase on the wire (Zod is the contract); the snake_case D1 columns are translated
// once in the Drizzle mapping. The legacy admin spoke snake_case only because it read DB
// columns straight through; the React admin is new, so this endpoint family is camelCase
// from the start.
//
// Field-validation messages mirror the legacy admin handler (behaviour-preserving for the
// operator): same German text, so a malformed edit reports exactly as before.

export const REGISTRATION_STATUSES = ['new', 'confirmed', 'cancelled'] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

// A registration as the admin list shows it — the full row minus the internal `ip` column
// (the legacy admin SELECT never exposed it either).
export const adminRegistrationSchema = z.object({
  id: z.number().int().positive(),
  createdAt: z.string(),
  // Last write of any kind; effectively never null (backfilled + stamped by the Store), but typed
  // nullable to match the column.
  updatedAt: z.string().nullable(),
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

// An optional player id: empty (= no link / "keine nuLiga-ID") or exactly 8 digits.
const playerId = z
  .string()
  .trim()
  .refine(v => v === '' || /^\d{8}$/.test(v), 'Spieler-ID muss 8-stellig sein.')

// Confirm (and re-save a confirmed row): apply the editable fields and move the row to
// 'confirmed'. The LK is never sent — it is derived (ADR-0020): a linked player id has its LK
// fetched from nuLiga by the edge, and `noId` is the explicit "keine nuLiga-ID" choice that seeds
// at the default. The domain runs canConfirm on the resulting basis — the authoritative guard —
// so a confirm with neither a linked id nor the no-id choice is rejected.
export const confirmRequestSchema = z.object({
  id,
  competition: competitionSlug,
  club: z.enum(CLUBS, { error: 'Bitte wähle einen gültigen Verein.' }),
  playerId,
  noId: z.boolean()
})
export type ConfirmRequest = z.infer<typeof confirmRequestSchema>

// lkFetched: the LK pulled from nuLiga when a player id was linked on this save (null when
// none was found / no id given) — the toast feedback the legacy admin showed.
export const confirmResponseSchema = z.object({ ok: z.literal(true), lkFetched: z.string().nullable() })
export type ConfirmResponse = z.infer<typeof confirmResponseSchema>

// Operator cancel, keyed by a single registration id (ADR-0018). Distinct from the public
// self-service cancel (by person, `cancelRequestSchema` in registration.ts): the operator
// records a drop-out who told the desk, sends no member notification, and converges on the
// same terminal `cancelled` state. Same shape the former `hide` carried — a bare id.
export const cancelRegistrationRequestSchema = z.object({ id })
export type CancelRegistrationRequest = z.infer<typeof cancelRegistrationRequestSchema>
export const cancelRegistrationResponseSchema = z.object({ ok: z.literal(true) })
export type CancelRegistrationResponse = z.infer<typeof cancelRegistrationResponseSchema>

export const deleteRequestSchema = z.object({ id })
export type DeleteRequest = z.infer<typeof deleteRequestSchema>
export const deleteResponseSchema = z.object({ ok: z.literal(true), deleted: z.number().int().nonnegative() })
export type DeleteResponse = z.infer<typeof deleteResponseSchema>

export const refreshLkResponseSchema = z.object({ ok: z.literal(true), updated: z.number().int().nonnegative() })
export type RefreshLkResponse = z.infer<typeof refreshLkResponseSchema>
