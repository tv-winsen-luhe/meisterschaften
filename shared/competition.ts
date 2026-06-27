import { z } from 'zod'

// The competitions a member can register for — the single source of truth for the
// `competition` slug, replacing the worker's hardcoded COMPETITIONS list. The planned
// "Damen Freizeit" field (tournament.ts) is not yet a registerable competition.
// (Code identifier: competition; see CONTEXT.md for the domain term and its German alias.)
export const COMPETITION_SLUGS = ['mens', 'mens-challenger', 'womens'] as const

export const competitionSlug = z.enum(COMPETITION_SLUGS)

export type CompetitionSlug = z.infer<typeof competitionSlug>
