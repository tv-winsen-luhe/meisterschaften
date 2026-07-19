import { describe, expect, it } from 'vitest'
import { FIELD_EXPLAINERS, fieldChipsFor, fieldExplainerFor } from '../src/data/field-explainers'

// FIELD_EXPLAINERS is the single source for the field objection-flips and chips shared by the Damen
// porch (explainer-damen.astro) and the front-door self-selection grid (#223). The
// whole point of the module is that the surfaces cannot silently drift — so these tests pin the exact
// copy. A screenshot would not catch a flipped word or a dropped fear; this does.
describe('field explainers', () => {
  it('pins the Damen Doppel „Das brauchst du hier nicht" set exactly (drift guard)', () => {
    // The four concrete beginner fears + their bar-removals (ADR-0054 amendment). Exact-match, in
    // order — a reworded flip or a fifth fear must be a deliberate edit here, never an accident.
    expect(fieldExplainerFor('womens-social').notNeeded).toEqual([
      ['Zählen können', 'Wir sagen dir, wo ihr steht — Punkte zählt hier niemand nach.'],
      ['Einen sicheren Aufschlag', 'Von unten aufschlagen ist völlig okay. Hauptsache, der Ball ist im Spiel.'],
      ['Lange Ballwechsel', 'Zwei, drei Bälle übers Netz sind schon ein schöner Ballwechsel.'],
      ['Turniererfahrung', 'Für viele hier ist es das erste Mal. Genau dafür ist dieser Tag gemacht.']
    ])
  })

  it('carries the Damen chip labels for both porch fields', () => {
    expect(fieldExplainerFor('womens-social').chips).toEqual([
      'Am Sonntag',
      'Allein anmelden',
      'Anfängerinnen willkommen',
      'Partnerinnen wechseln reihum',
      'Auch ohne Doppel-Erfahrung',
      'Keine fliegt raus'
    ])
    expect(fieldExplainerFor('womens').chips).toEqual([
      'Am Samstag',
      'Um den Titel',
      'K.-o.-System',
      'Titel: Winsener Meisterin'
    ])
  })

  it('carries the Herren Challenger fairness flip + chip, keyed under mens-challenger (ADR-0057)', () => {
    const challenger = fieldExplainerFor('mens-challenger')
    // Fairness-led, not beginner-reassurance (ADR-0056/0057): the field now lands the broad Herren send
    // on the front door, so it is framed by mechanism + promise (geschützt, Augenhöhe, eigener Titel),
    // never by a „Freizeit/Einsteiger" deficit identity. A factual low-barrier welcome stays for the
    // cold walk-up (#220), but the rejected „erstes Turnier / keine Turniererfahrung nötig" is gone.
    expect(challenger.flip).toBe(
      'Der Challenger ist das geschützte Feld — nur bis LK 20, Stärkere spielen im Hauptfeld. Also ausgeglichene Matches statt Kanonenfutter, echter Wettkampf und ein eigener Titel. Offen für alle bis LK 20, auch ganz ohne LK — egal ob du regelmäßig spielst oder erst wieder anfängst.'
    )
    expect(challenger.chips).toEqual(['Ab LK 20 · geschützt'])
    // The protection rule is „Ab LK 20 · geschützt"; the flip invites and never leads with LK.
    expect(challenger.notNeeded).toBeUndefined()
  })

  it('pins the Herren Hauptfeld chips + „Gut zu wissen" set exactly (ADR-0056)', () => {
    // The Hauptfeld gained an explainer when the Herren porch became a rich conversion surface. Its
    // chips + „Gut zu wissen" pairs are the shared source the porch and the front-door grid both read.
    const hauptfeld = fieldExplainerFor('mens')
    expect(hauptfeld.chips).toEqual(['K.-o.-System', 'Titel: Winsener Meister', 'Offen für alle'])
    expect(hauptfeld.goodToKnow).toEqual([
      ['Offen für alle', 'Egal welche LK — oder gar keine.'],
      ['Ohne Mannschaft', 'Punktspiele sind keine Voraussetzung.'],
      ['Mindestens zwei Matches', 'Erstrundenverlierer spielen in der Nebenrunde weiter.']
    ])
    // „Gut zu wissen", not the Damen „Das brauchst du hier nicht" fear-removal list.
    expect(hauptfeld.notNeeded).toBeUndefined()
  })

  it('fails loud for a competition slug without an explainer', () => {
    // Every registerable field now carries an explainer, but the fail-loud contract still holds for any
    // slug that is not in the map — asking must throw with the slug rather than return undefined.
    expect(FIELD_EXPLAINERS['nonexistent' as keyof typeof FIELD_EXPLAINERS]).toBeUndefined()
    expect(() => fieldExplainerFor('nonexistent' as never)).toThrow('nonexistent')
  })

  it('returns chips per field, softly degrading to [] for a slug with no explainer (#229)', () => {
    // The self-selection grid asks every card for its chips. Every registerable field has an explainer
    // now, so each returns its chips; a slug not in the map degrades to [] rather than throwing.
    expect(fieldChipsFor('mens')).toEqual(['K.-o.-System', 'Titel: Winsener Meister', 'Offen für alle'])
    expect(fieldChipsFor('mens-challenger')).toEqual(['Ab LK 20 · geschützt'])
    expect(fieldChipsFor('womens')).toEqual(fieldExplainerFor('womens').chips)
    expect(fieldChipsFor('nonexistent' as never)).toEqual([])
  })
})
