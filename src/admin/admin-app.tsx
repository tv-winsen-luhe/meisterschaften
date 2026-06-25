import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import type { AdminRegistration } from '../../shared'
import { RegistrationCard, type ConfirmPayload } from './registration-card'
import './admin.css'

type StatusFilter = 'all' | AdminRegistration['status']

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Alle',
  new: 'Neu',
  confirmed: 'Bestätigt',
  hidden: 'Versteckt',
  cancelled: 'Abgemeldet'
}
const GROUP_LABELS: Record<string, string> = {
  new: 'Neu — zu bestätigen',
  confirmed: 'Bestätigt — öffentlich',
  hidden: 'Versteckt',
  cancelled: 'Abgemeldet'
}
const ORDER: Record<string, number> = { new: 0, confirmed: 1, hidden: 2, cancelled: 3 }
const TABS: StatusFilter[] = ['all', 'new', 'confirmed', 'hidden', 'cancelled']

// hc types each route's status as a literal union (the middleware 401 is not in it), so a
// `res.status === 401` against that union trips no-overlap. Widening to { status: number }
// keeps the runtime auth check while staying honest that the gate can answer 401.
const isUnauthorized = (res: { status: number }) => res.status === 401

// Pull the { error } message out of any non-OK admin response.
const errorMessage = async (res: Response): Promise<string> => {
  try {
    const data = (await res.json()) as { error?: string }
    return data?.error ?? `Fehler ${res.status}`
  } catch {
    return `Fehler ${res.status}`
  }
}

const initialToken = (): string => {
  if (typeof window === 'undefined') return ''
  return sessionStorage.getItem('admin_token') || new URLSearchParams(location.search).get('token') || ''
}

// The admin SPA: a `client:only` React island on the Hono typed `hc` client. Replaces the
// legacy HTML-string admin at functional parity — token gate, stat tiles, status tabs, search,
// and the editable registration cards driving the confirm/hide/delete/refresh-LK/export flows.
export const AdminApp = () => {
  const [token, setToken] = useState(initialToken)
  const [authed, setAuthed] = useState(false)
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([])
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [gateMsg, setGateMsg] = useState('')

  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showToast = useCallback((text: string, err = false) => {
    setToast({ text, err })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])

  const client = useMemo(() => hc<AppType>(location.origin, { headers: { 'x-admin-token': token } }), [token])

  const logout = useCallback(() => {
    sessionStorage.removeItem('admin_token')
    setToken('')
    setAuthed(false)
    setRegistrations([])
    setGateMsg('')
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await client.api.admin.list.$get()
      if (isUnauthorized(res)) {
        setAuthed(false)
        setGateMsg('Token ungültig.')
        return
      }
      if (!res.ok) {
        showToast('Konnte nicht laden.', true)
        return
      }
      const data = await res.json()
      sessionStorage.setItem('admin_token', token)
      setRegistrations(data.registrations)
      setAuthed(true)
    } catch {
      showToast('Konnte nicht laden.', true)
    }
  }, [client, token, showToast])

  useEffect(() => {
    if (token) load()
  }, [token, load])

  // Wrap a mutation: run it, surface 401 as a re-gate, toast its error, else toast success + reload.
  const mutate = useCallback(
    async (run: () => Promise<Response>, success: string) => {
      try {
        const res = await run()
        if (isUnauthorized(res)) {
          logout()
          setGateMsg('Token ungültig.')
          return
        }
        if (!res.ok) {
          showToast(await errorMessage(res), true)
          return
        }
        showToast(success)
        await load()
      } catch {
        showToast('Aktion fehlgeschlagen.', true)
      }
    },
    [load, logout, showToast]
  )

  const confirm = useCallback(
    async (id: number, payload: ConfirmPayload) => {
      try {
        const res = await client.api.admin.confirm.$post({ json: { id, ...payload } })
        if (isUnauthorized(res)) {
          logout()
          setGateMsg('Token ungültig.')
          return
        }
        if (!res.ok) {
          showToast(await errorMessage(res), true)
          return
        }
        const data = await res.json()
        showToast(data.lkFetched ? `Gespeichert · LK ${data.lkFetched} geholt.` : 'Gespeichert.')
        await load()
      } catch {
        showToast('Fehler beim Speichern.', true)
      }
    },
    [client, load, logout, showToast]
  )

  const hide = useCallback(
    (id: number) => mutate(() => client.api.admin.hide.$post({ json: { id } }), 'Versteckt.'),
    [client, mutate]
  )

  const remove = useCallback(
    (reg: AdminRegistration) => {
      if (
        !window.confirm(
          `Anmeldung von ${reg.firstName} ${reg.lastName} wirklich löschen?\n\n` +
            'Dieser Eintrag wird endgültig aus der Datenbank entfernt.'
        )
      )
        return
      mutate(() => client.api.admin.delete.$post({ json: { id: reg.id } }), 'Gelöscht.')
    },
    [client, mutate]
  )

  const refreshLk = useCallback(async () => {
    showToast('Aktualisiere LK aus nuLiga …')
    await mutate(() => client.api.admin['refresh-lk'].$post(), 'LK aktualisiert.')
  }, [client, mutate, showToast])

  const login = () => {
    const t = tokenInput.trim()
    if (t) setToken(t)
  }

  // ── Derived view state ────────────────────────────────────────────────────────────────
  const confirmed = registrations.filter(r => r.status === 'confirmed')
  const byCompetition = (slug: string) => confirmed.filter(r => r.competition === slug).length
  const count = (s: StatusFilter) =>
    s === 'all' ? registrations.length : registrations.filter(r => r.status === s).length

  const q = query.trim().toLowerCase()
  const visible = registrations
    .filter(r => filter === 'all' || r.status === filter)
    .filter(
      r => !q || `${r.firstName} ${r.lastName} ${r.email} ${r.club} ${r.playerId ?? ''}`.toLowerCase().includes(q)
    )
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.createdAt.localeCompare(b.createdAt))

  if (!authed) {
    return (
      <>
        <header>
          <div className="head-bar">
            <div className="brand">
              <span className="brand__tag">Winsener Meisterschaften 2026</span>
              <h1>Anmeldungen</h1>
            </div>
          </div>
        </header>
        <main>
          <div className="gate">
            <span className="gate__tag">Vereinsintern</span>
            <h2>Admin-Anmeldung</h2>
            <div className="gate__field">
              <input
                type="password"
                placeholder="Admin-Token"
                autoComplete="off"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && login()}
              />
              <button className="btn-primary" onClick={login}>
                Anmelden
              </button>
            </div>
            <div className="gatemsg">{gateMsg}</div>
          </div>
        </main>
        {toast && <Toast text={toast.text} err={toast.err} />}
      </>
    )
  }

  let lastStatus: string | null = null
  const grouped = filter === 'all'

  return (
    <>
      <header>
        <div className="head-bar">
          <div className="brand">
            <span className="brand__tag">Winsener Meisterschaften 2026</span>
            <h1>Anmeldungen</h1>
          </div>
          <div className="tools">
            <button className="btn-ghost" onClick={refreshLk}>
              ↻ LK aus nuLiga
            </button>
            <a className="btn-ghost" href={`/export?token=${encodeURIComponent(token)}`} target="_blank" rel="noopener">
              CSV-Export ↧
            </a>
            <button className="btn-ghost" onClick={logout}>
              Abmelden
            </button>
          </div>
        </div>
        <div className="stats">
          <Tile label="Gesamt" value={registrations.length} />
          <Tile label="Neu" value={count('new')} cls="is-new" />
          <Tile label="Bestätigt" value={confirmed.length} cls="is-conf" />
          <Tile label="Herren" value={byCompetition('mens')} cls="sub" />
          <Tile label="Challenger" value={byCompetition('mens-challenger')} cls="sub" />
          <Tile label="Damen" value={byCompetition('womens')} cls="sub" />
        </div>
      </header>
      <div className="filterbar">
        <div className="filterbar-inner">
          <div className="tabs">
            {TABS.map(s => (
              <button key={s} className={`tab${filter === s ? 'is-active' : ''}`} onClick={() => setFilter(s)}>
                {STATUS_LABELS[s]}
                <span className="tab__c">{count(s)}</span>
              </button>
            ))}
          </div>
          <input
            className="search"
            type="search"
            placeholder="Name, E-Mail, Verein, ID …"
            autoComplete="off"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>
      <main>
        {registrations.length === 0 ? (
          <p className="empty">Noch keine Anmeldungen. Die Liste füllt sich, sobald jemand das Formular abschickt.</p>
        ) : visible.length === 0 ? (
          <p className="empty">Keine Treffer für diesen Filter.</p>
        ) : (
          visible.map(reg => {
            const header = grouped && reg.status !== lastStatus ? ((lastStatus = reg.status), reg.status) : null
            return (
              <div key={`${reg.id}:${reg.status}:${reg.competition}:${reg.club}:${reg.playerId}:${reg.lk}`}>
                {header && <div className="group">{GROUP_LABELS[header] ?? header}</div>}
                <RegistrationCard reg={reg} onConfirm={confirm} onHide={hide} onDelete={remove} />
              </div>
            )
          })
        )}
      </main>
      {toast && <Toast text={toast.text} err={toast.err} />}
    </>
  )
}

const Tile = ({ label, value, cls }: { label: string; value: number; cls?: string }) => (
  <div className={`tile ${cls ?? ''}`}>
    <span className="tile__n">{value}</span>
    <span className="tile__l">{label}</span>
  </div>
)

const Toast = ({ text, err }: { text: string; err: boolean }) => (
  <div className={`toast show${err ? 'err' : ''}`} role="status" aria-live="polite">
    {text}
  </div>
)
