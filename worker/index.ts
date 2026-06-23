/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database
  ASSETS: Fetcher
  PUBLIC_LIST_ENABLED: string
  ADMIN_TOKEN: string
}

const KONKURRENZEN = ['herren', 'herren-challenger'] as const
const VEREINE = ['TV Winsen/Luhe', 'TSV Winsen'] as const
const STATUS = ['neu', 'bestaetigt', 'versteckt'] as const
const DEFAULT_LK = '25.0'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })

const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    try {
      if (path === '/api/anmeldung' && method === 'POST') return await handleAnmeldung(request, env)
      if (path === '/api/teilnehmer' && method === 'GET') return await handleTeilnehmer(env)
      if (path === '/admin' && method === 'GET') return adminPage()
      if (path === '/api/admin/list' && method === 'GET') return await handleAdminList(request, env)
      if (path === '/api/admin/update' && method === 'POST') return await handleAdminUpdate(request, env)
      if (path === '/export' && method === 'GET') return await handleExport(request, env, url)
    } catch (err) {
      return json({ error: 'Serverfehler. Bitte später erneut versuchen.', detail: String(err) }, 500)
    }

    // Alles andere → statische Astro-Seite
    return env.ASSETS.fetch(request)
  }
}

async function handleAnmeldung(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Ungültige Anfrage.' }, 400)
  }

  // Honeypot: Bots füllen das versteckte Feld aus → still „erfolgreich" abweisen.
  if (str(body.website)) return json({ ok: true })

  const konkurrenz = str(body.konkurrenz)
  const vorname = str(body.vorname)
  const nachname = str(body.nachname)
  const verein = str(body.verein)
  const email = str(body.email)
  const handy = str(body.handy)
  const anmerkung = str(body.anmerkung)
  const einwilligung = str(body.einwilligung)

  if (!KONKURRENZEN.includes(konkurrenz as (typeof KONKURRENZEN)[number]))
    return json({ error: 'Bitte wähle eine gültige Konkurrenz.' }, 400)
  if (!vorname || vorname.length > 60) return json({ error: 'Bitte gib deinen Vornamen an.' }, 400)
  if (!nachname || nachname.length > 60) return json({ error: 'Bitte gib deinen Nachnamen an.' }, 400)
  if (!VEREINE.includes(verein as (typeof VEREINE)[number])) return json({ error: 'Bitte wähle deinen Verein.' }, 400)
  if (!email || email.length > 120 || !isEmail(email))
    return json({ error: 'Bitte gib eine gültige E-Mail-Adresse an.' }, 400)
  if (handy.length > 40) return json({ error: 'Handynummer ist zu lang.' }, 400)
  if (anmerkung.length > 500) return json({ error: 'Anmerkung ist zu lang (max. 500 Zeichen).' }, 400)
  if (einwilligung !== 'ja') return json({ error: 'Bitte bestätige die Einwilligung.' }, 400)

  const ip = request.headers.get('cf-connecting-ip') ?? ''

  // Weicher Rate-Limit: max. 3 Anmeldungen pro IP/Stunde.
  if (ip) {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString()
    const recent = await env.DB.prepare('SELECT COUNT(*) AS c FROM meldungen WHERE ip = ? AND created_at > ?')
      .bind(ip, oneHourAgo)
      .first<{ c: number }>()
    if (recent && recent.c >= 3)
      return json({ error: 'Zu viele Anmeldungen in kurzer Zeit. Bitte versuch es später erneut.' }, 429)
  }

  await env.DB.prepare(
    `INSERT INTO meldungen (created_at, konkurrenz, vorname, nachname, verein, email, handy, anmerkung, status, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'neu', ?)`
  )
    .bind(
      new Date().toISOString(),
      konkurrenz,
      vorname,
      nachname,
      verein,
      email,
      handy || null,
      anmerkung || null,
      ip || null
    )
    .run()

  return json({ ok: true })
}

async function handleTeilnehmer(env: Env): Promise<Response> {
  if (env.PUBLIC_LIST_ENABLED !== 'true') return json({ enabled: false, teilnehmer: [] })

  const { results } = await env.DB.prepare(
    `SELECT vorname, nachname, verein, konkurrenz, COALESCE(lk, ?) AS lk
       FROM meldungen
      WHERE status = 'bestaetigt'
      ORDER BY konkurrenz ASC, CAST(COALESCE(lk, ?) AS REAL) ASC, created_at ASC`
  )
    .bind(DEFAULT_LK, DEFAULT_LK)
    .all()

  return json({ enabled: true, teilnehmer: results ?? [] })
}

function checkToken(request: Request, env: Env): boolean {
  const token = request.headers.get('x-admin-token') ?? ''
  return Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN
}

async function handleAdminList(request: Request, env: Env): Promise<Response> {
  if (!checkToken(request, env)) return json({ error: 'Nicht autorisiert.' }, 401)
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, konkurrenz, vorname, nachname, verein, email, handy, anmerkung, lk, status
       FROM meldungen
      ORDER BY status ASC, konkurrenz ASC, created_at ASC`
  ).all()
  return json({ meldungen: results ?? [] })
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

  if (body.lk !== undefined) {
    const lk = str(body.lk)
    if (lk && !/^\d{1,2}([.,]\d)?$/.test(lk)) return json({ error: 'LK-Format ungültig (z. B. 20.3).' }, 400)
    sets.push('lk = ?')
    binds.push(lk ? lk.replace(',', '.') : null)
  }
  if (body.konkurrenz !== undefined) {
    const k = str(body.konkurrenz)
    if (!KONKURRENZEN.includes(k as (typeof KONKURRENZEN)[number])) return json({ error: 'Ungültige Konkurrenz.' }, 400)
    sets.push('konkurrenz = ?')
    binds.push(k)
  }
  if (body.status !== undefined) {
    const s = str(body.status)
    if (!STATUS.includes(s as (typeof STATUS)[number])) return json({ error: 'Ungültiger Status.' }, 400)
    sets.push('status = ?')
    binds.push(s)
  }

  if (sets.length === 0) return json({ error: 'Keine Änderung übergeben.' }, 400)

  binds.push(id)
  await env.DB.prepare(`UPDATE meldungen SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run()
  return json({ ok: true })
}

async function handleExport(request: Request, env: Env, url: URL): Promise<Response> {
  const token = url.searchParams.get('token') ?? ''
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return new Response('Nicht autorisiert.', { status: 401 })

  const { results } = await env.DB.prepare(
    `SELECT id, created_at, konkurrenz, vorname, nachname, verein, email, handy, anmerkung, lk, status
       FROM meldungen ORDER BY created_at ASC`
  ).all<Record<string, unknown>>()

  const cols = [
    'id',
    'created_at',
    'konkurrenz',
    'vorname',
    'nachname',
    'verein',
    'email',
    'handy',
    'anmerkung',
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
  main { padding:16px; max-width:1100px; margin:0 auto; }
  .gate { display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:16px; background:#fff; border:1px solid #ddd; }
  .gate input { flex:1; min-width:200px; padding:10px; font:inherit; border:1.5px solid #ccc; }
  button { font:inherit; font-weight:700; cursor:pointer; border:none; padding:8px 12px; }
  .btn-primary { background:var(--neon); color:var(--navy); }
  .btn-hide { background:#e5e5e5; color:var(--navy); }
  .msg { padding:10px 0; font-size:13px; font-weight:600; min-height:20px; }
  .group { margin:22px 0 8px; font-size:13px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; opacity:.6; }
  .card { background:#fff; border:1px solid #ddd; padding:12px; margin-bottom:8px; }
  .card.s-bestaetigt { border-left:4px solid var(--neon); }
  .card.s-versteckt { opacity:.5; }
  .card.s-neu { border-left:4px solid var(--blue); }
  .row1 { display:flex; flex-wrap:wrap; gap:8px 14px; align-items:baseline; }
  .name { font-size:17px; font-weight:800; }
  .meta { font-size:12px; opacity:.6; }
  .badge { font-size:10px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; padding:2px 7px; border:1.5px solid currentColor; }
  .warn { color:var(--warn); font-weight:800; font-size:12px; }
  .row2 { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; }
  .row2 label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; opacity:.6; }
  .row2 input, .row2 select { padding:7px 9px; font:inherit; border:1.5px solid #ccc; }
  .row2 input.lk { width:70px; }
  .contact { font-size:12px; opacity:.7; margin-top:6px; }
  a.export { color:var(--blue); font-size:13px; }
</style>
</head>
<body>
<header>
  <h1>Winsener Meisterschaften — Anmeldungen</h1>
  <div class="counts" id="counts"></div>
</header>
<main>
  <div class="gate" id="gate">
    <input id="token" type="password" placeholder="Admin-Token" autocomplete="off" />
    <button class="btn-primary" id="login">Anmelden</button>
    <span class="msg" id="gatemsg"></span>
  </div>
  <div class="msg" id="msg"></div>
  <div id="list"></div>
  <p><a class="export" id="exportlink" href="#" target="_blank" rel="noopener">CSV-Export herunterladen ↧</a></p>
</main>
<script>
  const KONK = { 'herren': 'Herren', 'herren-challenger': 'Herren Challenger' }
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
    sessionStorage.setItem('admin_token', TOKEN)
    el('exportlink').href = '/export?token=' + encodeURIComponent(TOKEN)
    render(data.meldungen || [])
  }

  function counts(rows){
    const conf = rows.filter(r=>r.status==='bestaetigt')
    const by = k => conf.filter(r=>r.konkurrenz===k).length
    el('counts').textContent = 'Bestätigt: ' + conf.length + ' (Herren ' + by('herren') + ' · Challenger ' + by('herren-challenger') + ') · Gesamt ' + rows.length
  }

  function render(rows){
    counts(rows)
    const order = { 'neu':0, 'bestaetigt':1, 'versteckt':2 }
    rows.sort((a,b)=> (order[a.status]-order[b.status]) || a.created_at.localeCompare(b.created_at))
    const list = el('list'); list.innerHTML=''
    let lastStatus = null
    const labels = { 'neu':'Neu — zu bestätigen', 'bestaetigt':'Bestätigt (öffentlich)', 'versteckt':'Versteckt' }
    for(const r of rows){
      if(r.status !== lastStatus){ const h=document.createElement('div'); h.className='group'; h.textContent=labels[r.status]||r.status; list.appendChild(h); lastStatus=r.status }
      list.appendChild(cardFor(r))
    }
    if(!rows.length){ list.innerHTML='<p>Noch keine Anmeldungen.</p>' }
  }

  function cardFor(r){
    const card = document.createElement('div')
    card.className = 'card s-' + r.status
    const challWarn = (r.konkurrenz==='herren-challenger' && r.lk && parseFloat(r.lk) < 20)
      ? '<span class="warn">⚠ LK &lt; 20 — gehört ins Hauptfeld?</span>' : ''
    card.innerHTML =
      '<div class="row1"><span class="name"></span>'
      + '<span class="badge"></span>'
      + '<span class="meta"></span>' + challWarn + '</div>'
      + '<div class="contact"></div>'
      + '<div class="row2">'
      + '<label>LK</label><input class="lk" type="text" inputmode="decimal" placeholder="25.0" />'
      + '<label>Feld</label><select class="konk"><option value="herren">Herren</option><option value="herren-challenger">Herren Challenger</option></select>'
      + '<button class="btn-primary act-confirm">Bestätigen</button>'
      + '<button class="btn-hide act-hide">Verstecken</button>'
      + '</div>'
    card.querySelector('.name').textContent = r.vorname + ' ' + r.nachname
    const badge = card.querySelector('.badge'); badge.textContent = KONK[r.konkurrenz] || r.konkurrenz
    card.querySelector('.meta').textContent = r.verein + (r.anmerkung ? ' · „' + r.anmerkung + '"' : '')
    card.querySelector('.contact').textContent = r.email + (r.handy ? ' · ' + r.handy : '')
    const lkInput = card.querySelector('.lk'); lkInput.value = r.lk || ''
    const konkSel = card.querySelector('.konk'); konkSel.value = r.konkurrenz
    card.querySelector('.act-confirm').addEventListener('click', ()=> update({ id:r.id, lk:lkInput.value.trim()||'25.0', konkurrenz:konkSel.value, status:'bestaetigt' }))
    card.querySelector('.act-hide').addEventListener('click', ()=> update({ id:r.id, status:'versteckt' }))
    return card
  }

  async function update(payload){
    try { await api('/api/admin/update', { method:'POST', body: JSON.stringify(payload) }); setMsg('Gespeichert.'); load() }
    catch(e){ setMsg('Fehler beim Speichern.') }
  }

  el('login').addEventListener('click', ()=>{ TOKEN = el('token').value.trim(); if(TOKEN) load() })
  el('token').addEventListener('keydown', e=>{ if(e.key==='Enter'){ TOKEN = el('token').value.trim(); if(TOKEN) load() } })

  if(TOKEN) load(); else el('gate').style.display='flex'
</script>
</body>
</html>`
