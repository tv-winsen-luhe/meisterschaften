import type { Env } from './app'
import type { RegistrationRow } from './db/schema'
import { notifyRegistration } from './notify'
import type { SeedingLk } from './seeding-lk'

// The registration side-effect orchestration lives at the transport edge, not in the domain
// (ADR-0011 amendment): the domain returns its Result; these named functions perform the I/O the
// edge runs via ctx.waitUntil. Kept as plain functions rather than a domain-emitted effect union —
// each transition emits essentially one effect, so a dispatcher would be indirection without payoff.
// The seedingLk these receive is composed once in the composition root (worker/deps.ts, ADR-0030).

// register's background side effect: look the new row up in nuLiga (filling its player_id/LK when
// still unlinked) and send the Telegram notification with the LK in effect. A nuLiga/persistence
// failure is swallowed so the notification still goes out with the row's stored LK — the member's
// response never waits on this (the edge runs it via ctx.waitUntil).
export const matchAndNotify = async (env: Env, seedingLk: SeedingLk, reg: RegistrationRow): Promise<void> => {
  let { lk } = reg
  try {
    lk = await seedingLk.matchOnRegister(reg)
  } catch {
    // nuLiga unreachable etc. → notify with the row's stored LK rather than failing the send.
  }
  await notifyRegistration(env, { ...reg, lk })
}
