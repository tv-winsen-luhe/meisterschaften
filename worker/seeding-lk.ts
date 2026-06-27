import { CLUBS, isActive } from '../shared'
import type { RegistrationsStore } from './store/registrations'

// seedingLk: a pure LK lookup behind a roster port (ADR-0010). It matches a player against
// a club roster and returns the nuLiga identity + LK; it never touches D1. The name-matching
// logic — parseClubRoster / normalizeName / findRosterMatch — lives here exactly once
// (parseClubRoster/findRosterMatch stay exported for their unit tests). Thin orchestrations
// compose lookup with the Store: matchOnRegister (sign-up) and syncAll (cron + admin LK
// refresh). The seeding freeze lives with the draw, not here.

// One player as parsed from a nuLiga club ranking page. camelCase (TS/wire convention);
// the snake_case D1 columns are a separate concern handled in the Drizzle mapping.
export interface RosterEntry {
  playerId: string
  lk: string
  firstName: string
  lastName: string
}

// The roster port: one club's players. The nuLiga adapter (HTTP + parse) backs it in
// production; an in-memory fake backs it in tests. Two adapters ⇒ a real seam.
export interface RosterSource {
  rosterFor(club: string): Promise<RosterEntry[]>
}

// A unique nuLiga match for a player: their id + current LK. null when absent or ambiguous.
export interface SeedingMatch {
  playerId: string
  lk: string
}

// Just enough of a player to look them up in their club roster.
export interface PlayerName {
  club: string
  firstName: string
  lastName: string
}

// The minimum a row needs to be LK-matched after sign-up.
export interface MatchablePlayer {
  id: number
  club: string
  firstName: string
  lastName: string
  playerId: string | null
  lk: string | null
}

export interface SeedingLk {
  /** Match a player against their club roster; the nuLiga identity + LK, or null. */
  lookup(player: PlayerName): Promise<SeedingMatch | null>
  /**
   * After sign-up: look the player up in nuLiga and, when the row is not yet linked, fill
   * its player_id + LK. An already-linked row (e.g. a revived one) keeps its stored linkage
   * but is still looked up so the notifier reports the current LK. Returns the LK in effect
   * — the freshly matched one, falling back to the row's stored LK.
   */
  matchOnRegister(player: MatchablePlayer): Promise<string | null>
  /**
   * Refresh seeding LK across the whole roster (the weekly cron + the admin "↻ LK aus
   * nuLiga" button). Each club roster is fetched once; rows with a player_id get their LK
   * refreshed, and active rows without one are name-matched and linked. Returns how many
   * rows were touched.
   */
  syncAll(): Promise<number>
  /**
   * On confirm, when the operator has linked a player_id: fetch that id's current nuLiga LK
   * and store it. The LK is derived (ADR-0020) — the operator never types it. Returns the
   * freshly fetched value (for the operator toast), or null when nothing was written: no
   * linked id, no rating for the id, or a nuLiga outage. A miss never clobbers a stored LK,
   * so a re-confirm with nuLiga down leaves a previously-resolved rating intact.
   */
  resolveLkOnConfirm(player: MatchablePlayer): Promise<string | null>
}

export interface SeedingLkDeps {
  rosterSource: RosterSource
  store: RegistrationsStore
}

export const createSeedingLk = (deps: SeedingLkDeps): SeedingLk => {
  const { rosterSource, store } = deps

  const lookup: SeedingLk['lookup'] = async player => {
    const roster = await rosterSource.rosterFor(player.club)
    const match = findRosterMatch(roster, player.firstName, player.lastName)
    return match ? { playerId: match.playerId, lk: match.lk } : null
  }

  // The current LK for a known player_id in a club's roster, or null. Internal: the only
  // caller is resolveLkOnConfirm (the confirm-time per-link fetch).
  const lkForPlayerId = async (club: string, playerId: string): Promise<string | null> => {
    const roster = await rosterSource.rosterFor(club)
    return roster.find(e => e.playerId === playerId)?.lk ?? null
  }

  return {
    lookup,
    async matchOnRegister(player) {
      const match = await lookup(player)
      // Fill the linkage only when the row has none yet — never clobber a manual override
      // or a revived row's existing player_id.
      if (match && !player.playerId) await store.setMatch(player.id, match.playerId, match.lk)
      // Report the current LK (fresh match), falling back to whatever the row already had.
      return match?.lk ?? player.lk
    },

    async syncAll() {
      // Fetch each configured club roster once per run, all clubs in parallel.
      const lists = await Promise.all(CLUBS.map(club => rosterSource.rosterFor(club)))
      const rosters = new Map<string, RosterEntry[]>(CLUBS.map((club, i) => [club, lists[i]]))

      // player_id → current LK across all clubs (the linked-row refresh map).
      const lkById = new Map<string, string>()
      for (const list of rosters.values()) for (const e of list) lkById.set(e.playerId, e.lk)

      let updated = 0
      for (const reg of await store.listAll()) {
        // Linked rows: refresh the LK from nuLiga, but only write when it actually changed — so an
        // unchanged weekly sync is a no-op and does not bump updated_at.
        if (reg.playerId) {
          const lk = lkById.get(reg.playerId)
          if (lk && lk !== reg.lk) {
            await store.setLk(reg.id, lk)
            updated++
          }
          continue
        }
        // Active rows without a linkage: try a unique name match against the club roster.
        if (!isActive(reg.status)) continue
        const match = findRosterMatch(rosters.get(reg.club) ?? [], reg.firstName, reg.lastName)
        if (match) {
          await store.setMatch(reg.id, match.playerId, match.lk)
          updated++
        }
      }
      return updated
    },

    async resolveLkOnConfirm(player) {
      // No linkage to resolve → nothing to fetch.
      if (!player.playerId) return null
      try {
        const lk = await lkForPlayerId(player.club, player.playerId)
        // A miss (unrated id) writes nothing and reports null, so a re-confirm never clobbers a
        // resolved LK and the operator toast shows the "no rating fetched" state.
        if (!lk) return null
        await store.setLk(player.id, lk)
        return lk
      } catch {
        // nuLiga unreachable → leave the stored LK untouched; the weekly sync resolves it later.
        return null
      }
    }
  }
}

// ── nuLiga roster source (production) ──────────────────────────────────────────────────
// nuLiga LK club rankings (TNB) — one page per club, listing player id + LK + name. The
// single source of truth for the endpoint + club→nuLiga-id map; internal to this module now
// that the cron and admin LK paths go through createSeedingLk (no more legacy importers).
const NULIGA_BASE = 'https://tnb.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa/clubRankinglistLK?federation=TNB&club='
const CLUB_TO_NULIGA: Record<string, string> = {
  'TV Winsen': '303160',
  'TSV Winsen': '303251'
}

export const createNuligaRosterSource = (): RosterSource => ({
  async rosterFor(club) {
    const clubId = CLUB_TO_NULIGA[club]
    if (!clubId) return []
    try {
      const res = await fetch(NULIGA_BASE + clubId, {
        headers: { 'user-agent': 'winsener-meisterschaften/1.0 (+vereins-tool)' }
      })
      if (!res.ok) return []
      return parseClubRoster(await res.text())
    } catch {
      return []
    }
  }
})

// ── In-memory roster source (tests) ──────────────────────────────────────────────────
export const createInMemoryRosterSource = (rostersByClub: Record<string, RosterEntry[]>): RosterSource => ({
  async rosterFor(club) {
    return rostersByClub[club] ?? []
  }
})

// ── Internal seams: parse + name matching (unit-tested directly) ───────────────────────

/** Parse a nuLiga clubRankinglistLK HTML page into {playerId, lk, lastName, firstName}. */
export const parseClubRoster = (html: string): RosterEntry[] => {
  const out: RosterEntry[] = []
  // Split into table rows; each row holds one player (8-digit id + one or more "LKx,y" + name anchor).
  const rows = html.split(/<tr[\s>]/i)
  for (const row of rows) {
    const idMatch = row.match(/\b(\d{8})\b/)
    if (!idMatch) continue
    const lkMatches = [...row.matchAll(/LK\s*(\d{1,2}[.,]\d)/gi)]
    if (lkMatches.length === 0) continue
    // The first LK in the row is the dedicated "LK" column → the current value.
    // Any further LKs are the dated "Stichtags-LK" history (older snapshots) and must be ignored.
    const lk = lkMatches[0][1].replace(',', '.')
    // Player name lives in an <a id="e_..."> tag as "Lastname, Firstname".
    const nameMatch = row.match(/<a [^>]*id="e_[^"]*"[^>]*>\s*([^<]+?)\s*<\/a>/)
    if (!nameMatch) continue
    const text = nameMatch[1].replace(/&amp;/g, '&').trim()
    const comma = text.indexOf(',')
    if (comma < 0) continue
    const lastName = text.slice(0, comma).trim()
    const firstName = text.slice(comma + 1).trim()
    if (!lastName || !firstName) continue
    out.push({ playerId: idMatch[1], lk, lastName, firstName })
  }
  return out
}

/** Normalize names for matching: lowercase, strip diacritics, ß→ss, collapse whitespace/hyphens. */
const normalizeName = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[\s-]+/g, ' ')
    .trim()

/** Find a unique roster entry for the given name. Returns null if none or ambiguous. */
export const findRosterMatch = (roster: RosterEntry[], firstName: string, lastName: string): RosterEntry | null => {
  const fn = normalizeName(firstName)
  const ln = normalizeName(lastName)
  if (!fn || !ln) return null
  const sameLast = roster.filter(e => normalizeName(e.lastName) === ln)
  if (sameLast.length === 0) return null
  // First-name match: exact, or one is a leading-token prefix of the other (so "Tim" matches "Tim Moritz").
  const matches = sameLast.filter(e => {
    const rfn = normalizeName(e.firstName)
    return rfn === fn || rfn.startsWith(fn + ' ') || fn.startsWith(rfn + ' ')
  })
  return matches.length === 1 ? matches[0] : null
}
