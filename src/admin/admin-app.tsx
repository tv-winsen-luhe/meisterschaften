import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hc } from 'hono/client'
import { LogOut, RefreshCw } from 'lucide-react'
import type { AppType } from '../../worker/app'
import { PHASES, type AdminRegistration, type Phase } from '../../shared'
import { cn } from '@/admin/lib/utils'
import { Button } from '@/admin/ui/button'
import { Input } from '@/admin/ui/input'
import { RegistrationCard, type ConfirmPayload } from './registration-card'

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
  cancelled: 'Abgemeldet'
}
const GROUP_LABELS: Record<string, string> = {
  new: 'Neu — zu bestätigen',
  confirmed: 'Bestätigt — öffentlich',
  cancelled: 'Abgemeldet'
}
const ORDER: Record<string, number> = { new: 0, confirmed: 1, cancelled: 2 }
const TABS: StatusFilter[] = ['all', 'new', 'confirmed', 'cancelled']

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

// The admin SPA: a `client:only` React island on the Hono typed `hc` client, built on shadcn/ui
// primitives in the neutral default look (ADR-0016). Stat tiles, status tabs, search, and the
// editable registration cards drive the confirm/cancel/delete/refresh-LK flows. Auth is edge-only
// (Cloudflare Access, ADR-0008): there is no in-app login — the operator is already
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

  // Operator cancel by id (ADR-0018): records a drop-out the desk was told about. The card owns
  // the confirmation dialog, so this just performs the mutation. Distinct from the public
  // self-service /api/cancel (by person) — no member notification.
  const cancel = useCallback(
    (id: number) => mutate(() => client.api.admin.cancel.$post({ json: { id } }), 'Abgemeldet.'),
    [client, mutate]
  )

  // The card owns the delete confirmation (an AlertDialog), so this just performs the mutation.
  const remove = useCallback(
    (reg: AdminRegistration) => mutate(() => client.api.admin.delete.$post({ json: { id: reg.id } }), 'Gelöscht.'),
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
        <Header />
        <main className="mx-auto max-w-[1120px] p-5">
          {!ready ? (
            <p className="text-muted-foreground px-4 py-12 text-center text-sm">Lädt …</p>
          ) : (
            <p className="text-muted-foreground px-4 py-12 text-center text-sm">
              Konnte die Anmeldungen nicht laden.{' '}
              <Button variant="outline" size="sm" onClick={() => location.reload()}>
                Neu laden
              </Button>
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
      <Header>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshLk}>
            <RefreshCw />
            LK aus nuLiga
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href="/cdn-cgi/access/logout">
              <LogOut />
              Abmelden
            </a>
          </Button>
        </div>
      </Header>
      <div className="bg-background border-b">
        <div className="mx-auto grid max-w-[1120px] grid-cols-3 gap-2 px-5 py-4 min-[721px]:grid-cols-6">
          <Tile label="Gesamt" value={registrations.length} />
          <Tile label="Neu" value={count('new')} />
          <Tile label="Bestätigt" value={confirmed.length} highlight />
          <Tile label="Herren" value={byCompetition('mens')} />
          <Tile label="Challenger" value={byCompetition('mens-challenger')} />
          <Tile label="Damen" value={byCompetition('womens')} />
        </div>
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-2 px-5 pb-4">
          <span className="text-muted-foreground text-xs font-medium">Phase</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Phase">
            {PHASES.map(p => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={phase === p ? 'default' : 'outline'}
                aria-pressed={phase === p}
                onClick={() => changePhase(p)}
              >
                {PHASE_LABELS[p]}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className="bg-background/95 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-3 px-5 py-2">
          <div className="flex flex-wrap gap-1">
            {TABS.map(s => (
              <Button key={s} size="sm" variant={filter === s ? 'secondary' : 'ghost'} onClick={() => setFilter(s)}>
                {STATUS_LABELS[s]}
                <span className="font-mono text-xs font-bold opacity-60">{count(s)}</span>
              </Button>
            ))}
          </div>
          <Input
            className="ml-auto max-w-[320px] min-w-[160px] flex-1"
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
          <p className="text-muted-foreground px-4 py-12 text-center text-sm">
            Noch keine Anmeldungen. Die Liste füllt sich, sobald jemand das Formular abschickt.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-muted-foreground px-4 py-12 text-center text-sm">Keine Treffer für diesen Filter.</p>
        ) : (
          visible.map(reg => {
            const header = grouped && reg.status !== lastStatus ? ((lastStatus = reg.status), reg.status) : null
            return (
              <div key={`${reg.id}:${reg.status}:${reg.competition}:${reg.club}:${reg.playerId}:${reg.lk}`}>
                {header && (
                  <div className="text-muted-foreground mt-[26px] mb-2.5 flex items-center gap-2.5 text-xs font-semibold tracking-[0.08em] uppercase">
                    {GROUP_LABELS[header] ?? header}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                <RegistrationCard reg={reg} onConfirm={confirm} onCancel={cancel} onDelete={remove} />
              </div>
            )
          })
        )}
      </main>
      {toast && <Toast text={toast.text} err={toast.err} />}
    </>
  )
}

interface HeaderProps {
  children?: React.ReactNode
}
// Non-sticky: only the filter/search bar below pins to the top, so it stays usable while the
// operator scrolls a long list on a phone — two stacked `sticky top-0` bars would just overlap.
const Header = ({ children }: HeaderProps) => (
  <header className="bg-background border-b">
    <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-5 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-muted-foreground font-mono text-[11px] tracking-[0.18em] uppercase">
          Winsener Meisterschaften 2026
        </span>
        <h1 className="text-2xl leading-none font-bold tracking-tight">Anmeldungen</h1>
      </div>
      {children}
    </div>
  </header>
)

interface TileProps {
  label: string
  value: number
  highlight?: boolean
}
const Tile = ({ label, value, highlight }: TileProps) => (
  <div className={cn('bg-card flex flex-col gap-0.5 rounded-lg border px-3 py-2', highlight && 'ring-1 ring-ring')}>
    <span className="font-mono text-2xl leading-none font-bold tabular-nums">{value}</span>
    <span className="text-muted-foreground text-[10px] font-medium tracking-[0.1em] uppercase">{label}</span>
  </div>
)

interface ToastProps {
  text: string
  err: boolean
}
const Toast = ({ text, err }: ToastProps) => (
  <div
    className={cn(
      'bg-popover text-popover-foreground pointer-events-none fixed bottom-[22px] left-1/2 z-50 -translate-x-1/2 rounded-md border-l-4 px-[18px] py-[11px] text-sm font-medium shadow-lg',
      err ? 'border-l-destructive' : 'border-l-foreground'
    )}
    role="status"
    aria-live="polite"
  >
    {text}
  </div>
)
