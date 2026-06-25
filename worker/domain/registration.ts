import { CHALLENGER_MIN_LK } from '../../shared'
import type { RegistrationRow } from '../db/schema'
import type { Person, RegistrationsStore } from '../store/registrations'

// The Registration domain owns the registration lifecycle (ADR-0011). Transitions return
// a typed Result — ok(state) or a typed domain error — and return their side effects as
// data; the transport edge performs the I/O (LK match + Telegram via ctx.waitUntil). The
// domain persists through the injected Store and never writes SQL nor awaits nuLiga.
//
// VS2 lands the write path: register/revive; VS3 adds cancel. confirm/hide and the admin
// edits follow in later slices.

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

export interface RegistrationDomain {
  register(input: RegisterInput): Promise<RegisterResult>
  cancel(person: Person): Promise<CancelResult>
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
    }
  }
}

// The Challenger-LK judgment, computed once and owned by the domain (ADR-0011): the
// Challenger field is protected upward (only LK >= CHALLENGER_MIN_LK), so a stronger LK
// hints at the Hauptfeld. The registration notifier and the admin affordance both read
// this — no duplicated threshold check.
export const isTooStrongForChallenger = (competition: string, lk: string | null): boolean => {
  if (competition !== 'mens-challenger' || !lk) return false
  const n = parseFloat(lk)
  return !Number.isNaN(n) && n < CHALLENGER_MIN_LK
}
