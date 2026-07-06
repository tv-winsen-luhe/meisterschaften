import { z } from 'zod'

// The two clubs whose members may enter — TV Winsen/Luhe (the organiser) and TSV Winsen
// (participating under a usage contract; the event is TV Winsen's, not a co-billed partnership —
// ADR-0050, a presentation stance that leaves this value untouched). A closed set
// (CONTEXT.md: vereinsintern, members only). Own module mirroring competition.ts: the single
// source of truth for the `club` value, imported by every contract — the read path
// (participants list, admin list) and the write path (register, confirm) — and the seeding
// roster fetch. The German names are the stored/wire values (proper nouns, like the club
// names themselves), not translatable concepts.
export const CLUBS = ['TV Winsen', 'TSV Winsen'] as const

export const clubSchema = z.enum(CLUBS)

export type Club = (typeof CLUBS)[number]
