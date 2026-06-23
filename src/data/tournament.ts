export type CompetitionStatus = 'open' | 'planned'

export interface Competition {
  id: string
  /** Slug stored in the form, the D1 `competition` column and `data-` attributes. */
  slug: string
  label: string
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
  /** Selectable in the signup form? (Damen is "in Planung" → false) */
  selectable: boolean
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

/** Default LK for participants without a nuLiga entry (set in admin). */
export const defaultLk = '25.0'

/** LK threshold of the Challenger field (protected upwards). */
export const challengerMinLk = 20

export const competitions: readonly Competition[] = [
  {
    id: 'mens',
    slug: 'mens',
    label: 'Herren',
    audience: 'Du spielst Punktspiele, trainierst regelmäßig und willst dich mit den Stärksten messen.',
    blurb:
      'Das Hauptfeld — offen für alle. Hier treten die stärksten Spielenden an und hier wird der Winsener Meister ausgespielt.',
    title: 'Winsener Meister Herren',
    capacity: 16,
    status: 'open',
    selectable: true
  },
  {
    id: 'mens-challenger',
    slug: 'mens-challenger',
    label: 'Herren Challenger',
    audience: 'Du spielst eher zum Spaß, bist Wieder- oder Einsteiger und hast keine oder eine hohe Leistungsklasse.',
    blurb:
      'Das geschützte Feld: Wer besser als LK 20 ist, spielt im Hauptfeld und ist hier nicht zugelassen — so zählt das Match statt der Abschuss. Keine LK? Dann zählst du als LK 25 und bist genau richtig.',
    requirement: 'LK 20+',
    title: 'Winsener Meister Herren Challenger',
    capacity: 16,
    status: 'open',
    selectable: true
  },
  {
    id: 'womens',
    slug: 'womens',
    label: 'Damen',
    audience: '',
    blurb:
      'In Planung als Pendant zu den Herren: ein Damen-Einzel um die Winsener Meisterin — und, je nach Interesse, ein eigenes geselliges Damen-Format. Was zusammenkommt, klären wir bei den Vorgesprächen Anfang Juli.',
    title: 'Winsener Meisterin',
    status: 'planned',
    selectable: true
  }
] as const

/** Competitions selectable in the signup form (Damen not yet). */
export const signupCompetitions = competitions.filter(c => c.selectable)

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
