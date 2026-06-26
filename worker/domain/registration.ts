import { canConfirm, resolveSeedingBasis } from '../../shared'
import type { RegistrationRow } from '../db/schema'
import type { EditableFields, Person, RegistrationsStore } from '../store/registrations'

// The Challenger-LK judgment now lives in shared/ (so the client admin reads the same rule);
// re-exported here so the notifier (notify.ts) and the domain tests keep their import site.
export { isTooStrongForChallenger } from '../../shared'

// The Registration domain owns the registration lifecycle (ADR-0011). Transitions return
// a typed Result — ok(state) or a typed domain error — and return their side effects as
// data; the transport edge performs the I/O (LK match + Telegram via ctx.waitUntil). The
// domain persists through the injected Store and never writes SQL nor awaits nuLiga.
//
// VS2 lands the write path (register/revive); VS3 adds cancel; VS4 adds the admin
// transitions confirm/cancelById. The authoritative confirm guard (canConfirm) lives in shared/.

// What register needs from the edge, on top of the validated request: the request time
// (kept non-deterministic out of the domain) and the caller IP (an abuse signal stored
// with the row). Contact fields are already trimmed/validated by the shared Zod contract.
export interface RegisterInput {
  competition: string
  firstName: string
  lastName: string
  club: string
  email: string
  phone: string
  note: string
  ip: string | null
  now: string
}

// register/revive succeed with the persisted row and which transition fired; the edge
// schedules the LK match + notification from it. The only failure is the one-active-entry
// invariant — a second active sign-up for the same person+Konkurrenz.
export type RegisterResult =
  | { ok: true; outcome: 'registered' | 'revived'; registration: RegistrationRow }
  | { ok: false; error: 'AlreadyRegistered' }

// A self-service cancellation withdraws every active entry for the person; it has no
// failure mode (matching nothing is a valid zero-cancel outcome). The transition returns
// the withdrawn rows as data so the edge can send the cancellation notification.
export interface CancelResult {
  cancelled: RegistrationRow[]
}

// The editable fields the operator submits when confirming (or re-saving) a row. The LK is not
// among them — it is derived (ADR-0020): `playerId` is the (possibly-empty) nuLiga link and
// `noId` is the explicit "keine nuLiga-ID" choice. resolveSeedingBasis turns the pair into the
// stored basis (linked id + null LK to fetch, or the no-id default).
export interface ConfirmEdits {
  competition: string
  club: string
  playerId: string
  noId: boolean
}

// confirm applies the edits and moves the row to 'confirmed' when the result is confirmable;
// cancelById moves it to 'cancelled'. Both fail with NotFound for an unknown id; confirm
// additionally fails NotConfirmable (carrying canConfirm's reason) when the result lacks a
// seeding basis.
export type ConfirmResult =
  | { ok: true; registration: RegistrationRow }
  | { ok: false; error: 'NotFound' }
  | { ok: false; error: 'NotConfirmable'; reason: string }

export type CancelByIdResult = { ok: true; registration: RegistrationRow } | { ok: false; error: 'NotFound' }

export interface RegistrationDomain {
  register(input: RegisterInput): Promise<RegisterResult>
  cancel(person: Person): Promise<CancelResult>
  confirm(id: number, edits: ConfirmEdits): Promise<ConfirmResult>
  // Operator cancel by a single registration id (ADR-0018): records a drop-out the desk was
  // told about. Distinct from the self-service `cancel(person)` above — no member notification.
  cancelById(id: number): Promise<CancelByIdResult>
}

export const createRegistrationDomain = (store: RegistrationsStore): RegistrationDomain => {
  return {
    async register(input) {
      const person = { email: input.email, lastName: input.lastName, competition: input.competition }

      // One active entry per person+Konkurrenz: a member already signed up (new or
      // confirmed) cannot accidentally double-enter the same Konkurrenz.
      if (await store.findActiveRegistration(person)) return { ok: false, error: 'AlreadyRegistered' }

      // Re-registering after a cancellation revives the old row (keeps its player_id/LK
      // linkage; avoids a confusing duplicate) rather than inserting a second one.
      const cancelled = await store.findCancelledRegistration(person)
      if (cancelled) {
        const registration = await store.revive(cancelled.id, {
          createdAt: input.now,
          firstName: input.firstName,
          lastName: input.lastName,
          club: input.club,
          phone: input.phone || null,
          note: input.note || null,
          ip: input.ip
        })
        return { ok: true, outcome: 'revived', registration }
      }

      const registration = await store.insert({
        createdAt: input.now,
        competition: input.competition,
        firstName: input.firstName,
        lastName: input.lastName,
        club: input.club,
        email: input.email,
        phone: input.phone || null,
        note: input.note || null,
        ip: input.ip
      })
      return { ok: true, outcome: 'registered', registration }
    },

    async cancel(person) {
      const cancelled = await store.cancelActiveByPerson(person)
      return { cancelled }
    },

    async confirm(id, edits) {
      if (!(await store.findById(id))) return { ok: false, error: 'NotFound' }

      // Derive the basis from the operator's id/no-id choice through the same resolveSeedingBasis
      // as the card, so both provably agree (ADR-0020). The LK is written here only on the no-id
      // path (the default 25); on the linked path the LK is left untouched so the edge's nuLiga
      // fetch is the only thing that sets it — and a failed or unrated fetch never clobbers a
      // previously-resolved rating. basis.lk is non-null only for the no-id path.
      const basis = resolveSeedingBasis({ playerId: edits.playerId, noId: edits.noId })
      const fields: EditableFields = { competition: edits.competition, club: edits.club, playerId: basis.playerId }
      if (basis.lk !== null) fields.lk = basis.lk

      // The authoritative guard: a confirm with neither a linked id nor the no-id choice is
      // rejected with the same reason the admin renders.
      const guard = canConfirm(basis)
      if (guard !== true) return { ok: false, error: 'NotConfirmable', reason: guard }

      await store.setFields(id, fields)
      return { ok: true, registration: await store.setStatus(id, 'confirmed') }
    },

    async cancelById(id) {
      if (!(await store.findById(id))) return { ok: false, error: 'NotFound' }
      return { ok: true, registration: await store.setStatus(id, 'cancelled') }
    }
  }
}
