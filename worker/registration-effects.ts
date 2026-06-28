import type { Env } from './app'
import type { RegistrationRow } from './db/schema'
import { notifyRegistration, type RegistrationNotice } from './notify'
import type { SeedingLk } from './seeding-lk'

// The registration side-effect orchestration lives at the transport edge, not in the domain
// (ADR-0011 amendment): the domain returns its Result; these named functions perform the I/O the
// edge runs via ctx.waitUntil. Kept as plain functions rather than a domain-emitted effect union —
// each transition emits essentially one effect, so a dispatcher would be indirection without payoff.
// The seedingLk these receive is composed once in the composition root (worker/deps.ts, ADR-0030).

// Build the notice for a new row: look it up in nuLiga (filling its player_id/LK when still unlinked)
// and put the LK in effect on the notice. A nuLiga/persistence failure is swallowed so the
// notification still goes out with the row's stored LK. Returns the notice as data (the LK choice is
// the testable part); matchAndNotify is the thin glue that sends it.
export const buildRegistrationNotice = async (
  seedingLk: SeedingLk,
  reg: RegistrationRow
): Promise<RegistrationNotice> => {
  let { lk } = reg
  try {
    lk = await seedingLk.matchOnRegister(reg)
  } catch {
    // nuLiga unreachable etc. → notify with the row's stored LK rather than failing the send.
  }
  return { ...reg, lk }
}

// register's background side effect: the member's response never waits on this (the edge runs it via
// ctx.waitUntil).
export const matchAndNotify = async (env: Env, seedingLk: SeedingLk, reg: RegistrationRow): Promise<void> => {
  await notifyRegistration(env, await buildRegistrationNotice(seedingLk, reg))
}
