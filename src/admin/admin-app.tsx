import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import { PHASES, type AdminRegistration, type Phase } from '../../shared'
import { RegistrationCard, type ConfirmPayload } from './registration-card'
import { btnBase, focusRing } from './styles'

const ghost =
  'inline-flex items-center gap-[5px] border-[1.5px] border-white/35 px-3 py-[7px] text-[13px] text-white no-underline hover:border-neon hover:text-neon'

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
        <header className="sticky top-0 z-20 border-b-[3px] border-neon bg-linear-to-b from-navy to-surface-dark text-white">
          <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-5 py-[14px]">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-[11px] tracking-[0.18em] text-neon uppercase">
                Winsener Meisterschaften 2026
              </span>
              <h1 className="text-[clamp(20px,3.4vw,28px)] leading-none font-extrabold tracking-[-0.02em]">
                Anmeldungen
              </h1>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1120px] p-5">
          {!ready ? (
            <p className="px-4 py-12 text-center text-[15px] text-text-muted">Lädt …</p>
          ) : (
            <p className="px-4 py-12 text-center text-[15px] text-text-muted">
              Konnte die Anmeldungen nicht laden.{' '}
              <button className={`${btnBase} ${focusRing} ${ghost}`} onClick={() => location.reload()}>
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
      <header className="sticky top-0 z-20 border-b-[3px] border-neon bg-linear-to-b from-navy to-surface-dark text-white">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-5 py-[14px]">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-[11px] tracking-[0.18em] text-neon uppercase">
              Winsener Meisterschaften 2026
            </span>
            <h1 className="text-[clamp(20px,3.4vw,28px)] leading-none font-extrabold tracking-[-0.02em]">
              Anmeldungen
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={`${btnBase} ${focusRing} ${ghost}`} onClick={refreshLk}>
              ↻ LK aus nuLiga
            </button>
            <a className={`${focusRing} ${ghost}`} href="/cdn-cgi/access/logout">
              Abmelden
            </a>
          </div>
        </div>
        <div className="mx-auto grid max-w-[1120px] grid-cols-3 gap-2 px-5 pb-4 min-[721px]:grid-cols-6">
          <Tile label="Gesamt" value={registrations.length} />
          <Tile label="Neu" value={count('new')} variant="new" />
          <Tile label="Bestätigt" value={confirmed.length} variant="conf" />
          <Tile label="Herren" value={byCompetition('mens')} variant="sub" />
          <Tile label="Challenger" value={byCompetition('mens-challenger')} variant="sub" />
          <Tile label="Damen" value={byCompetition('womens')} variant="sub" />
        </div>
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-3 px-5 pb-4">
          <span className="text-[10px] font-bold tracking-[0.14em] text-white/60 uppercase">Phase</span>
          <div className="flex flex-wrap gap-0.5" role="group" aria-label="Phase">
            {PHASES.map(p => (
              <button
                key={p}
                type="button"
                className={`${btnBase} ${focusRing} border px-[13px] py-1.5 text-xs tracking-[0.02em] ${
                  phase === p
                    ? 'border-neon bg-neon text-navy'
                    : 'border-white/14 bg-white/6 text-white/70 hover:border-white/35 hover:text-white'
                }`}
                aria-pressed={phase === p}
                onClick={() => changePhase(p)}
              >
                {PHASE_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="sticky top-0 z-10 border-b border-border-strong bg-surface shadow-[0_1px_0_rgba(12,30,58,0.04)]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-3 px-5 py-[9px]">
          <div className="flex flex-wrap gap-0.5">
            {TABS.map(s => (
              <button
                key={s}
                className={`${btnBase} ${focusRing} border-b-[3px] px-[11px] py-[7px] text-[13px] ${
                  filter === s ? 'border-neon text-text' : 'border-transparent text-text-muted hover:text-text'
                }`}
                onClick={() => setFilter(s)}
              >
                {STATUS_LABELS[s]}
                <span className="ml-[3px] font-mono text-[11px] font-bold opacity-70">{count(s)}</span>
              </button>
            ))}
          </div>
          <input
            className={`${focusRing} ml-auto max-w-[320px] min-w-[160px] flex-1 border-[1.5px] border-border-strong bg-surface-alt px-[11px] py-2 text-[13px] text-text placeholder:text-text-muted`}
            type="search"
            placeholder="Name, E-Mail, Verein, ID …"
            autoComplete="off"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>
      <main className="mx-auto max-w-[1120px] p-5">
        {registrations.length === 0 ? (
          <p className="px-4 py-12 text-center text-[15px] text-text-muted">
            Noch keine Anmeldungen. Die Liste füllt sich, sobald jemand das Formular abschickt.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-12 text-center text-[15px] text-text-muted">Keine Treffer für diesen Filter.</p>
        ) : (
          visible.map(reg => {
            const header = grouped && reg.status !== lastStatus ? ((lastStatus = reg.status), reg.status) : null
            return (
              <div key={`${reg.id}:${reg.status}:${reg.competition}:${reg.club}:${reg.playerId}:${reg.lk}`}>
                {header && (
                  <div className="mt-[26px] mb-2.5 flex items-center gap-2.5 font-mono text-xs font-bold tracking-[0.12em] text-text-muted uppercase">
                    {GROUP_LABELS[header] ?? header}
                    <span className="h-px flex-1 bg-border-strong" />
                  </div>
                )}
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
  variant?: 'new' | 'conf' | 'sub'
}
const Tile = ({ label, value, variant }: TileProps) => {
  const box =
    variant === 'conf'
      ? 'border-neon bg-neon/10'
      : variant === 'sub'
        ? 'border-white/14 bg-transparent'
        : 'border-white/14 bg-white/6'
  const numSize = variant === 'sub' ? 'text-[19px]' : 'text-2xl'
  const numColor =
    variant === 'new' ? 'text-blue' : variant === 'conf' ? 'text-neon' : variant === 'sub' ? 'text-white/90' : ''
  return (
    <div className={`flex flex-col gap-0.5 border px-[11px] py-[9px] ${box}`}>
      <span className={`font-mono ${numSize} leading-none font-bold tabular-nums ${numColor}`}>{value}</span>
      <span className="text-[10px] font-bold tracking-[0.14em] text-white/60 uppercase">{label}</span>
    </div>
  )
}

interface ToastProps {
  text: string
  err: boolean
}
const Toast = ({ text, err }: ToastProps) => (
  <div
    className={`pointer-events-none fixed bottom-[22px] left-1/2 z-50 -translate-x-1/2 border-l-4 bg-navy px-[18px] py-[11px] text-sm font-bold text-white shadow-[0_8px_24px_rgba(12,30,58,0.28)] ${err ? 'border-l-clay' : 'border-l-neon'}`}
    role="status"
    aria-live="polite"
  >
    {text}
  </div>
)
