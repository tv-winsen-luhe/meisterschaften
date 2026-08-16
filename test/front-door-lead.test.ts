import { describe, expect, it } from 'vitest'
import { frontDoorLead, matchesLead } from '../src/scripts/front-door-lead'
import { PHASES } from '../shared'

// The front door's stage rule (ADR-0060 §1/§7): the homepage reads the phase plus two booleans —
// whether anything is drawn and whether the schedule is published — and derives from them which
// lead it shows and in which order it presents its sections. The function must be total across the
// whole cross-product, including the combinations the system cannot actually produce (a published
// schedule without a draw), because a partial rule would fall through to `undefined` on the one
// weekend it matters.
describe('frontDoorLead', () => {
  const cross = PHASES.flatMap(phase =>
    [false, true].flatMap(drawn => [false, true].map(schedulePublished => ({ phase, drawn, schedulePublished })))
  )

  it('is total across phase × drawn × schedulePublished', () => {
    expect(cross).toHaveLength(12)
    for (const input of cross) {
      const { leads, order } = frontDoorLead(input)
      expect(leads.length).toBeGreaterThan(0)
      expect(['marketing', 'results']).toContain(order)
    }
  })

  it('signup ignores both bits: signup lead, marketing order', () => {
    for (const input of cross.filter(i => i.phase === 'signup')) {
      expect(frontDoorLead(input)).toEqual({ leads: ['signup'], order: 'marketing' })
    }
  })

  it('post-event ignores both bits: post-event lead, results order', () => {
    for (const input of cross.filter(i => i.phase === 'post-event')) {
      expect(frontDoorLead(input)).toEqual({ leads: ['post-event'], order: 'results' })
    }
  })

  // Stage 1 — the field is closed, nothing is drawn yet. The lead points at „Das Feld", the one
  // surface with content in this stretch; /spielplan would still show „noch nicht veröffentlicht".
  it('tournament with neither bit ⇒ stage 1 (Feld)', () => {
    expect(frontDoorLead({ phase: 'tournament', drawn: false, schedulePublished: false })).toEqual({
      leads: ['tournament', 'tournament-field'],
      order: 'results'
    })
  })

  // Stage 2 — a bracket exists. `/api/draw` is non-empty from the first revealed step (ADR-0046),
  // so a running reveal already leads with the draw.
  it('tournament with a draw ⇒ stage 2 (Draw)', () => {
    expect(frontDoorLead({ phase: 'tournament', drawn: true, schedulePublished: false })).toEqual({
      leads: ['tournament', 'tournament-draw'],
      order: 'results'
    })
  })

  // Stage 3 — precedence is published → drawn → neither, so the published flag wins over the draw.
  it('tournament with a published schedule ⇒ stage 3 (Spielplan), draw bit or not', () => {
    for (const drawn of [false, true]) {
      expect(frontDoorLead({ phase: 'tournament', drawn, schedulePublished: true })).toEqual({
        leads: ['tournament', 'tournament-schedule'],
        order: 'results'
      })
    }
  })

  // The degrade-downward rule (ADR-0060 §8): a failed extra read is passed in as `false`, which is
  // stage 1 — never the signup lead, and never a pointer at an empty page.
  it('both bits false is the failure fallback and is stage 1', () => {
    expect(frontDoorLead({ phase: 'tournament', drawn: false, schedulePublished: false }).leads).toContain(
      'tournament-field'
    )
  })

  it('every tournament stage keeps the phase-wide `tournament` token', () => {
    for (const input of cross.filter(i => i.phase === 'tournament')) {
      expect(frontDoorLead(input).leads).toContain('tournament')
    }
  })
})

// `data-phase-lead` carries a whitespace-separated list of tokens (ADR-0060 amendment §3) so one
// element can be shared by several phases („signup tournament") instead of shipping two identical
// hidden copies.
describe('matchesLead', () => {
  it.each([
    ['signup', ['signup'], true],
    ['signup', ['tournament', 'tournament-field'], false],
    ['signup tournament', ['tournament', 'tournament-draw'], true],
    ['signup tournament', ['post-event'], false],
    ['tournament-field', ['tournament', 'tournament-field'], true],
    ['tournament-field', ['tournament', 'tournament-draw'], false],
    ['post-event', ['post-event'], true]
  ] as const)('%s against %j → %s', (attr, leads, expected) => {
    expect(matchesLead(attr, [...leads])).toBe(expected)
  })

  it('tolerates ragged whitespace and an empty attribute', () => {
    expect(matchesLead('  signup\n  tournament ', ['tournament'])).toBe(true)
    expect(matchesLead('', ['signup'])).toBe(false)
    expect(matchesLead('   ', ['signup'])).toBe(false)
    expect(matchesLead(null, ['signup'])).toBe(false)
  })

  // A token must match whole: `tournament` must not reveal the stage-specific `tournament-draw`
  // lead, which is exactly the substring trap a naive `includes` would fall into.
  it('matches whole tokens, not substrings', () => {
    expect(matchesLead('tournament-draw', ['tournament'])).toBe(false)
    expect(matchesLead('tournament', ['tournament-draw'])).toBe(false)
  })
})
