import type { AppStateStore } from './store/app-state'
import type { DrawStore } from './store/draw'
import type { RegistrationsStore } from './store/registrations'

// The debug-reset orchestration (ADR-0029): the worker-side wiring behind the three flag-gated
// levers. Reset reverses the forward transitions the model treats as final (the draw — ADR-0026/0027
// — and confirm), so it is a debug-only capability, never an operator feature; the `RESET_ENABLED`
// flag (enforced at the route) is what keeps it out of production.
//
// The levers tear down in dependency order (registrations → draw → results), and that order is the
// whole point of this module:
//   - undraw (per competition)  reverses „Jetzt auslosen" — a self-contained delete, no precondition
//   - readmit (global)          reverses confirm — GUARDED: a drawn player cannot be un-confirmed, so
//                               it refuses while any draw exists (undraw / back-to-signup first)
//   - back-to-signup (global)   reverses the phase — CASCADES: undraws every competition first so the
//                               DB is never left with a draw in the signup phase, then sets the phase
// Only the top-level lever tears down dependent artifacts automatically; the surgical levers stay
// atomic and refuse rather than cascade, so a reset never destroys more than the lever names.

// Why a readmit could not run: a draw still references confirmed entries, so they cannot be
// un-confirmed until it is gone. The single guard this module enforces.
export type ReadmitError = 'DrawsExist'

const DRAWS_EXIST_REASON =
  'Es existieren noch Auslosungen. Erst die Konkurrenzen zurücksetzen oder „Zurück zur Anmeldung“, dann erneut zulassen.'

export type ReadmitOutcome = { ok: true; readmitted: number } | { ok: false; error: ReadmitError; reason: string }

// The undraw / back-to-signup results, declared as named types (the lint rule forbids inline object
// types in generic position, e.g. Promise<{…}>). Both always succeed — they delete and report a count.
export interface UndrawOutcome {
  ok: true
  undrawn: number
}
export interface BackToSignupOutcome {
  ok: true
  phase: 'signup'
  undrawn: number
}

export interface ResetServiceDeps {
  drawStore: DrawStore
  registrationsStore: RegistrationsStore
  appStateStore: AppStateStore
}

export const createResetService = (deps: ResetServiceDeps) => {
  const { drawStore, registrationsStore, appStateStore } = deps

  return {
    /**
     * Undraw one competition: delete its draw record + matches (all brackets), returning it to
     * „not drawn". Idempotent — undrawing a field that was not drawn reports 0, not an error.
     */
    async undraw(competition: string): Promise<UndrawOutcome> {
      return { ok: true, undrawn: await drawStore.deleteByCompetition(competition) }
    },

    /**
     * Readmit: move every `confirmed` entry back to `new`. Guarded — a draw references confirmed
     * entries by id, so un-confirming while a draw stands would orphan the bracket; refuse instead.
     */
    async readmit(): Promise<ReadmitOutcome> {
      if ((await drawStore.listDraws()).length > 0)
        return { ok: false, error: 'DrawsExist', reason: DRAWS_EXIST_REASON }
      return { ok: true, readmitted: await registrationsStore.readmitAllConfirmed() }
    },

    /**
     * Back to signup: cascade an undraw of every competition (so no draw outlives the tournament
     * phase), un-publish the schedule, then set the phase to `signup`. Registration status is
     * deliberately left untouched — confirmed entries are legitimate during signup; readmit is the
     * separate lever.
     */
    async backToSignup(): Promise<BackToSignupOutcome> {
      // Three idempotent writes across two tables, not one transaction: if a later write fails, the
      // earlier ones stand and re-pressing the lever (deleteAll → 0, setSchedulePublished → false,
      // setPhase → signup) completes it. Un-publishing here is load-bearing (ADR-0041): the draws are
      // wiped, so leaving `schedule_published` true would let the *next* draw's placements leak onto the
      // public page the instant they are placed, bypassing the publish gate the operator believes still
      // guards them. Reset is the only *operator* unpublish lever, but this debug teardown must clear it
      // too, since it destroys the very plan the flag was published over.
      const undrawn = await drawStore.deleteAll()
      await appStateStore.setSchedulePublished(false)
      await appStateStore.setPhase('signup')
      return { ok: true, phase: 'signup', undrawn }
    }
  }
}
