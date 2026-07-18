import { describe, expect, it } from 'vitest'
import { FIELD_EXPLAINERS, fieldChipsFor, fieldExplainerFor } from '../src/data/field-explainers'

// FIELD_EXPLAINERS is the single source for the soft-field objection-flips and chips shared by the
// Damen porch (explainer-damen.astro) and the front-door self-selection grid (#223). The whole point
// of the module is that the two surfaces cannot silently drift — so these tests pin the exact copy.
// A screenshot would not catch a flipped word or a dropped fear; this does.
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

  it('carries the Herren Challenger flip + chip, keyed under mens-challenger (#220 copy)', () => {
    const challenger = fieldExplainerFor('mens-challenger')
    // Single warm line, not a fear-removal list — the chip carries the protection rule.
    expect(challenger.flip).toBe(
      'Du spielst zum Spaß, vielleicht sogar dein erstes Turnier? Genau dafür ist das Feld da. Keine LK, keine Turniererfahrung nötig — einfach mitspielen.'
    )
    expect(challenger.chips).toEqual(['Ab LK 20 · geschützt'])
    // The protection rule is „Ab LK 20 · geschützt"; the flip only invites and never leads with LK.
    expect(challenger.notNeeded).toBeUndefined()
  })

  it('fails loud for a competition without an explainer', () => {
    // `mens` (Hauptfeld) has no objection-flip on any surface — it is not in the map, and asking for
    // it must throw with the slug rather than return undefined into a template.
    expect(FIELD_EXPLAINERS.mens).toBeUndefined()
    expect(() => fieldExplainerFor('mens')).toThrow('mens')
  })

  it('returns chips softly — the front-door grid renders chips per field, and mens has none (#229)', () => {
    // The self-selection grid asks every card for its chips; `mens` (Hauptfeld) legitimately has no
    // explainer, so the chip lookup must degrade to an empty list rather than throw like fieldExplainerFor.
    expect(fieldChipsFor('mens')).toEqual([])
    expect(fieldChipsFor('mens-challenger')).toEqual(['Ab LK 20 · geschützt'])
    expect(fieldChipsFor('womens')).toEqual(fieldExplainerFor('womens').chips)
  })
})
