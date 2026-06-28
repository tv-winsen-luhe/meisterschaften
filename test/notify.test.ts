import { describe, expect, it } from 'vitest'
import {
  formatCancellationMessage,
  formatRegistrationMessage,
  type CancelledNotice,
  type RegistrationNotice
} from '../worker/notify'

// The Telegram message formatting is pure (notice → string), split out from the transport
// (sendTelegram) so it is tested directly rather than through a vi.mock of the module. Covers the
// conditional lines (phone / LK / Challenger warning / note), HTML escaping, and the
// singular/plural of the cancellation's competition label.

const ADMIN_URL = 'https://meisterschaften.tennisverein-winsen.de/admin'

const notice = (overrides: Partial<RegistrationNotice> = {}): RegistrationNotice => ({
  competition: 'mens',
  firstName: 'Anna',
  lastName: 'Beck',
  club: 'TSV Winsen',
  email: 'anna@example.com',
  ...overrides
})

describe('formatRegistrationMessage', () => {
  it('formats a minimal registration (no phone, LK, note, or warning)', () => {
    expect(formatRegistrationMessage(notice())).toBe(
      [
        '🎾 <b>Neue Anmeldung</b> — Winsener Meisterschaften 2026',
        '',
        '<b>Name:</b> Anna Beck',
        '<b>Konkurrenz:</b> Herren',
        '<b>Verein:</b> TSV Winsen',
        '<b>E-Mail:</b> anna@example.com',
        '',
        `Status: neu — zum Bestätigen: ${ADMIN_URL}`
      ].join('\n')
    )
  })

  it('includes phone, LK, and note lines when present', () => {
    const text = formatRegistrationMessage(notice({ phone: '0123', lk: '15.0', note: 'Hallo' }))
    expect(text).toContain('<b>Telefon:</b> 0123')
    expect(text).toContain('<b>LK (nuLiga):</b> 15.0')
    expect(text).toContain('<b>Anmerkung:</b> Hallo')
  })

  it('adds the Challenger warning when a Challenger entry is too strong', () => {
    const text = formatRegistrationMessage(notice({ competition: 'mens-challenger', lk: '12.0' }))
    expect(text).toContain('⚠️ <b>LK 12.0 &lt; 20</b> — evtl. Hauptfeld statt Challenger.')
  })

  it('omits the Challenger warning for a championship field even with a strong LK', () => {
    const text = formatRegistrationMessage(notice({ competition: 'mens', lk: '12.0' }))
    expect(text).not.toContain('evtl. Hauptfeld statt Challenger')
  })

  it('HTML-escapes names, club, and note', () => {
    const text = formatRegistrationMessage(
      notice({ firstName: 'A&B', lastName: '<X>', club: 'TV & Co', note: '1 < 2' })
    )
    expect(text).toContain('<b>Name:</b> A&amp;B &lt;X&gt;')
    expect(text).toContain('<b>Verein:</b> TV &amp; Co')
    expect(text).toContain('<b>Anmerkung:</b> 1 &lt; 2')
  })
})

const cancelled = (overrides: Partial<CancelledNotice> = {}): CancelledNotice => ({
  firstName: 'Max',
  lastName: 'Muster',
  club: 'TV Winsen',
  email: 'max@example.com',
  competition: 'mens',
  ...overrides
})

describe('formatCancellationMessage', () => {
  it('uses the singular "Konkurrenz" label for one competition', () => {
    const text = formatCancellationMessage([cancelled()])
    expect(text).toContain('<b>Konkurrenz:</b> Herren')
    expect(text).toContain('<b>Name:</b> Max Muster')
    expect(text).toContain(`In der Verwaltung: ${ADMIN_URL}`)
  })

  it('uses the plural "Konkurrenzen" label and joins the labels for several competitions', () => {
    const text = formatCancellationMessage([cancelled(), cancelled({ competition: 'womens' })])
    expect(text).toContain('<b>Konkurrenzen:</b> Herren, Damen')
  })
})
