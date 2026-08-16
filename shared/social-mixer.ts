// The Social mixer's court reservation (CONTEXT: Mixer block, ADR-0063, ADR-0051 §5). The mixer is never
// drawn, so it materializes no `matches` rows and cannot be *placed* on the grid — its court-time is
// configuration, not a row: one block, for one weekend, known at build time. Held here in `shared/` so the
// validator, the admin grid, the public schedule, the front-door card and the court-load gauge all read
// one definition rather than five copies of a time (ADR-0048). A `reservations` table is the right answer
// the day a *second* reservation exists; that is the trigger to revisit, not this one.
//
// Sunday (the finals day), courts 4–6, 12:00–15:00: three hours because the rotation format needs them
// (~9 rounds of 18 minutes plus a briefing), courts 5 & 6 because the floodlit pair is the overflow valve
// for a packed *Saturday* (ADR-0040) and costs the Sunday finals nothing, and 15:00 because it puts the
// mixer's players at the Siegerehrung rather than beside it (ADR-0051 §5).
export const SOCIAL_MIXER_BLOCK = {
  day: 1,
  courts: [4, 5, 6],
  startMinutes: 12 * 60,
  endMinutes: 15 * 60
} as const

/** The mixer block's clock window as „HH:MM–HH:MM" — one formatting, shared by the operator and public copy. */
export const socialMixerBlockTime = (): string => {
  const clock = (total: number) =>
    `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  return `${clock(SOCIAL_MIXER_BLOCK.startMinutes)}–${clock(SOCIAL_MIXER_BLOCK.endMinutes)}`
}
