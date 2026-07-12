import { CHALLENGER_MIN_LK } from '../shared'
import type { Env } from './app'
import { isTooStrongForChallenger } from './domain/registration'

// Telegram notifications — a transport-edge concern (presentation + I/O), kept out of the
// domain. The domain returns the facts as data; the edge formats and sends them. Shared by
// the registration write path (notifyRegistration) and the still-legacy cancel path
// (notifyCancellation) so the Telegram plumbing lives in one place.

const COMPETITION_LABELS: Record<string, string> = {
  mens: 'Herren',
  'mens-challenger': 'Herren Challenger',
  womens: 'Damen',
  'womens-social': 'Damen Doppel-Mixer'
}

const ADMIN_URL = 'https://meisterschaften.tennisverein-winsen.de/admin'

// Escape HTML, since we send parse_mode=HTML (names/notes may contain & < >).
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Send a Telegram message (free, no DNS change). Errors are only logged. */
const sendTelegram = async (env: Env, text: string): Promise<void> => {
  // No token / chat id configured (e.g. locally) → silently skip.
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return

  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    })
    if (!res.ok) console.error('Telegram notification failed:', res.status, await res.text())
  } catch (err) {
    console.error('Telegram notification failed:', String(err))
  }
}

export interface RegistrationNotice {
  competition: string
  firstName: string
  lastName: string
  club: string
  email: string
  phone?: string | null
  note?: string | null
  /** LK matched from nuLiga (when unique), otherwise null. */
  lk?: string | null
}

// The facts a cancellation notification needs — a structural subset of RegistrationRow,
// so the domain's cancelled rows are passed straight through (camelCase, like the contract).
export interface CancelledNotice {
  firstName: string
  lastName: string
  club: string
  email: string
  competition: string
}

// Message formatting is pure (notice → string), separate from the transport (sendTelegram) so it
// can be tested directly rather than through a vi.mock of the module.

/** The Telegram text for a new registration. */
export const formatRegistrationMessage = (r: RegistrationNotice): string => {
  const competitionLabel = COMPETITION_LABELS[r.competition] ?? r.competition
  return [
    '🎾 <b>Neue Anmeldung</b> — Winsener Meisterschaften 2026',
    '',
    `<b>Name:</b> ${escapeHtml(`${r.firstName} ${r.lastName}`)}`,
    `<b>Konkurrenz:</b> ${escapeHtml(competitionLabel)}`,
    `<b>Verein:</b> ${escapeHtml(r.club)}`,
    `<b>E-Mail:</b> ${escapeHtml(r.email)}`,
    ...(r.phone ? [`<b>Telefon:</b> ${escapeHtml(r.phone)}`] : []),
    ...(r.lk ? [`<b>LK (nuLiga):</b> ${escapeHtml(r.lk)}`] : []),
    ...(isTooStrongForChallenger(r.competition, r.lk ?? null)
      ? ['', `⚠️ <b>LK ${escapeHtml(r.lk!)} &lt; ${CHALLENGER_MIN_LK}</b> — evtl. Hauptfeld statt Challenger.`]
      : []),
    ...(r.note ? ['', `<b>Anmerkung:</b> ${escapeHtml(r.note)}`] : []),
    '',
    `Status: neu — zum Bestätigen: ${ADMIN_URL}`
  ].join('\n')
}

// Precondition: a cancellation always names ≥1 competition; the caller (notifyCancellation) guards
// the empty case, so `first` is never undefined here.
/** The Telegram text for a cancellation (one person can cancel several competitions). */
export const formatCancellationMessage = (rows: CancelledNotice[]): string => {
  const first = rows[0]
  const competitionLabels = rows.map(r => COMPETITION_LABELS[r.competition] ?? r.competition).join(', ')
  return [
    '🚫 <b>Abmeldung</b> — Winsener Meisterschaften 2026',
    '',
    `<b>Name:</b> ${escapeHtml(`${first.firstName} ${first.lastName}`)}`,
    `<b>Konkurrenz${rows.length > 1 ? 'en' : ''}:</b> ${escapeHtml(competitionLabels)}`,
    `<b>Verein:</b> ${escapeHtml(first.club)}`,
    `<b>E-Mail:</b> ${escapeHtml(first.email)}`,
    '',
    `In der Verwaltung: ${ADMIN_URL}`
  ].join('\n')
}

/** Telegram message about a new registration. */
export const notifyRegistration = async (env: Env, r: RegistrationNotice): Promise<void> =>
  sendTelegram(env, formatRegistrationMessage(r))

/** Telegram message about a cancellation (one person can cancel several competitions). */
export const notifyCancellation = async (env: Env, rows: CancelledNotice[]): Promise<void> => {
  if (rows.length === 0) return
  await sendTelegram(env, formatCancellationMessage(rows))
}
