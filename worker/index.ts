/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database
  ASSETS: Fetcher
  PUBLIC_LIST_ENABLED: string
  ADMIN_TOKEN: string
}

const COMPETITIONS = ['mens', 'mens-challenger', 'womens'] as const
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      if (path === '/api/register' && method === 'POST') return await handleRegister(request, env)
      if (path === '/api/cancel' && method === 'POST') return await handleCancel(request, env)
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

async function handleRegister(request: Request, env: Env): Promise<Response> {
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

  return json({ ok: true })
}

async function handleCancel(request: Request, env: Env): Promise<Response> {
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

  // Cancel every still-active entry that matches email + last name (case-insensitive).
  const result = await env.DB.prepare(
    `UPDATE registrations SET status = 'cancelled'
      WHERE email = ? COLLATE NOCASE AND last_name = ? COLLATE NOCASE AND status IN ('new', 'confirmed')`
  )
    .bind(email, lastName)
    .run()

  return json({ ok: true, cancelled: result.meta?.changes ?? 0 })
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
<title>Admin — Winsener Meisterschaften</title>
<style>
  :root { --navy:#0c1e3a; --neon:#ceff00; --blue:#199cf9; --warn:#c2673b; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:#f5f5f5; color:var(--navy); }
  header { background:var(--navy); color:#fff; padding:16px 20px; position:sticky; top:0; z-index:5; }
  header h1 { margin:0; font-size:16px; letter-spacing:0.04em; text-transform:uppercase; }
  header .counts { margin-top:6px; font-size:13px; opacity:.85; }
  header .tools { margin-top:10px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  main { padding:16px; max-width:1100px; margin:0 auto; }
  .gate { display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:16px; background:#fff; border:1px solid #ddd; }
  .gate input { flex:1; min-width:200px; padding:10px; font:inherit; border:1.5px solid #ccc; }
  button { font:inherit; font-weight:700; cursor:pointer; border:none; padding:8px 12px; }
  .btn-primary { background:var(--neon); color:var(--navy); }
  .btn-hide { background:#e5e5e5; color:var(--navy); }
  .btn-ghost { background:transparent; color:#fff; border:1.5px solid rgba(255,255,255,.4); }
  .msg { padding:10px 0; font-size:13px; font-weight:600; min-height:20px; }
  .group { margin:22px 0 8px; font-size:13px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; opacity:.6; }
  .card { background:#fff; border:1px solid #ddd; padding:12px; margin-bottom:8px; }
  .card.s-confirmed { border-left:4px solid var(--neon); }
  .card.s-hidden { opacity:.5; }
  .card.s-cancelled { opacity:.45; border-left:4px solid var(--warn); }
  .card.s-new { border-left:4px solid var(--blue); }
  .row1 { display:flex; flex-wrap:wrap; gap:8px 14px; align-items:baseline; }
  .name { font-size:17px; font-weight:800; }
  .meta { font-size:12px; opacity:.6; }
  .badge { font-size:10px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; padding:2px 7px; border:1.5px solid currentColor; }
  .warn { color:var(--warn); font-weight:800; font-size:12px; }
  .row2 { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; }
  .row2 label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; opacity:.6; }
  .row2 input, .row2 select { padding:7px 9px; font:inherit; border:1.5px solid #ccc; }
  .row2 input.pid { width:110px; }
  .row2 input.lk { width:70px; }
  .noid { display:inline-flex; gap:5px; align-items:center; opacity:.8; }
  .contact { font-size:12px; opacity:.7; margin-top:6px; }
  a.export { color:var(--blue); font-size:13px; }
</style>
</head>
<body>
<header>
  <h1>Winsener Meisterschaften — Anmeldungen</h1>
  <div class="counts" id="counts"></div>
  <div class="tools" id="tools" hidden>
    <button class="btn-ghost" id="refresh">LK aus nuLiga aktualisieren</button>
    <a class="export btn-ghost" id="exportlink" href="#" target="_blank" rel="noopener" style="color:#fff;text-decoration:none">CSV-Export ↧</a>
  </div>
</header>
<main>
  <div class="gate" id="gate">
    <input id="token" type="password" placeholder="Admin-Token" autocomplete="off" />
    <button class="btn-primary" id="login">Anmelden</button>
    <span class="msg" id="gatemsg"></span>
  </div>
  <div class="msg" id="msg"></div>
  <div id="list"></div>
</main>
<script>
  const KONK = { 'mens': 'Herren', 'mens-challenger': 'Herren Challenger', 'womens': 'Damen' }
  let TOKEN = sessionStorage.getItem('admin_token') || new URLSearchParams(location.search).get('token') || ''

  const el = id => document.getElementById(id)
  function setMsg(t){ el('msg').textContent = t; if(t) setTimeout(()=>{ if(el('msg').textContent===t) el('msg').textContent='' }, 4000) }

  async function api(path, opts={}){
    const res = await fetch(path, { ...opts, headers: { 'content-type':'application/json', 'x-admin-token': TOKEN, ...(opts.headers||{}) } })
    if(res.status === 401) throw new Error('unauthorized')
    if(!res.ok) throw new Error('Fehler ' + res.status)
    return res.json()
  }

  async function load(){
    let data
    try { data = await api('/api/admin/list') }
    catch(e){
      if(String(e.message)==='unauthorized'){ el('gate').style.display='flex'; el('gatemsg').textContent='Token ungültig.'; return }
      setMsg('Konnte nicht laden.'); return
    }
    el('gate').style.display='none'
    el('tools').hidden = false
    sessionStorage.setItem('admin_token', TOKEN)
    el('exportlink').href = '/export?token=' + encodeURIComponent(TOKEN)
    render(data.registrations || [])
  }

  function counts(rows){
    const conf = rows.filter(r=>r.status==='confirmed')
    const by = k => conf.filter(r=>r.competition===k).length
    el('counts').textContent = 'Bestätigt: ' + conf.length + ' (Herren ' + by('mens') + ' · Challenger ' + by('mens-challenger') + ' · Damen ' + by('womens') + ') · Gesamt ' + rows.length
  }

  function render(rows){
    counts(rows)
    const order = { 'new':0, 'confirmed':1, 'hidden':2, 'cancelled':3 }
    rows.sort((a,b)=> (order[a.status]-order[b.status]) || a.created_at.localeCompare(b.created_at))
    const list = el('list'); list.innerHTML=''
    let lastStatus = null
    const labels = { 'new':'Neu — zu bestätigen', 'confirmed':'Bestätigt (öffentlich)', 'hidden':'Versteckt', 'cancelled':'Abgemeldet' }
    for(const r of rows){
      if(r.status !== lastStatus){ const h=document.createElement('div'); h.className='group'; h.textContent=labels[r.status]||r.status; list.appendChild(h); lastStatus=r.status }
      list.appendChild(cardFor(r))
    }
    if(!rows.length){ list.innerHTML='<p>Noch keine Anmeldungen.</p>' }
  }

  function cardFor(r){
    const card = document.createElement('div')
    card.className = 'card s-' + r.status
    const challWarn = (r.competition==='mens-challenger' && r.lk && parseFloat(r.lk) < 20)
      ? '<span class="warn">⚠ LK &lt; 20 — gehört ins Hauptfeld?</span>' : ''
    card.innerHTML =
      '<div class="row1"><span class="name"></span>'
      + '<span class="badge"></span>'
      + '<span class="meta"></span>' + challWarn + '</div>'
      + '<div class="contact"></div>'
      + '<div class="row2">'
      + '<label>Spieler-ID</label><input class="pid" type="text" inputmode="numeric" maxlength="8" placeholder="8-stellig" />'
      + '<label class="noid"><input type="checkbox" class="cb-noid" /> keine ID</label>'
      + '<label>LK</label><input class="lk" type="text" inputmode="decimal" placeholder="—" />'
      + '<label>Feld</label><select class="konk"><option value="mens">Herren</option><option value="mens-challenger">Herren Challenger</option><option value="womens">Damen</option></select>'
      + '<button class="btn-primary act-confirm">Bestätigen</button>'
      + '<button class="btn-hide act-hide">Verstecken</button>'
      + '</div>'
    card.querySelector('.name').textContent = r.first_name + ' ' + r.last_name
    card.querySelector('.badge').textContent = KONK[r.competition] || r.competition
    card.querySelector('.meta').textContent = r.club + (r.note ? ' · „' + r.note + '"' : '')
    card.querySelector('.contact').textContent = r.email + (r.phone ? ' · ' + r.phone : '')
    const pid = card.querySelector('.pid'); pid.value = r.player_id || ''
    const noid = card.querySelector('.cb-noid')
    const lk = card.querySelector('.lk'); lk.value = r.lk || ''
    const konk = card.querySelector('.konk'); konk.value = r.competition
    card.querySelector('.act-confirm').addEventListener('click', ()=>{
      const pidVal = pid.value.trim()
      if(!pidVal && !noid.checked){ setMsg('Bitte Spieler-ID eintragen oder „keine ID" ankreuzen.'); return }
      const payload = { id: r.id, competition: konk.value, status: 'confirmed' }
      if(pidVal){ payload.player_id = pidVal; if(lk.value.trim()) payload.lk = lk.value.trim() }
      else { payload.player_id = ''; payload.lk = lk.value.trim() || '25.0' }
      update(payload)
    })
    card.querySelector('.act-hide').addEventListener('click', ()=> update({ id:r.id, status:'hidden' }))
    return card
  }

  async function update(payload){
    try { await api('/api/admin/update', { method:'POST', body: JSON.stringify(payload) }); setMsg('Gespeichert.'); load() }
    catch(e){ setMsg('Fehler beim Speichern.') }
  }

  el('refresh').addEventListener('click', async ()=>{
    setMsg('Aktualisiere LK aus nuLiga …')
    try { const r = await api('/api/admin/refresh-lk', { method:'POST' }); setMsg(r.updated + ' LK aktualisiert.'); load() }
    catch(e){ setMsg('LK-Update fehlgeschlagen.') }
  })

  el('login').addEventListener('click', ()=>{ TOKEN = el('token').value.trim(); if(TOKEN) load() })
  el('token').addEventListener('keydown', e=>{ if(e.key==='Enter'){ TOKEN = el('token').value.trim(); if(TOKEN) load() } })

  if(TOKEN) load(); else el('gate').style.display='flex'
</script>
</body>
</html>`
