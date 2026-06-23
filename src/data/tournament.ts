export type CompetitionStatus = 'offen' | 'geplant'

export interface Competition {
  id: string
  /** Wert, der im Anmeldeformular und in der D1-Spalte `konkurrenz` landet. */
  value: string
  label: string
  /** Kurzbeschreibung für die Konkurrenz-Card. */
  blurb: string
  /** Teilnahmevoraussetzung (z. B. LK-Grenze) — optional. */
  voraussetzung?: string
  titel: string
  status: CompetitionStatus
  /** Im Anmeldeformular auswählbar? (Damen ist „in Planung" → false) */
  selectable: boolean
}

const TOURNAMENT_START = new Date('2026-08-22T09:00:00+02:00')
const SIGNUP_DEADLINE = new Date('2026-08-19T23:59:00+02:00')

export const venue = {
  organisation: 'TV Winsen/Luhe von 1913 e.V.',
  street: 'Luhdorfer Str. 47a',
  cityLine: '21423 Winsen (Luhe)',
  mapsUrl: 'https://maps.app.goo.gl/rndtuka3qNptRi2E7'
} as const

/** "Luhdorfer Str. 47a, 21423 Winsen (Luhe)" — single-line representation. */
export const venueAddress = `${venue.street}, ${venue.cityLine}`

export const contactEmail = 'sportwart@tennisverein-winsen.de'

/** Startgeld pro Person, bar vor Ort, in EUR. */
export const startgeld = 5

/** Default-LK für Teilnehmer ohne nuLiga-Eintrag (wird im Admin gesetzt). */
export const defaultLk = '25.0'

/** LK-Obergrenze des Challenger-Felds (Schutz nach oben). */
export const challengerMinLk = 20

export const competitions: readonly Competition[] = [
  {
    id: 'herren',
    value: 'herren',
    label: 'Herren',
    blurb:
      'Das Hauptfeld — offen für alle Herren von TV Winsen/Luhe und TSV Winsen. Hier wird der Winsener Meister ausgespielt.',
    titel: 'Winsener Meister Herren',
    status: 'offen',
    selectable: true
  },
  {
    id: 'herren-challenger',
    value: 'herren-challenger',
    label: 'Herren Challenger',
    blurb:
      'Das geschützte Feld: nur für Spieler mit Leistungsklasse 20 oder höher. Stärkere Spieler sind nicht zugelassen — hier zählt das Match, nicht der Abschuss.',
    voraussetzung: 'Nur LK 20+ · klubunabhängig',
    titel: 'Winsener Meister Herren Challenger',
    status: 'offen',
    selectable: true
  },
  {
    id: 'damen',
    value: 'damen',
    label: 'Damen',
    blurb:
      'Eine Damen-Konkurrenz ist in Planung — ein Wettkampffeld um die Winsener Meisterin sowie ein geselliges Zweitformat. Details nach den Vorgesprächen Anfang Juli.',
    titel: 'Winsener Meisterin',
    status: 'geplant',
    selectable: false
  }
] as const

/** Im Formular auswählbare Konkurrenzen (Damen noch nicht). */
export const signupKonkurrenzen = competitions.filter(c => c.selectable)

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

/** Turnier-Wochenende (Sa/So). */
export const tournament = {
  start: TOURNAMENT_START,
  /** "22./23." */
  shortRange: '22./23.',
  /** "August" */
  month: 'August',
  /** "08" — Monat numerisch */
  monthNum: '08',
  /** "2026" */
  year: '2026',
  /** "22./23.08." */
  shortRangeNumeric: '22./23.08.',
  /** "22./23.08.2026" */
  long: '22./23.08.2026',
  /** "Sa/So, 22./23.08.2026" */
  longWithWeekdays: 'Sa/So, 22./23.08.2026',
  /** "09:00" — Startzeit Samstag */
  startTime: '09:00',
  saturday: { weekday: 'Samstag', short: '22.08.', date: '22. August' },
  sunday: { weekday: 'Sonntag', short: '23.08.', date: '23. August' }
}

export const signupDeadline = {
  date: SIGNUP_DEADLINE,
  /** "19.08." */
  short: `${sdParts.day}.${sdParts.month}.`,
  /** "19.08.2026" */
  long: `${sdParts.day}.${sdParts.month}.${sdParts.year}`
}

/** Eckdaten für die Fakten-Tabelle. */
export const facts = {
  veranstalter: 'TV Winsen/Luhe (gemeinsam mit TSV Winsen)',
  teilnahme: 'Mitglieder von TV Winsen/Luhe und TSV Winsen',
  wertung: 'Vereinsinternes Turnier — keine LK-Wertung',
  courts: '6 Sandplätze',
  modus: 'K.O.-System mit Nebenrunde',
  zaehlweise: 'Zwei Gewinnsätze, bei 1:1 Match-Tie-Break bis 10',
  setzung: 'nach aktueller Leistungsklasse (nuLiga)'
} as const
