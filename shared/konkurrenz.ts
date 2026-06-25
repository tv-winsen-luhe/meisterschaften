import { z } from 'zod'

// The Konkurrenzen a member can register for — the single source of truth for the
// `competition` slug, replacing the worker's hardcoded COMPETITIONS list. The planned
// "Damen Freizeit" field (tournament.ts) is not yet a registerable Konkurrenz.
export const KONKURRENZ_SLUGS = ['mens', 'mens-challenger', 'womens'] as const

export const konkurrenzSlug = z.enum(KONKURRENZ_SLUGS)

export type Konkurrenz = z.infer<typeof konkurrenzSlug>
