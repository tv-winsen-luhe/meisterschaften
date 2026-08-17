import { z } from 'zod'
import { SCHEDULE, slotStartMinutes } from './schedule'

// The Social mixer's court reservation (CONTEXT: Mixer block, ADR-0064, ADR-0063 §2–§4). The mixer is
// never drawn, so it materializes no `matches` rows and cannot be *placed* on the grid — its court-time is
// **resolved**, not stored as a row: `resolveSocialMixerBlock` is the one place where the operator's
// placement (day + start slot, held on the single app-state row), the confirmed head-count and a possible
// cancellation become one block, and every surface reads that one result (ADR-0048) — the validator, the
// admin grid's shading, the public appointment, the front-door card and the court-load gauge.
//
// The dependency runs `social-mixer → schedule`, the reverse of ADR-0063 §1: the reservation is now
// expressed in the grid's own coordinates (a day and a 30-minute start slot), while `schedule.ts` merely
// *receives* a resolved block as a parameter and needs no import back. One reservation, two stored numbers
// — a `reservations` table is still the right answer the day a *second* reservation exists, and that is
// still the trigger to revisit.

/** Where the operator has put the block: a day and a 30-minute start slot on the grid. */
export interface SocialMixerPlacement {
  day: number
  startSlot: number
}

/** A resolved block: the placement, the courts the head-count earns, and the clock window they span. */
export interface SocialMixerBlock extends SocialMixerPlacement {
  courts: number[]
  startMinutes: number
  endMinutes: number
}

// Sunday (the finals day) at 12:00 — the placement the event was planned around (ADR-0051 §5) and the
// column default behind `app_state`. Inside the busy day rather than a dead evening slot, and ending at
// 15:00 so the mixer's players are at the Siegerehrung rather than beside it.
export const SOCIAL_MIXER_DEFAULT_PLACEMENT: SocialMixerPlacement = { day: 1, startSlot: 6 }

// Three hours, because the rotation format needs them (~9 rounds of 18 minutes plus a briefing). Fixed on
// purpose and not operator-editable: it is a property of the format, not of the time of day, and a third
// input would be free to disagree with the printed rotation tables (ADR-0064 §3).
export const SOCIAL_MIXER_BLOCK_MINUTES = 180

// Four players to a court, the rest rotate out — the same rule the printed rotation runs on
// (`scripts/social-mixer-rotation.mjs`, which carries its own copy: it is plain Node with no build step, so
// a test runs it and compares its columns against `socialMixerCourts` rather than the two sharing a
// module). At most three courts: a fourth would come out of the championship's Sunday, and four players
// rotating out is the cheaper answer (ADR-0063 §5).
const PLAYERS_PER_COURT = 4
const MAX_COURTS = 3

/**
 * The courts a given head-count earns, ascending: `floor(n / 4)` clamped to 1–3 and filled **from the top
 * down** — three courts are [4, 5, 6], two are [5, 6], one is [6]. Top-down because the first court freed
 * is court 4, and Sunday's finals run on courts 1–3, so the release lands where the finals can use it.
 * Never zero: an empty field is a cancellation (ADR-0062), the operator's act, not a silently vanished
 * block.
 */
export const socialMixerCourts = (confirmed: number): number[] => {
  const count = Math.min(MAX_COURTS, Math.max(1, Math.floor(confirmed / PLAYERS_PER_COURT)))
  return Array.from({ length: count }, (_, i) => SCHEDULE.courts - count + 1 + i)
}

/**
 * The start slots the block may take on a given day: every 30-minute start whose three hours are over by
 * the ~20:00 daylight bound (with both days opening at 09:00 today, that is 09:00 through 17:00).
 * Deliberately **one flat bound** rather than the per-court evening windows (ADR-0040) — court 4 is dark
 * while 5 and 6 are floodlit, so a per-court rule would make the legal start times a function of the
 * head-count, and a late registration could then invalidate a time the operator had already chosen
 * (ADR-0064 §4). Per **day**, though: each event day may carry its own first start (ADR-0040), so a bound
 * measured on Saturday must not be assumed to hold on Sunday.
 */
export const socialMixerStartSlots = (day: number): number[] =>
  Array.from({ length: SCHEDULE.slotsPerDay }, (_, slot) => slot).filter(
    slot => slotStartMinutes(day, slot) + SOCIAL_MIXER_BLOCK_MINUTES <= SCHEDULE.daylightEndMinutes
  )

/** Whether a placement is one the operator may set — the server's check, not only the dialog's. */
export const isValidSocialMixerPlacement = ({ day, startSlot }: SocialMixerPlacement): boolean =>
  day >= 0 && day < SCHEDULE.days && socialMixerStartSlots(day).includes(startSlot)

/**
 * The placement's wire form — the operator's two numbers, on `/api/phase` (read) and
 * `/api/admin/social-mixer-block` (write). One schema for both directions, so the server can never accept
 * a placement the public surfaces would then have to render as something the dialog never offered.
 */
export const socialMixerPlacementSchema = z
  .object({ day: z.number().int(), startSlot: z.number().int() })
  .refine(isValidSocialMixerPlacement, { error: 'Der Block muss an einem Spieltag liegen und bis 20:00 Uhr enden.' })

/**
 * The block as it currently stands, or `null` when there is none. A **cancelled** mixer resolves to `null`
 * and `null` means „no block" everywhere: no shading, no violation, nothing reserved, no public line
 * (ADR-0062) — the one place that fact is decided, rather than each surface remembering to ask.
 */
export const resolveSocialMixerBlock = ({
  day,
  startSlot,
  confirmed,
  cancelled = false
}: SocialMixerPlacement & { confirmed: number; cancelled?: boolean }): SocialMixerBlock | null => {
  if (cancelled) return null
  const startMinutes = slotStartMinutes(day, startSlot)
  return {
    day,
    startSlot,
    courts: socialMixerCourts(confirmed),
    startMinutes,
    endMinutes: startMinutes + SOCIAL_MIXER_BLOCK_MINUTES
  }
}

/** The block's clock window as „HH:MM–HH:MM" — one formatting, shared by the operator and public copy. */
export const socialMixerBlockTime = ({ startMinutes, endMinutes }: SocialMixerBlock): string => {
  const clock = (total: number) =>
    `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  return `${clock(startMinutes)}–${clock(endMinutes)}`
}

/**
 * The block's cost in court-budget slots, where one slot is one match: courts × (180 / 90) = 6 on three
 * courts, 4 on two. **Derived** from the block rather than asserted beside it, so the gauge can never
 * disagree with the reservation the validator actually enforces — and no block reserves nothing at all.
 */
export const socialMixerReservedSlots = (block: SocialMixerBlock | null): number =>
  block ? block.courts.length * (SOCIAL_MIXER_BLOCK_MINUTES / SCHEDULE.matchMinutes) : 0
