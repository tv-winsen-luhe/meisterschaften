import type { CompetitionSlug } from '../../shared/competition'

// A field's objection-flip pairs, aside pairs and format chips, keyed by competition slug so the
// outreach porches (ADR-0052) and the front-door self-selection grid (#223) read from *one* source
// and cannot silently drift. Before this module the Damen porch held these as local consts in
// `explainer-damen.astro`; the front door had no equivalent, so the moment #223 rebuilt the grid the
// two surfaces would have carried two independently-edited copies of the same flip. This is that
// single source. English identifiers, German user-facing strings (ADR-0028).
//
// The two soft fields do NOT share a flip shape, and that asymmetry is the copy, not an accident:
//   - Damen Doppel (`womens-social`) removes a *bar*: a struck-through „Das brauchst du hier nicht"
//     list, each pair naming a concrete beginner fear and dissolving the standard behind it (ADR-0054
//     amendment 2026-07-13) — not the forbidden reassurance „du bist gut genug".
//   - Herren Challenger (`mens-challenger`) is a single warm „einfach mitspielen" line (#220): one
//     paragraph in a competitive-field-safe register, never the LK-mechanic lead. The factual chip
//     `Ab LK 20 · geschützt` carries the protection rule; the line only invites.

/** A claim (fear or fact) paired with the line that flips or explains it. */
export type FlipPair = readonly [claim: string, detail: string]

export interface FieldExplainer {
  /** Short factual chips summarising the field's format. */
  chips: readonly string[]
  /**
   * Struck-through „Das brauchst du hier nicht" objection-flips: each pair names a beginner fear and
   * removes the bar behind it. Social Damen Doppel only.
   */
  notNeeded?: readonly FlipPair[]
  /** Positive „Gut zu wissen" aside — the field's low-barrier facts made scannable. */
  goodToKnow?: readonly FlipPair[]
  /**
   * Single warm objection-flip line (Herren Challenger, #220) — one paragraph, not a fear-removal
   * list. The `chips` carry the protection rule; this line only invites.
   */
  flip?: string
}

export const FIELD_EXPLAINERS: Partial<Record<CompetitionSlug, FieldExplainer>> = {
  // Damen Doppel-Mixer — the social field the Damen probe leads with (ADR-0054).
  'womens-social': {
    chips: [
      'Am Sonntag',
      'Allein anmelden',
      'Anfängerinnen willkommen',
      'Partnerinnen wechseln reihum',
      'Auch ohne Doppel-Erfahrung',
      'Keine fliegt raus'
    ],
    notNeeded: [
      ['Zählen können', 'Wir sagen dir, wo ihr steht — Punkte zählt hier niemand nach.'],
      ['Einen sicheren Aufschlag', 'Von unten aufschlagen ist völlig okay. Hauptsache, der Ball ist im Spiel.'],
      ['Lange Ballwechsel', 'Zwei, drei Bälle übers Netz sind schon ein schöner Ballwechsel.'],
      ['Turniererfahrung', 'Für viele hier ist es das erste Mal. Genau dafür ist dieser Tag gemacht.']
    ]
  },
  // Damen Einzel — the championship field, the honest second option on the porch.
  womens: {
    chips: ['Am Samstag', 'Um den Titel', 'K.-o.-System', 'Titel: Winsener Meisterin'],
    goodToKnow: [
      ['Ohne Mannschaft', 'Du meldest dich allein an.'],
      ['Ohne Vorkenntnisse', 'Egal wie du spielst, anmelden reicht.'],
      ['Ohne Gewinnzwang', 'Es geht ums Mitspielen und Sich-Messen.']
    ]
  },
  // Herren Hauptfeld — the open championship field. Its chips + „Gut zu wissen" pairs feed the
  // front-door self-selection grid; the `mens` card carries these chips (it had none before ADR-0056),
  // which brings it in line with its three siblings. (The Herren porch also read this source until
  // ADR-0057 retired it; the front door is now the only reader, and the Challenger's fairness flip lives
  // here too — see `mens-challenger` below.)
  mens: {
    chips: ['K.-o.-System', 'Titel: Winsener Meister', 'Offen für alle'],
    goodToKnow: [
      ['Offen für alle', 'Egal welche LK — oder gar keine.'],
      ['Ohne Mannschaft', 'Punktspiele sind keine Voraussetzung.'],
      ['Mindestens zwei Matches', 'Erstrundenverlierer spielen in der Nebenrunde weiter.']
    ]
  },
  // Herren Challenger — the protected field, framed by fairness not beginner-reassurance (ADR-0056/0057).
  // It now lands the broad Herren send on the front door, so the line leads with the mechanism + promise
  // (geschützt, Augenhöhe, eigener Titel) and never a „Freizeit/Einsteiger" deficit identity. A factual
  // low-barrier welcome stays for the cold walk-up (#220), but the rejected „erstes Turnier / keine
  // Turniererfahrung nötig" register is gone. The chip carries the protection rule; the line invites.
  'mens-challenger': {
    chips: ['Ab LK 20 · geschützt'],
    flip: 'Der Challenger ist das geschützte Feld — nur ab LK 20, Stärkere spielen im Hauptfeld. Also ausgeglichene Matches statt Kanonenfutter, echter Wettkampf und ein eigener Titel. Offen für alle ab LK 20, auch ganz ohne LK — egal ob du regelmäßig spielst oder erst wieder anfängst.'
  }
}

/**
 * The field explainer for a competition slug. Every consumer goes through here so a slug without an
 * explainer fails loud (which field is missing) rather than a cryptic `undefined` in the template —
 * the same fail-loud contract as `cardStyleFor` (competition-cards.ts).
 */
export const fieldExplainerFor = (slug: CompetitionSlug): FieldExplainer => {
  const explainer = FIELD_EXPLAINERS[slug]
  if (!explainer) throw new Error(`No FieldExplainer for competition "${slug}"`)
  return explainer
}

/**
 * A field's format chips, or an empty list when it has no explainer. Unlike `fieldExplainerFor`, this is
 * deliberately soft: the front-door self-selection grid (#229) asks *every* card for its chips, and the
 * Herren Hauptfeld (`mens`) legitimately carries none — a missing explainer there is data, not a bug.
 */
export const fieldChipsFor = (slug: CompetitionSlug): readonly string[] => FIELD_EXPLAINERS[slug]?.chips ?? []
