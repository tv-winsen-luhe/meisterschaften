import { describe, expect, it } from 'vitest'
import { frontDoorLead, matchesLead } from '../src/scripts/front-door-lead'
import { COMPETITION_SLUGS, PHASES } from '../shared'

// The front door's stage rule (ADR-0060 §1/§7, extended by ADR-0062): the homepage reads the phase,
// two booleans — whether anything is drawn and whether the schedule is published — and the cancelled
// competitions, and derives from them which lead it shows, in which order it presents its sections,
// and which fields it shows at all. The function must be total across the whole cross-product,
// including the combinations the system cannot actually produce (a published schedule without a
// draw), because a partial rule would fall through to `undefined` on the one weekend it matters.
describe('frontDoorLead', () => {
  // The cancellation dimension is sampled rather than exhausted: nothing cancelled, one field, a
  // whole side, everything. The lead rule must not react to any of them, which is what the totality
  // check below asserts across the product.
  const cancellations = [[], ['womens'], ['womens', 'womens-social'], [...COMPETITION_SLUGS]] as const

  const cross = PHASES.flatMap(phase =>
    [false, true].flatMap(drawn =>
      [false, true].flatMap(schedulePublished =>
        cancellations.map(cancelled => ({ phase, drawn, schedulePublished, cancelled: [...cancelled] }))
      )
    )
  )

  it('is total across phase × drawn × schedulePublished × cancelled', () => {
    expect(cross).toHaveLength(48)
    for (const input of cross) {
      const { leads, order, pacing, competitions, cancellationNote } = frontDoorLead(input)
      expect(leads.length).toBeGreaterThan(0)
      expect(['marketing', 'results']).toContain(order)
      expect(['marketing', 'board']).toContain(pacing)
      expect(competitions).toHaveLength(COMPETITION_SLUGS.length - input.cancelled.length)
      expect(cancellationNote === null || cancellationNote.length > 0).toBe(true)
    }
  })

  // The lead and the order answer „what is going on"; the cancellation answers „which fields exist".
  // The two are independent, so a cancellation must never move the page to another stage.
  it('the cancelled set does not move the lead or the order', () => {
    for (const input of cross) {
      const { leads, order } = frontDoorLead({ ...input, cancelled: [] })
      expect(frontDoorLead(input).leads).toEqual(leads)
      expect(frontDoorLead(input).order).toBe(order)
    }
  })

  // The section rhythm (ADR-0072): the front door is a marketing page during `signup` and a board
  // during `tournament`, so the pacing rides on the same derivation as the lead and the order rather
  // than on a second phase read. `post-event` keeps the marketing rhythm — its reader is browsing an
  // archive from a sofa, not standing at the courts choosing which one to walk to.
  it('only tournament is paced as a board', () => {
    for (const input of cross) {
      expect(frontDoorLead(input).pacing).toBe(input.phase === 'tournament' ? 'board' : 'marketing')
    }
  })

  it('the cancelled set does not move the pacing', () => {
    for (const input of cross) {
      expect(frontDoorLead(input).pacing).toBe(frontDoorLead({ ...input, cancelled: [] }).pacing)
    }
  })

  it('signup ignores both bits: signup lead, marketing order', () => {
    for (const input of cross.filter(i => i.phase === 'signup')) {
      const { leads, order } = frontDoorLead(input)
      expect({ leads, order }).toEqual({ leads: ['signup'], order: 'marketing' })
    }
  })

  it('post-event ignores both bits: post-event lead, results order', () => {
    for (const input of cross.filter(i => i.phase === 'post-event')) {
      const { leads, order } = frontDoorLead(input)
      expect({ leads, order }).toEqual({ leads: ['post-event'], order: 'results' })
    }
  })

  // Stage 1 — the field is closed, nothing is drawn yet. The lead points at „Das Feld", the one
  // surface with content in this stretch; /spielplan would still show „noch nicht veröffentlicht".
  it('tournament with neither bit ⇒ stage 1 (Feld)', () => {
    expect(frontDoorLead({ phase: 'tournament', drawn: false, schedulePublished: false, cancelled: [] })).toEqual({
      leads: ['tournament', 'tournament-field'],
      order: 'results',
      pacing: 'board',
      competitions: [...COMPETITION_SLUGS],
      cancellationNote: null
    })
  })

  // Stage 2 — a bracket exists. `/api/draw` is non-empty from the first revealed step (ADR-0046),
  // so a running reveal already leads with the draw.
  it('tournament with a draw ⇒ stage 2 (Draw)', () => {
    const { leads, order } = frontDoorLead({
      phase: 'tournament',
      drawn: true,
      schedulePublished: false,
      cancelled: []
    })
    expect({ leads, order }).toEqual({ leads: ['tournament', 'tournament-draw'], order: 'results' })
  })

  // Stage 3 — precedence is published → drawn → neither, so the published flag wins over the draw.
  it('tournament with a published schedule ⇒ stage 3 (Spielplan), draw bit or not', () => {
    for (const drawn of [false, true]) {
      const { leads, order } = frontDoorLead({ phase: 'tournament', drawn, schedulePublished: true, cancelled: [] })
      expect({ leads, order }).toEqual({ leads: ['tournament', 'tournament-schedule'], order: 'results' })
    }
  })

  // The degrade-downward rule (ADR-0060 §8): a failed extra read is passed in as `false`, which is
  // stage 1 — never the signup lead, and never a pointer at an empty page.
  it('both bits false is the failure fallback and is stage 1', () => {
    expect(
      frontDoorLead({ phase: 'tournament', drawn: false, schedulePublished: false, cancelled: [] }).leads
    ).toContain('tournament-field')
  })

  it('every tournament stage keeps the phase-wide `tournament` token', () => {
    for (const input of cross.filter(i => i.phase === 'tournament')) {
      expect(frontDoorLead(input).leads).toContain('tournament')
    }
  })
})

// Which fields the page shows (ADR-0062 §5). The front door is rendered at build time from the
// static competition list (ADR-0008), so it cannot be served a shorter list the way the data-driven
// surfaces are — it *applies* the cancellation at runtime, through this same rule module. The
// decision still comes from the server as one signal; only the applying happens here.
describe('frontDoorLead — the fields the page shows', () => {
  const at = (cancelled: string[]) =>
    frontDoorLead({ phase: 'tournament', drawn: false, schedulePublished: false, cancelled })

  it('shows the whole line-up while nothing is cancelled', () => {
    expect(at([]).competitions).toEqual([...COMPETITION_SLUGS])
  })

  it('drops a cancelled field and keeps the canonical order', () => {
    expect(at(['mens-challenger']).competitions).toEqual(['mens', 'womens', 'womens-social'])
  })

  // Losing a whole side degrades rather than special-cases (ADR-0062 consequences): both Damen fields
  // gone leaves the two Herren fields standing, in their usual order, and nothing else changes — the
  // page then reads as a Herren-only event because it is one.
  it('both Damen fields cancelled leaves the Herren fields, without special-casing', () => {
    const { competitions, leads, order } = at(['womens', 'womens-social'])
    expect(competitions).toEqual(['mens', 'mens-challenger'])
    expect({ leads, order }).toEqual({ leads: ['tournament', 'tournament-field'], order: 'results' })
  })

  it('every field cancelled leaves nothing to show', () => {
    expect(at([...COMPETITION_SLUGS]).competitions).toEqual([])
  })

  // The set arrives straight off the wire, where a value could in principle be stale. An unknown slug
  // is simply not one of the fields the page shows, so it cancels nothing.
  it('ignores a slug that is not a competition', () => {
    expect(at(['mixed-doubles']).competitions).toEqual([...COMPETITION_SLUGS])
  })
})

// The one line that survives the removal (ADR-0062 §5), derived from the flag rather than written by
// hand: hand-written copy can be forgotten when the flag is set, and then the site quietly buries a
// field somebody registered for. The reason is always the same — too few entries — so the label of
// the competition is the only variable.
describe('frontDoorLead — the derived FAQ line', () => {
  const noteFor = (cancelled: string[]) =>
    frontDoorLead({ phase: 'tournament', drawn: false, schedulePublished: false, cancelled }).cancellationNote

  it('is absent while nothing is cancelled', () => {
    expect(noteFor([])).toBeNull()
  })

  it('names the cancelled field by its public label and gives the reason', () => {
    expect(noteFor(['womens-social'])).toBe(
      'Damen Doppel findet dieses Jahr nicht statt — dafür gab es zu wenige Anmeldungen. Alle Angemeldeten informiert der Sportwart persönlich.'
    )
  })

  it('lists several cancelled fields in the canonical order, with a plural verb', () => {
    expect(noteFor(['womens-social', 'womens'])).toBe(
      'Damen und Damen Doppel finden dieses Jahr nicht statt — dafür gab es zu wenige Anmeldungen. Alle Angemeldeten informiert der Sportwart persönlich.'
    )
  })

  it('separates three or more by commas and a final „und"', () => {
    expect(noteFor(['mens', 'womens', 'womens-social'])).toContain('Herren, Damen und Damen Doppel finden')
  })

  // Quiet and factual, never a lead: the cancellation is one FAQ answer, not the page's opening
  // statement (ADR-0062 §5, user story 21).
  it('stays a plain statement — no exclamation, no call to action', () => {
    const note = noteFor(['womens'])!
    expect(note).not.toMatch(/[!?]/)
    expect(note).toMatch(/\.$/)
  })

  it('ignores a slug that is not a competition', () => {
    expect(noteFor(['mixed-doubles'])).toBeNull()
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
