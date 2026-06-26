import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import { PHASES, type AdminRegistration, type Phase } from '../../shared'
import { RegistrationCard, type ConfirmPayload } from './registration-card'
import './admin.css'

const PHASE_LABELS: Record<Phase, string> = {
  signup: 'Anmeldung',
  draw: 'Auslosung',
  live: 'Live',
  'post-event': 'Post-Event'
}

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

// Auth is edge-only (Cloudflare Access, ADR-0008). An expired Access session answers
// `/api/admin/*` with a 302 to the cross-origin login; `redirect: 'manual'` (see client) turns
// that into an opaque-redirect response (status 0) — that, or a bare 401, signals a full page
// reload so the browser re-runs the Access flow. Typed as the global Response (not the hc
// ClientResponse) so `status` widens from hc's literal union to number and `=== 401` type-checks.
const isAuthRedirect = (res: Response) => res.type === 'opaqueredirect' || res.status === 401

// Pull the { error } message out of any non-OK admin response.
const errorMessage = async (res: Response): Promise<string> => {
  try {
    const data = (await res.json()) as { error?: string }
    return data?.error ?? `Fehler ${res.status}`
  } catch {
    return `Fehler ${res.status}`
  }
}

// The admin SPA: a `client:only` React island on the Hono typed `hc` client. Replaces the
// legacy HTML-string admin at functional parity — stat tiles, status tabs, search, and the
// editable registration cards driving the confirm/hide/delete/refresh-LK flows. Auth is
// edge-only (Cloudflare Access, ADR-0008): there is no in-app login — the operator is already
// authenticated by Cloudflare Access before this island ever loads.
export const AdminApp = () => {
  const [ready, setReady] = useState(false)
  const [everLoaded, setEverLoaded] = useState(false)
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([])
  const [phase, setPhase] = useState<Phase | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')

  const [toast, setToast] = useState<{ text: string; err: boolean } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showToast = useCallback((text: string, err = false) => {
    setToast({ text, err })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])

  // `redirect: 'manual'` so an Access login redirect surfaces as an opaque-redirect response
  // (status 0) instead of being transparently followed cross-origin — see isAuthRedirect.
  const client = useMemo(
    () =>
      hc<AppType>(location.origin, {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, redirect: 'manual' })
      }),
    []
  )

  const load = useCallback(async () => {
    try {
      const res = await client.api.admin.list.$get()
      if (isAuthRedirect(res)) return location.reload()
      if (!res.ok) {
        showToast('Konnte nicht laden.', true)
        setReady(true)
        return
      }
      const data = await res.json()
      setRegistrations(data.registrations)
      setEverLoaded(true)
      setReady(true)
      // The phase is a public, best-effort read: a failure must not take down the admin list,
      // so it is fetched separately and updates the toggle only on success (a failed read
      // keeps the last known phase rather than blanking it).
      try {
        const phaseRes = await client.api.phase.$get()
        if (phaseRes.ok) setPhase((await phaseRes.json()).phase)
      } catch {
        // ignore — phase keeps its last known value
      }
    } catch {
      showToast('Konnte nicht laden.', true)
      setReady(true)
    }
  }, [client, showToast])

  useEffect(() => {
    load()
  }, [load])

  // Wrap a mutation: run it, force a full reload on an Access redirect (re-runs the login),
  // toast its error, else toast success + reload the list.
  const mutate = useCallback(
    async (run: () => Promise<Response>, success: string) => {
      try {
        const res = await run()
        if (isAuthRedirect(res)) return location.reload()
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
    [load, showToast]
  )

  // Set the operator-controlled phase (ADR-0006): the public site reflects it and the weekly
  // cron is gated to 'signup'. Goes through mutate, so it shares the 401-regate/error/toast
  // behaviour of every other admin action and the success reload re-fetches the current phase.
  const changePhase = useCallback(
    (next: Phase) => {
      if (next === phase) return
      mutate(() => client.api.admin.phase.$post({ json: { phase: next } }), `Phase: ${PHASE_LABELS[next]}`)
    },
    [client, phase, mutate]
  )

  const confirm = useCallback(
    async (id: number, payload: ConfirmPayload) => {
      try {
        const res = await client.api.admin.confirm.$post({ json: { id, ...payload } })
        if (isAuthRedirect(res)) return location.reload()
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
    [client, load, showToast]
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

  // Until the first successful load, hold a loading/error screen rather than the full admin — a
  // failed load must not look like an empty registration list (the operator could mistake a
  // backend hiccup for "nobody signed up"). Once loaded, later refresh failures only toast.
  if (!ready || !everLoaded) {
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
          {!ready ? (
            <p className="empty">Lädt …</p>
          ) : (
            <p className="empty">
              Konnte die Anmeldungen nicht laden.{' '}
              <button className="btn-ghost" onClick={() => location.reload()}>
                Neu laden
              </button>
            </p>
          )}
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
            <a className="btn-ghost" href="/cdn-cgi/access/logout">
              Abmelden
            </a>
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
        <div className="phasebar">
          <span className="phasebar__label">Phase</span>
          <div className="phase-toggle" role="group" aria-label="Phase">
            {PHASES.map(p => (
              <button
                key={p}
                type="button"
                className={`phase-btn${phase === p ? 'is-active' : ''}`}
                aria-pressed={phase === p}
                onClick={() => changePhase(p)}
              >
                {PHASE_LABELS[p]}
              </button>
            ))}
          </div>
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

interface TileProps {
  label: string
  value: number
  cls?: string
}
const Tile = ({ label, value, cls }: TileProps) => (
  <div className={`tile ${cls ?? ''}`}>
    <span className="tile__n">{value}</span>
    <span className="tile__l">{label}</span>
  </div>
)

interface ToastProps {
  text: string
  err: boolean
}
const Toast = ({ text, err }: ToastProps) => (
  <div className={`toast show${err ? 'err' : ''}`} role="status" aria-live="polite">
    {text}
  </div>
)
