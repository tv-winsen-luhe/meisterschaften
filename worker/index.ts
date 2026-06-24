/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database
  ASSETS: Fetcher
  PUBLIC_LIST_ENABLED: string
  ADMIN_TOKEN: string
  // Telegram-Benachrichtigung bei neuen Anmeldungen. Optional: fehlen Token/Chat
  // (z. B. lokal), wird die Benachrichtigung still übersprungen.
  // TELEGRAM_BOT_TOKEN ist ein Secret, TELEGRAM_CHAT_ID eine Var (siehe wrangler.toml).
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

const COMPETITIONS = ['mens', 'mens-challenger', 'womens'] as const
const COMPETITION_LABELS: Record<string, string> = {
  mens: 'Herren',
  'mens-challenger': 'Herren Challenger',
  womens: 'Damen'
}
const CLUBS = ['TV Winsen', 'TSV Winsen'] as const
const STATUS = ['new', 'confirmed', 'hidden', 'cancelled'] as const
const DEFAULT_LK = '25.0'

// nuLiga LK-Vereinsranglisten (TNB) — eine Seite pro Verein, listet Spieler-ID + LK.
const NULIGA_BASE = 'https://tnb.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa/clubRankinglistLK?federation=TNB&club='
const NULIGA_CLUB_IDS = ['303160', '303251'] // TV Winsen/Luhe, TSV Winsen

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })

const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      if (path === '/api/register' && method === 'POST') return await handleRegister(request, env, ctx)
      if (path === '/api/cancel' && method === 'POST') return await handleCancel(request, env, ctx)
      if (path === '/api/participants' && method === 'GET') return await handleParticipants(env)
      if (path === '/admin' && method === 'GET') return adminPage()
      if (path === '/api/admin/list' && method === 'GET') return await handleAdminList(request, env)
      if (path === '/api/admin/update' && method === 'POST') return await handleAdminUpdate(request, env)
      if (path === '/api/admin/refresh-lk' && method === 'POST') return await handleRefreshLk(request, env)
      if (path === '/export' && method === 'GET') return await handleExport(request, env, url)
    } catch (err) {
      return json({ error: 'Serverfehler. Bitte später erneut versuchen.', detail: String(err) }, 500)
    }

    // Everything else → static Astro site.
    return env.ASSETS.fetch(request)
  },

  // Weekly LK sync (Monday morning, see wrangler.toml [triggers]).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshLk(env))
  }
}

async function handleRegister(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Ungültige Anfrage.' }, 400)
  }

  // Honeypot: bots fill the hidden field → silently "succeed".
  if (str(body.website)) return json({ ok: true })

  const competition = str(body.competition)
  const firstName = str(body.first_name)
  const lastName = str(body.last_name)
  const club = str(body.club)
  const email = str(body.email)
  const phone = str(body.phone)
  const note = str(body.note)
  const consent = str(body.consent)

  if (!COMPETITIONS.includes(competition as (typeof COMPETITIONS)[number]))
    return json({ error: 'Bitte wähle eine gültige Konkurrenz.' }, 400)
  if (!firstName || firstName.length > 60) return json({ error: 'Bitte gib deinen Vornamen an.' }, 400)
  if (!lastName || lastName.length > 60) return json({ error: 'Bitte gib deinen Nachnamen an.' }, 400)
  if (!CLUBS.includes(club as (typeof CLUBS)[number])) return json({ error: 'Bitte wähle deinen Verein.' }, 400)
  if (!email || email.length > 120 || !isEmail(email))
    return json({ error: 'Bitte gib eine gültige E-Mail-Adresse an.' }, 400)
  if (phone.length > 40) return json({ error: 'Handynummer ist zu lang.' }, 400)
  if (note.length > 500) return json({ error: 'Anmerkung ist zu lang (max. 500 Zeichen).' }, 400)
  if (consent !== 'yes') return json({ error: 'Bitte bestätige die Einwilligung.' }, 400)

  const ip = request.headers.get('cf-connecting-ip') ?? ''

  // Soft rate limit: max 3 registrations per IP per hour.
  if (ip) {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString()
    const recent = await env.DB.prepare('SELECT COUNT(*) AS c FROM registrations WHERE ip = ? AND created_at > ?')
      .bind(ip, oneHourAgo)
      .first<{ c: number }>()
    if (recent && recent.c >= 3)
      return json({ error: 'Zu viele Anmeldungen in kurzer Zeit. Bitte versuch es später erneut.' }, 429)
  }

  const now = new Date().toISOString()

  // If this person previously cancelled the same competition, revive that row
  // instead of inserting a second one (keeps their player_id/LK linkage and
  // avoids a confusing duplicate in the admin list).
  const revived = await env.DB.prepare(
    `UPDATE registrations
        SET status = 'new', created_at = ?, first_name = ?, last_name = ?, club = ?,
            phone = ?, note = ?, ip = ?
      WHERE email = ? COLLATE NOCASE AND last_name = ? COLLATE NOCASE
        AND competition = ? AND status = 'cancelled'`
  )
    .bind(now, firstName, lastName, club, phone || null, note || null, ip || null, email, lastName, competition)
    .run()

  if ((revived.meta?.changes ?? 0) === 0) {
    await env.DB.prepare(
      `INSERT INTO registrations (created_at, competition, first_name, last_name, club, email, phone, note, status, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
    )
      .bind(now, competition, firstName, lastName, club, email, phone || null, note || null, ip || null)
      .run()
  }

  // Sportwart benachrichtigen — im Hintergrund, damit ein Mailfehler die Anmeldung nie blockiert.
  ctx.waitUntil(notifyRegistration(env, { competition, firstName, lastName, club, email, phone, note }))

  return json({ ok: true })
}

interface RegistrationNotice {
  competition: string
  firstName: string
  lastName: string
  club: string
  email: string
  phone: string
  note: string
}

interface CancelledRow {
  first_name: string
  last_name: string
  club: string
  email: string
  competition: string
}

const ADMIN_URL = 'https://meisterschaften.tennisverein-winsen.de/admin'

// HTML-escapen, da wir parse_mode=HTML nutzen (Namen/Anmerkung können & < > enthalten).
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Schickt eine Telegram-Nachricht (kostenlos, keine DNS-Änderung). Fehler werden nur geloggt. */
async function sendTelegram(env: Env, text: string): Promise<void> {
  // Kein Token / keine Chat-ID konfiguriert (z. B. lokal) → still überspringen.
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
    if (!res.ok) console.error('Telegram-Benachrichtigung fehlgeschlagen:', res.status, await res.text())
  } catch (err) {
    console.error('Telegram-Benachrichtigung fehlgeschlagen:', String(err))
  }
}

/** Telegram-Nachricht über eine neue Anmeldung. */
async function notifyRegistration(env: Env, r: RegistrationNotice): Promise<void> {
  const konk = COMPETITION_LABELS[r.competition] ?? r.competition
  const text = [
    '🎾 <b>Neue Anmeldung</b> — Winsener Meisterschaften 2026',
    '',
    `<b>Name:</b> ${escapeHtml(`${r.firstName} ${r.lastName}`)}`,
    `<b>Konkurrenz:</b> ${escapeHtml(konk)}`,
    `<b>Verein:</b> ${escapeHtml(r.club)}`,
    `<b>E-Mail:</b> ${escapeHtml(r.email)}`,
    ...(r.phone ? [`<b>Telefon:</b> ${escapeHtml(r.phone)}`] : []),
    ...(r.note ? ['', `<b>Anmerkung:</b> ${escapeHtml(r.note)}`] : []),
    '',
    `Status: neu — zum Bestätigen: ${ADMIN_URL}`
  ].join('\n')
  await sendTelegram(env, text)
}

/** Telegram-Nachricht über eine Abmeldung (eine Person kann mehrere Konkurrenzen abmelden). */
async function notifyCancellation(env: Env, rows: CancelledRow[]): Promise<void> {
  if (rows.length === 0) return

  const first = rows[0]
  const konks = rows.map(r => COMPETITION_LABELS[r.competition] ?? r.competition).join(', ')
  const text = [
    '🚫 <b>Abmeldung</b> — Winsener Meisterschaften 2026',
    '',
    `<b>Name:</b> ${escapeHtml(`${first.first_name} ${first.last_name}`)}`,
    `<b>Konkurrenz${rows.length > 1 ? 'en' : ''}:</b> ${escapeHtml(konks)}`,
    `<b>Verein:</b> ${escapeHtml(first.club)}`,
    `<b>E-Mail:</b> ${escapeHtml(first.email)}`,
    '',
    `In der Verwaltung: ${ADMIN_URL}`
  ].join('\n')
  await sendTelegram(env, text)
}

async function handleCancel(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Ungültige Anfrage.' }, 400)
  }

  // Honeypot: bots fill the hidden field → silently "succeed".
  if (str(body.website)) return json({ ok: true, cancelled: 0 })

  const email = str(body.email)
  const lastName = str(body.last_name)

  if (!email || !isEmail(email)) return json({ error: 'Bitte gib die E-Mail-Adresse deiner Anmeldung an.' }, 400)
  if (!lastName) return json({ error: 'Bitte gib deinen Nachnamen an.' }, 400)

  // Welche aktiven Einträge werden gleich abgemeldet? (Vorher lesen, um den
  // Sportwart mit Details benachrichtigen zu können.)
  const { results: toCancel } = await env.DB.prepare(
    `SELECT first_name, last_name, club, email, competition FROM registrations
      WHERE email = ? COLLATE NOCASE AND last_name = ? COLLATE NOCASE AND status IN ('new', 'confirmed')`
  )
    .bind(email, lastName)
    .all<CancelledRow>()

  // Cancel every still-active entry that matches email + last name (case-insensitive).
  const result = await env.DB.prepare(
    `UPDATE registrations SET status = 'cancelled'
      WHERE email = ? COLLATE NOCASE AND last_name = ? COLLATE NOCASE AND status IN ('new', 'confirmed')`
  )
    .bind(email, lastName)
    .run()

  const cancelled = result.meta?.changes ?? 0
  if (cancelled > 0) ctx.waitUntil(notifyCancellation(env, toCancel ?? []))

  return json({ ok: true, cancelled })
}

async function handleParticipants(env: Env): Promise<Response> {
  if (env.PUBLIC_LIST_ENABLED !== 'true') return json({ enabled: false, participants: [] })

  const { results } = await env.DB.prepare(
    `SELECT first_name, last_name, club, competition, lk
       FROM registrations
      WHERE status = 'confirmed'
      ORDER BY competition ASC, CAST(COALESCE(lk, ?) AS REAL) ASC, created_at ASC`
  )
    .bind(DEFAULT_LK)
    .all()

  return json({ enabled: true, participants: results ?? [] })
}

function checkToken(request: Request, env: Env): boolean {
  const token = request.headers.get('x-admin-token') ?? ''
  return Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN
}

async function handleAdminList(request: Request, env: Env): Promise<Response> {
  if (!checkToken(request, env)) return json({ error: 'Nicht autorisiert.' }, 401)
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, competition, first_name, last_name, club, email, phone, note, player_id, lk, status
       FROM registrations
      ORDER BY status ASC, competition ASC, created_at ASC`
  ).all()
  return json({ registrations: results ?? [] })
}

async function handleAdminUpdate(request: Request, env: Env): Promise<Response> {
  if (!checkToken(request, env)) return json({ error: 'Nicht autorisiert.' }, 401)

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Ungültige Anfrage.' }, 400)
  }

  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Ungültige ID.' }, 400)

  const sets: string[] = []
  const binds: unknown[] = []
  let playerIdSet = ''

  if (body.player_id !== undefined) {
    const pid = str(body.player_id)
    if (pid && !/^\d{8}$/.test(pid)) return json({ error: 'Spieler-ID muss 8-stellig sein.' }, 400)
    sets.push('player_id = ?')
    binds.push(pid || null)
    playerIdSet = pid
  }
  if (body.lk !== undefined) {
    const lk = str(body.lk)
    if (lk && !/^\d{1,2}([.,]\d)?$/.test(lk)) return json({ error: 'LK-Format ungültig (z. B. 20.3).' }, 400)
    sets.push('lk = ?')
    binds.push(lk ? lk.replace(',', '.') : null)
  }
  if (body.competition !== undefined) {
    const c = str(body.competition)
    if (!COMPETITIONS.includes(c as (typeof COMPETITIONS)[number])) return json({ error: 'Ungültige Konkurrenz.' }, 400)
    sets.push('competition = ?')
    binds.push(c)
  }
  if (body.status !== undefined) {
    const s = str(body.status)
    if (!STATUS.includes(s as (typeof STATUS)[number])) return json({ error: 'Ungültiger Status.' }, 400)
    // Confirm rule: a confirmed entry needs a player_id OR an explicit LK (e.g. 25.0 for "no ID").
    if (s === 'confirmed') {
      const row = await env.DB.prepare('SELECT player_id, lk FROM registrations WHERE id = ?')
        .bind(id)
        .first<{ player_id: string | null; lk: string | null }>()
      const willHavePlayerId = body.player_id !== undefined ? Boolean(str(body.player_id)) : Boolean(row?.player_id)
      const willHaveLk = body.lk !== undefined ? Boolean(str(body.lk)) : Boolean(row?.lk)
      if (!willHavePlayerId && !willHaveLk)
        return json({ error: 'Zum Bestätigen bitte Spieler-ID eintragen oder „keine ID" (LK 25.0) setzen.' }, 400)
    }
    sets.push('status = ?')
    binds.push(s)
  }

  if (sets.length === 0) return json({ error: 'Keine Änderung übergeben.' }, 400)

  binds.push(id)
  await env.DB.prepare(`UPDATE registrations SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run()

  // Auto-fetch LK from nuLiga when a player_id was just linked.
  let lkFetched: string | null = null
  if (playerIdSet) {
    const map = await fetchNuligaMap()
    if (map[playerIdSet]) {
      lkFetched = map[playerIdSet]
      await env.DB.prepare('UPDATE registrations SET lk = ? WHERE id = ?').bind(lkFetched, id).run()
    }
  }

  return json({ ok: true, lkFetched })
}

async function handleRefreshLk(request: Request, env: Env): Promise<Response> {
  if (!checkToken(request, env)) return json({ error: 'Nicht autorisiert.' }, 401)
  const updated = await refreshLk(env)
  return json({ ok: true, updated })
}

/** Fetch both club LK pages, return a player_id → LK map (e.g. "18254646" → "14.7"). */
async function fetchNuligaMap(): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  for (const clubId of NULIGA_CLUB_IDS) {
    try {
      const res = await fetch(NULIGA_BASE + clubId, {
        headers: { 'user-agent': 'winsener-meisterschaften/1.0 (+vereins-tool)' }
      })
      if (!res.ok) continue
      const html = await res.text()
      Object.assign(map, parseClubLk(html))
    } catch {
      // ignore a failing club page; the other still contributes
    }
  }
  return map
}

/** Parse a nuLiga clubRankinglistLK HTML page into player_id → LK (current dated value). */
export function parseClubLk(html: string): Record<string, string> {
  const map: Record<string, string> = {}
  // Split into table rows; each row holds one player (8-digit id + one or more "LKx,y").
  const rows = html.split(/<tr[\s>]/i)
  for (const row of rows) {
    const idMatch = row.match(/\b(\d{8})\b/)
    if (!idMatch) continue
    const lkMatches = [...row.matchAll(/LK\s*(\d{1,2}[.,]\d)/gi)]
    if (lkMatches.length === 0) continue
    // The dated "Stichtags-LK" is the last LK in the row → the current value.
    const lk = lkMatches[lkMatches.length - 1][1].replace(',', '.')
    map[idMatch[1]] = lk
  }
  return map
}

/** Refresh LK for all rows that have a player_id. Returns the number of updated rows. */
async function refreshLk(env: Env): Promise<number> {
  const map = await fetchNuligaMap()
  if (Object.keys(map).length === 0) return 0

  const { results } = await env.DB.prepare(
    "SELECT id, player_id FROM registrations WHERE player_id IS NOT NULL AND player_id != ''"
  ).all<{ id: number; player_id: string }>()

  let updated = 0
  for (const row of results ?? []) {
    const lk = map[row.player_id]
    if (lk) {
      await env.DB.prepare('UPDATE registrations SET lk = ? WHERE id = ?').bind(lk, row.id).run()
      updated++
    }
  }
  return updated
}

async function handleExport(request: Request, env: Env, url: URL): Promise<Response> {
  const token = url.searchParams.get('token') ?? ''
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return new Response('Nicht autorisiert.', { status: 401 })

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, competition, first_name, last_name, club, email, phone, note, player_id, lk, status
       FROM registrations ORDER BY created_at ASC`
  ).all<Record<string, unknown>>()

  const cols = [
    'id',
    'created_at',
    'competition',
    'first_name',
    'last_name',
    'club',
    'email',
    'phone',
    'note',
    'player_id',
    'lk',
    'status'
  ]
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const rows = (results ?? []).map(r => cols.map(c => esc(r[c])).join(','))
  const csv = '﻿' + [cols.join(','), ...rows].join('\n')

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="anmeldungen-winsener-meisterschaften.csv"',
      'cache-control': 'no-store'
    }
  })
}

function adminPage(): Response {
  return new Response(ADMIN_HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  })
}

const ADMIN_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Anmeldungen — Winsener Meisterschaften 2026</title>
<style>
  :root {
    --navy:#0c1e3a; --navy-deep:#060d18; --neon:#ceff00; --blue:#199cf9; --clay:#c2673b;
    --paper:#f1f1ee; --card:#ffffff; --line:#e5e5e5; --line-2:#d4d4d4; --ink:#0c1e3a; --muted:#6b7280;
    --ui: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin:0; font-family:var(--ui); background:var(--paper); color:var(--ink); line-height:1.45;
    background-image: linear-gradient(var(--line) 1px, transparent 1px); background-size:100% 44px;
    background-attachment:fixed; }

  /* ── Header: navy chrome with a single neon baseline (court line) ───────── */
  header { background:linear-gradient(180deg,var(--navy),var(--navy-deep)); color:#fff;
    position:sticky; top:0; z-index:20; border-bottom:3px solid var(--neon); }
  .head-bar { max-width:1120px; margin:0 auto; padding:14px 20px;
    display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
  .brand { display:flex; flex-direction:column; gap:2px; min-width:0; }
  .brand__tag { font-family:var(--mono); font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--neon); }
  .brand h1 { margin:0; font-size:clamp(20px,3.4vw,28px); font-weight:800; letter-spacing:-.02em; line-height:1; }
  [hidden] { display:none !important; }
  .tools { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }

  /* ── Stat tiles: mono scoreboard cells ──────────────────────────────────── */
  .stats { max-width:1120px; margin:0 auto; padding:0 20px 16px;
    display:grid; grid-template-columns:repeat(6,1fr); gap:8px; }
  .tile { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.14); padding:9px 11px;
    display:flex; flex-direction:column; gap:2px; }
  .tile__n { font-family:var(--mono); font-size:24px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; }
  .tile__l { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:rgba(255,255,255,.62); font-weight:700; }
  .tile.is-new .tile__n { color:var(--blue); }
  .tile.is-conf { border-color:var(--neon); background:rgba(206,255,0,.1); }
  .tile.is-conf .tile__n { color:var(--neon); }
  .tile.sub { background:transparent; }
  .tile.sub .tile__n { font-size:19px; color:rgba(255,255,255,.9); }
  @media (max-width:720px){ .stats { grid-template-columns:repeat(3,1fr); } }

  /* ── Filter bar ──────────────────────────────────────────────────────────── */
  .filterbar { position:sticky; top:0; z-index:10; background:var(--card); border-bottom:1px solid var(--line-2);
    box-shadow:0 1px 0 rgba(12,30,58,.04); }
  .filterbar-inner { max-width:1120px; margin:0 auto; padding:9px 20px;
    display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .tabs { display:flex; gap:2px; flex-wrap:wrap; }
  .tab { background:transparent; border:none; cursor:pointer; font:inherit; color:var(--muted);
    font-size:13px; font-weight:700; padding:7px 11px; border-bottom:3px solid transparent; }
  .tab:hover { color:var(--ink); }
  .tab.is-active { color:var(--ink); border-bottom-color:var(--neon); }
  .tab__c { font-family:var(--mono); font-size:11px; font-weight:700; opacity:.7; margin-left:3px; }
  .search { margin-left:auto; flex:1; min-width:160px; max-width:320px; padding:8px 11px; font:inherit; font-size:13px;
    border:1.5px solid var(--line-2); background:var(--paper); color:var(--ink); }
  .search::placeholder { color:var(--muted); }

  /* ── Buttons ─────────────────────────────────────────────────────────────── */
  button, .btn { font:inherit; font-weight:700; cursor:pointer; border:none; transition:transform .08s ease, filter .12s ease; }
  button:active { transform:translateY(1px); }
  .btn-primary { background:var(--neon); color:var(--navy); padding:8px 14px; letter-spacing:.01em; }
  .btn-primary:hover { filter:brightness(1.05); }
  .btn-hide { background:var(--paper); color:var(--ink); border:1.5px solid var(--line-2); padding:8px 12px; }
  .btn-hide:hover { background:#e9e9e6; }
  .btn-ghost { background:transparent; color:#fff; border:1.5px solid rgba(255,255,255,.35); padding:7px 12px;
    font-size:13px; text-decoration:none; display:inline-flex; align-items:center; gap:5px; }
  .btn-ghost:hover { border-color:var(--neon); color:var(--neon); }

  /* ── Layout ──────────────────────────────────────────────────────────────── */
  main { padding:20px; max-width:1120px; margin:0 auto; }

  .gate { max-width:420px; margin:8vh auto 0; background:var(--card); border:1px solid var(--line-2);
    border-top:4px solid var(--neon); padding:26px 24px; }
  .gate__tag { font-family:var(--mono); font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--clay); }
  .gate h2 { margin:6px 0 18px; font-size:21px; font-weight:800; letter-spacing:-.02em; }
  .gate__field { display:flex; gap:8px; }
  .gate input { flex:1; min-width:0; padding:11px; font:inherit; border:1.5px solid var(--line-2); background:var(--paper); }
  .gatemsg { margin-top:12px; font-size:13px; font-weight:700; color:var(--clay); min-height:18px; }

  .group { margin:26px 0 10px; font-family:var(--mono); font-size:12px; font-weight:700; letter-spacing:.12em;
    text-transform:uppercase; color:var(--muted); display:flex; align-items:center; gap:10px; }
  .group::after { content:''; flex:1; height:1px; background:var(--line-2); }

  /* ── Card: registration as a draw-sheet entry, status = court sideline ───── */
  .card { position:relative; background:var(--card); border:1px solid var(--line); border-left:5px solid var(--line-2);
    padding:13px 16px 14px; margin-bottom:8px; }
  .card.s-new { border-left-color:var(--blue); }
  .card.s-confirmed { border-left-color:var(--neon); }
  .card.s-hidden { border-left-color:var(--line-2); opacity:.6; }
  .card.s-cancelled { border-left-color:var(--clay); opacity:.62; }
  .row1 { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; }
  .name { font-size:17px; font-weight:800; letter-spacing:-.01em; }
  .badge { font-size:10px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; padding:3px 8px;
    border:1.5px solid var(--ink); }
  .seed { font-family:var(--mono); font-size:13px; font-weight:700; padding:2px 9px; border:1.5px solid var(--ink);
    font-variant-numeric:tabular-nums; white-space:nowrap; }
  .seed b { font-size:9px; letter-spacing:.1em; margin-right:5px; opacity:.6; vertical-align:1px; }
  .seed.is-none { color:var(--muted); border-color:var(--line-2); }
  .meta { font-size:13px; color:var(--muted); margin-left:auto; text-align:right; }
  .warn { color:var(--clay); font-weight:800; font-size:12px; }
  .contact { font-family:var(--mono); font-size:12px; color:var(--muted); margin-top:6px; word-break:break-word; }
  .note { margin-top:6px; font-size:13px; border-left:2px solid var(--line-2); padding-left:9px; color:#444; }

  .row2 { display:flex; flex-wrap:wrap; gap:8px 10px; align-items:center; margin-top:12px;
    padding-top:12px; border-top:1px dashed var(--line-2); }
  .row2 label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); }
  .row2 input, .row2 select { padding:7px 9px; font:inherit; font-size:14px; border:1.5px solid var(--line-2); background:#fff; }
  .row2 input { font-family:var(--mono); }
  .row2 input.pid { width:118px; }
  .row2 input.lk { width:72px; text-align:center; }
  .noid { display:inline-flex; gap:5px; align-items:center; color:var(--muted); font-weight:700; cursor:pointer; }
  .noid input { accent-color:var(--clay); }
  .spacer { flex:1; min-width:0; }

  .empty { text-align:center; color:var(--muted); padding:48px 16px; font-size:15px; }

  :focus-visible { outline:2.5px solid var(--blue); outline-offset:1px; }

  /* ── Toast ───────────────────────────────────────────────────────────────── */
  .toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%) translateY(8px);
    background:var(--navy); color:#fff; padding:11px 18px; font-size:14px; font-weight:700;
    border-left:4px solid var(--neon); box-shadow:0 8px 24px rgba(12,30,58,.28); z-index:50;
    opacity:0; pointer-events:none; transition:opacity .18s ease, transform .18s ease; }
  .toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
  .toast.err { border-left-color:var(--clay); }

  @keyframes rise { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  .card, .group { animation:rise .22s ease both; }

  @media (max-width:560px){
    .row2 .spacer { display:none; }
    .row2 .act-confirm, .row2 .act-hide { flex:1; }
    .meta { margin-left:0; text-align:left; flex-basis:100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, .card, .group, .toast { animation:none !important; transition:none !important; }
  }
</style>
</head>
<body>
<header>
  <div class="head-bar">
    <div class="brand">
      <span class="brand__tag">Winsener Meisterschaften 2026</span>
      <h1>Anmeldungen</h1>
    </div>
    <div class="tools" id="tools" hidden>
      <button class="btn-ghost" id="refresh">↻ LK aus nuLiga</button>
      <a class="btn-ghost" id="exportlink" href="#" target="_blank" rel="noopener">CSV-Export ↧</a>
      <button class="btn-ghost" id="logout">Abmelden</button>
    </div>
  </div>
  <div class="stats" id="stats" hidden></div>
</header>
<div class="filterbar" id="filterbar" hidden>
  <div class="filterbar-inner">
    <div class="tabs" id="tabs"></div>
    <input class="search" id="search" type="search" placeholder="Name, E-Mail, Verein, ID …" autocomplete="off" />
  </div>
</div>
<main>
  <div class="gate" id="gate">
    <span class="gate__tag">Vereinsintern</span>
    <h2>Admin-Anmeldung</h2>
    <div class="gate__field">
      <input id="token" type="password" placeholder="Admin-Token" autocomplete="off" />
      <button class="btn-primary" id="login">Anmelden</button>
    </div>
    <div class="gatemsg" id="gatemsg"></div>
  </div>
  <div id="list"></div>
</main>
<div class="toast" id="msg" role="status" aria-live="polite"></div>
<script>
  const KONK = { 'mens':'Herren', 'mens-challenger':'Herren Challenger', 'womens':'Damen' }
  const STATUS_LABELS = { 'all':'Alle', 'new':'Neu', 'confirmed':'Bestätigt', 'hidden':'Versteckt', 'cancelled':'Abgemeldet' }
  const GROUP_LABELS = { 'new':'Neu — zu bestätigen', 'confirmed':'Bestätigt — öffentlich', 'hidden':'Versteckt', 'cancelled':'Abgemeldet' }
  const ORDER = { 'new':0, 'confirmed':1, 'hidden':2, 'cancelled':3 }

  let TOKEN = sessionStorage.getItem('admin_token') || new URLSearchParams(location.search).get('token') || ''
  let ALL = []
  let FILTER = 'all'
  let QUERY = ''

  const el = id => document.getElementById(id)
  let toastT
  function toast(t, isErr){
    const m = el('msg'); m.textContent = t; m.className = 'toast show' + (isErr ? ' err' : '')
    clearTimeout(toastT); toastT = setTimeout(()=>{ m.className = 'toast' + (isErr ? ' err' : '') }, 3200)
  }

  async function api(path, opts){
    opts = opts || {}
    const res = await fetch(path, { ...opts, headers: { 'content-type':'application/json', 'x-admin-token':TOKEN, ...(opts.headers||{}) } })
    if(res.status === 401) throw new Error('unauthorized')
    if(!res.ok) throw new Error('Fehler ' + res.status)
    return res.json()
  }

  async function load(){
    let data
    try { data = await api('/api/admin/list') }
    catch(e){
      if(String(e.message)==='unauthorized'){ showGate('Token ungültig.'); return }
      toast('Konnte nicht laden.', true); return
    }
    el('gate').style.display='none'
    el('tools').hidden = false
    el('stats').hidden = false
    el('filterbar').hidden = false
    sessionStorage.setItem('admin_token', TOKEN)
    el('exportlink').href = '/export?token=' + encodeURIComponent(TOKEN)
    ALL = data.registrations || []
    render()
  }

  function showGate(msg){
    el('gate').style.display='block'
    el('tools').hidden = true; el('stats').hidden = true; el('filterbar').hidden = true
    el('list').innerHTML = ''
    el('gatemsg').textContent = msg || ''
  }

  function tile(label, val, cls){
    return '<div class="tile ' + (cls||'') + '"><span class="tile__n">' + val + '</span><span class="tile__l">' + label + '</span></div>'
  }
  function renderStats(){
    const conf = ALL.filter(r=>r.status==='confirmed')
    const neu = ALL.filter(r=>r.status==='new').length
    const by = k => conf.filter(r=>r.competition===k).length
    el('stats').innerHTML =
      tile('Gesamt', ALL.length) +
      tile('Neu', neu, 'is-new') +
      tile('Bestätigt', conf.length, 'is-conf') +
      tile('Herren', by('mens'), 'sub') +
      tile('Challenger', by('mens-challenger'), 'sub') +
      tile('Damen', by('womens'), 'sub')
  }
  function renderTabs(){
    const cnt = s => s==='all' ? ALL.length : ALL.filter(r=>r.status===s).length
    el('tabs').innerHTML = ['all','new','confirmed','hidden','cancelled'].map(s=>
      '<button class="tab' + (FILTER===s ? ' is-active' : '') + '" data-f="' + s + '">' +
        STATUS_LABELS[s] + '<span class="tab__c">' + cnt(s) + '</span></button>'
    ).join('')
    el('tabs').querySelectorAll('.tab').forEach(b=> b.addEventListener('click', ()=>{ FILTER=b.dataset.f; render() }))
  }

  function render(){
    renderStats(); renderTabs()
    const q = QUERY.trim().toLowerCase()
    let rows = ALL.slice()
    if(FILTER !== 'all') rows = rows.filter(r=> r.status===FILTER)
    if(q) rows = rows.filter(r=> (r.first_name + ' ' + r.last_name + ' ' + r.email + ' ' + r.club + ' ' + (r.player_id||'')).toLowerCase().includes(q))
    rows.sort((a,b)=> (ORDER[a.status]-ORDER[b.status]) || a.created_at.localeCompare(b.created_at))

    const list = el('list'); list.innerHTML = ''
    if(!ALL.length){ list.innerHTML = '<p class="empty">Noch keine Anmeldungen. Die Liste füllt sich, sobald jemand das Formular abschickt.</p>'; return }
    if(!rows.length){ list.innerHTML = '<p class="empty">Keine Treffer für diesen Filter.</p>'; return }

    let lastStatus = null
    const grouped = (FILTER === 'all')
    for(const r of rows){
      if(grouped && r.status !== lastStatus){
        const h = document.createElement('div'); h.className='group'; h.textContent = GROUP_LABELS[r.status] || r.status
        list.appendChild(h); lastStatus = r.status
      }
      list.appendChild(cardFor(r))
    }
  }

  function cardFor(r){
    const card = document.createElement('div')
    card.className = 'card s-' + r.status
    const challWarn = (r.competition==='mens-challenger' && r.lk && parseFloat(r.lk) < 20)
      ? '<span class="warn">⚠ LK &lt; 20 — Hauptfeld?</span>' : ''
    const seed = r.lk
      ? '<span class="seed"><b>LK</b>' + r.lk + '</span>'
      : '<span class="seed is-none"><b>LK</b>—</span>'
    card.innerHTML =
      '<div class="row1">'
      + '<span class="name"></span>'
      + '<span class="badge"></span>'
      + seed + challWarn
      + '<span class="meta"></span>'
      + '</div>'
      + '<div class="contact"></div>'
      + (r.note ? '<div class="note"></div>' : '')
      + '<div class="row2">'
      + '<label>Spieler-ID</label><input class="pid" type="text" inputmode="numeric" maxlength="8" placeholder="8-stellig" />'
      + '<label class="noid"><input type="checkbox" class="cb-noid" /> keine ID</label>'
      + '<label>LK</label><input class="lk" type="text" inputmode="decimal" placeholder="—" />'
      + '<label>Feld</label><select class="konk"><option value="mens">Herren</option><option value="mens-challenger">Herren Challenger</option><option value="womens">Damen</option></select>'
      + '<span class="spacer"></span>'
      + '<button class="btn-primary act-confirm">Bestätigen</button>'
      + '<button class="btn-hide act-hide">Verstecken</button>'
      + '</div>'
    card.querySelector('.name').textContent = r.first_name + ' ' + r.last_name
    card.querySelector('.badge').textContent = KONK[r.competition] || r.competition
    card.querySelector('.meta').textContent = r.club
    card.querySelector('.contact').textContent = r.email + (r.phone ? '  ·  ' + r.phone : '')
    if(r.note) card.querySelector('.note').textContent = '„' + r.note + '"'

    const pid = card.querySelector('.pid'); pid.value = r.player_id || ''
    const noid = card.querySelector('.cb-noid')
    const lk = card.querySelector('.lk'); lk.value = r.lk || ''
    const konk = card.querySelector('.konk'); konk.value = r.competition

    noid.addEventListener('change', ()=>{
      if(noid.checked){ pid.value=''; pid.disabled=true; if(!lk.value.trim()) lk.value='25.0' }
      else { pid.disabled=false }
    })

    const confirm = ()=>{
      const pidVal = pid.value.trim()
      if(!pidVal && !noid.checked){ toast('Bitte Spieler-ID eintragen oder „keine ID" ankreuzen.', true); return }
      const payload = { id:r.id, competition:konk.value, status:'confirmed' }
      if(pidVal){ payload.player_id = pidVal; if(lk.value.trim()) payload.lk = lk.value.trim() }
      else { payload.player_id = ''; payload.lk = lk.value.trim() || '25.0' }
      update(payload)
    }
    card.querySelector('.act-confirm').addEventListener('click', confirm)
    ;[pid, lk].forEach(inp=> inp.addEventListener('keydown', e=>{ if(e.key==='Enter') confirm() }))
    card.querySelector('.act-hide').addEventListener('click', ()=> update({ id:r.id, status:'hidden' }))
    return card
  }

  async function update(payload){
    try {
      const r = await api('/api/admin/update', { method:'POST', body: JSON.stringify(payload) })
      toast(r && r.lkFetched ? 'Gespeichert · LK ' + r.lkFetched + ' geholt.' : 'Gespeichert.')
      load()
    } catch(e){ toast('Fehler beim Speichern.', true) }
  }

  el('refresh').addEventListener('click', async ()=>{
    toast('Aktualisiere LK aus nuLiga …')
    try { const r = await api('/api/admin/refresh-lk', { method:'POST' }); toast(r.updated + ' LK aktualisiert.'); load() }
    catch(e){ toast('LK-Update fehlgeschlagen.', true) }
  })
  el('logout').addEventListener('click', ()=>{ sessionStorage.removeItem('admin_token'); TOKEN=''; showGate('') })

  el('search').addEventListener('input', e=>{ QUERY = e.target.value; render() })
  el('login').addEventListener('click', ()=>{ TOKEN = el('token').value.trim(); if(TOKEN) load() })
  el('token').addEventListener('keydown', e=>{ if(e.key==='Enter'){ TOKEN = el('token').value.trim(); if(TOKEN) load() } })

  if(TOKEN) load(); else showGate('')
</script>
</body>
</html>`
