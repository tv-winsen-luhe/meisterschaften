import { z } from 'zod'

// The competitions a member can register for — the single source of truth for the
// `competition` slug, replacing the worker's hardcoded COMPETITIONS list. `womens-social`
// is the Social mixer (the unseeded women's field, ADR-0051), offered beside the women's
// championship — signup-only, never drawn; the `-social` suffix marks it unseeded
// (isUnseededCompetition, shared/seeding.ts).
// (Code identifier: competition; see CONTEXT.md for the domain term and its German alias.)
export const COMPETITION_SLUGS = ['mens', 'mens-challenger', 'womens', 'womens-social'] as const

export const competitionSlug = z.enum(COMPETITION_SLUGS)

export type CompetitionSlug = z.infer<typeof competitionSlug>
