import { CHALLENGER_MIN_LK, DEFAULT_LK } from '../../shared/constants'
import { COMPETITION_SLUGS } from '../../shared/competition'
import { SCHEDULE } from '../../shared/schedule'

export type CompetitionStatus = 'open' | 'planned'

export interface Competition {
  id: string
  /** Slug stored in the form, the D1 `competition` column and `data-` attributes. */
  slug: string
  label: string
  /** Short plain-language descriptor shown under the title (e.g. in the participant list). */
  tagline?: string
  /** Self-identification one-liner for the "which field is mine?" framing. */
  audience: string
  /** Short description for the competition card. */
  blurb: string
  /** Formal entry requirement (e.g. LK limit) — optional, shown as small print. */
  requirement?: string
  /** Max participants — drives the "Plätze frei" count on the participant list. */
  capacity?: number
  title: string
  status: CompetitionStatus
}

const TOURNAMENT_START = new Date('2026-08-22T09:00:00+02:00')
const SIGNUP_DEADLINE = new Date('2026-08-19T23:59:00+02:00')

export const venue = {
  organisation: 'TV Winsen von 1913 e.V.',
  street: 'Luhdorfer Str. 47a',
  cityLine: '21423 Winsen (Luhe)',
  mapsUrl: 'https://maps.app.goo.gl/rndtuka3qNptRi2E7'
} as const

/** "Luhdorfer Str. 47a, 21423 Winsen (Luhe)" — single-line representation. */
export const venueAddress = `${venue.street}, ${venue.cityLine}`

export const contactEmail = 'sportwart@tennisverein-winsen.de'

/** Entry fee per person, cash on site, in EUR. */
export const entryFee = 5

/**
 * Court-throughput assumption behind the admin's total-utilization gauge (ADR-0023 follow-up). The
 * venue has 6 courts; at ~90 min per match a court turns ~6 matches in a ~9 h playing day, across
 * both event days. `matchSlotsPerWeekend` (= 72) is the 100 % the gauge measures the projected
 * match load against. A planning figure — derived from the same `SCHEDULE` shape the real grid is
 * built on (shared/schedule.ts), so the gauge and the schedule can never disagree on court count or
 * slots-per-day.
 */
export const courtSchedule = {
  courts: SCHEDULE.courts,
  matchMinutes: SCHEDULE.slotMinutes,
  matchesPerCourtPerDay: SCHEDULE.slotsPerDay,
  days: SCHEDULE.days
} as const
export const matchSlotsPerWeekend = courtSchedule.courts * courtSchedule.matchesPerCourtPerDay * courtSchedule.days

/**
 * Provisional court-slot reservation for the planned Damen-Freizeit field, which shares the event
 * weekend's courts (ADR-0023). A placeholder until the format is decided (talks 02.07): set the
 * real figure once group format, size and match length are known. Shown as its own segment in the
 * total-utilization gauge so the championship load and this reservation read against the same 72-slot budget.
 */
export const freizeitReservedSlots = 10

/** Default LK for participants without a nuLiga entry (set in admin). Single source: shared/. */
export const defaultLk = DEFAULT_LK

/** LK threshold of the Challenger field (protected upwards). Single source: shared/. */
export const challengerMinLk = CHALLENGER_MIN_LK

export const competitions: readonly Competition[] = [
  {
    id: 'womens',
    slug: 'womens',
    label: 'Damen',
    tagline: 'Hauptfeld — offen für alle. Hier wird die Winsener Meisterin ausgespielt.',
    audience:
      'Du hast Lust, dich im Match zu messen und um den Titel mitzuspielen — egal, wie gut du dich gerade selbst einschätzt.',
    blurb:
      'Das Hauptfeld — offen für alle. Hier wird die Winsener Meisterin ausgespielt. Du musst dafür weder in einer Mannschaft spielen noch deine Leistungsklasse kennen.',
    title: 'Winsener Meisterin',
    capacity: 8,
    status: 'open'
  },
  {
    id: 'mens',
    slug: 'mens',
    label: 'Herren',
    tagline: 'Hauptfeld — offen für alle. Hier wird der Winsener Meister ausgespielt.',
    audience: 'Du spielst Punktspiele, trainierst regelmäßig und willst dich mit den Stärksten messen.',
    blurb:
      'Das Hauptfeld — offen für alle. Hier treten die stärksten Spieler an und hier wird der Winsener Meister ausgespielt.',
    title: 'Winsener Meister Herren',
    capacity: 16,
    status: 'open'
  },
  {
    id: 'mens-challenger',
    slug: 'mens-challenger',
    label: 'Herren Challenger',
    tagline: 'Geschütztes Freizeit- & Einsteiger-Feld — nur ab LK 20 (bzw. ohne LK)',
    audience:
      'Du spielst eher zum Spaß, bist Wieder- oder Einsteiger oder seit Jahren gemütlich dabei und hast keine oder eine hohe Leistungsklasse.',
    blurb:
      'Das geschützte Feld: Wer besser als LK 20 ist, spielt im Hauptfeld und ist hier nicht zugelassen — so triffst du auf Gegner auf Augenhöhe. Keine LK? Dann zählst du als LK 25 und bist genau richtig.',
    title: 'Winsener Meister Herren Challenger',
    capacity: 16,
    status: 'open'
  },
  {
    id: 'womens-challenger',
    slug: 'womens-challenger',
    label: 'Damen Freizeit',
    audience: 'Du spielst vor allem zum Spaß und fürs Miteinander — Wettkampf muss nicht im Vordergrund stehen.',
    blurb:
      'Ein lockeres, geselliges Damen-Feld ohne Titeldruck. Wie das Format genau aussieht, besprechen wir bei den Gesprächen am 02.07.',
    title: '',
    status: 'planned'
  }
] as const

/**
 * Competitions offered in the signup form — exactly the registerable competitions, i.e. those whose
 * slug is in the contract (`COMPETITION_SLUGS`). Derived, not a separate flag: the form provably
 * cannot offer a value `registerRequestSchema` would reject, and opening a field for registration is
 * a single edit to the contract. "Planned" competitions (e.g. Damen Freizeit) are absent until then.
 */
export const signupCompetitions = competitions.filter(c => (COMPETITION_SLUGS as readonly string[]).includes(c.slug))

const TZ = 'Europe/Berlin'

const partsFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: TZ
})

const partsOf = (d: Date) => {
  const parts = partsFmt.formatToParts(d)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  return { day: get('day'), month: get('month'), year: get('year') }
}

const sdParts = partsOf(SIGNUP_DEADLINE)

/** Tournament weekend (Sat/Sun). */
export const tournament = {
  start: TOURNAMENT_START,
  /** "22.-23." */
  shortRange: '22.-23.',
  /** "2026" */
  year: '2026',
  /** "22.-23.08." */
  shortRangeNumeric: '22.-23.08.',
  /** "22.-23.08.2026" */
  long: '22.-23.08.2026',
  /** "Sa/So, 22.-23.08.2026" */
  longWithWeekdays: 'Sa/So, 22.-23.08.2026',
  /** "09:00" — Saturday start time */
  startTime: '09:00',
  saturday: { weekday: 'Samstag', short: '22.08.' },
  sunday: { weekday: 'Sonntag', short: '23.08.' }
}

export const signupDeadline = {
  date: SIGNUP_DEADLINE,
  /** "19.08." */
  short: `${sdParts.day}.${sdParts.month}.`,
  /** "19.08.2026" */
  long: `${sdParts.day}.${sdParts.month}.${sdParts.year}`
}

/** Key facts for the "Auf einen Blick" strip. */
export const facts = {
  date: `${tournament.longWithWeekdays} · Start Sa ${tournament.startTime}`,
  venue: 'Tennisanlage TV Winsen · 6 Sandplätze',
  organizer: 'TV Winsen & TSV Winsen',
  eligibility: 'Mitglieder von TV Winsen und TSV Winsen ab 15 Jahren',
  scoring: 'Vereinsintern — keine LK-Wertung',
  format: 'K.O. mit Nebenrunde · 2 Gewinnsätze, bei 1:1 Match-Tie-Break bis 10',
  seeding: 'Setzung nach Leistungsklasse (nuLiga)',
  entryFee: `${entryFee} € pro Person, bar vor Ort`,
  deadline: `${signupDeadline.long} — Auslosung direkt danach`
} as const
