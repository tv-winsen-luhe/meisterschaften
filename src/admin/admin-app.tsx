import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hc } from 'hono/client'
import type { AppType } from '../../worker/app'
import { type AdminRegistration, type Phase } from '../../shared'
import { cn } from '@/admin/lib/utils'
import { Button } from '@/admin/ui/button'
import { Separator } from '@/admin/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/admin/ui/sidebar'
import { AppSidebar, type Surface } from './app-sidebar'
import { PHASE_LABELS, PhaseStepper } from './phase-stepper'
import { OverviewSurface } from './surfaces/overview-surface'
import { RegistrationsSurface, type StatusFilter } from './surfaces/registrations-surface'
import { type ConfirmPayload } from './registration-card'

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
// primitives in the neutral default look (ADR-0016). It is a navigable shell (ADR-0019): the
// sidebar switches surfaces ("where am I"), the phase stepper header sets the phase ("where is
// the event"), and the content region renders the active surface. Auth is edge-only (Cloudflare
// Access, ADR-0008): there is no in-app login — the operator is already authenticated before this
// island ever loads.
export const AdminApp = () => {
  const [ready, setReady] = useState(false)
  const [everLoaded, setEverLoaded] = useState(false)
  const [registrations, setRegistrations] = useState<AdminRegistration[]>([])
  const [phase, setPhase] = useState<Phase | null>(null)
  const [surface, setSurface] = useState<Surface>('registrations')
  // The registrations filter/search live here, not in the surface, so they survive the operator
  // switching to another surface and back (the surface unmounts; the shell does not).
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
      // so it is fetched separately and updates the stepper only on success (a failed read
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
  // The stepper owns the confirmation dialog (ADR-0019), so this just performs the mutation.
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

  // Until the first successful load, hold a loading/error screen rather than the full admin — a
  // failed load must not look like an empty registration list (the operator could mistake a
  // backend hiccup for "nobody signed up"). Once loaded, later refresh failures only toast.
  if (!ready || !everLoaded) {
    return (
      <main className="grid min-h-svh place-items-center p-5">
        {!ready ? (
          <p className="text-muted-foreground text-sm">Lädt …</p>
        ) : (
          <p className="text-muted-foreground text-center text-sm">
            Konnte die Anmeldungen nicht laden.{' '}
            <Button variant="outline" size="sm" onClick={() => location.reload()}>
              Neu laden
            </Button>
          </p>
        )}
        {toast && <Toast text={toast.text} err={toast.err} />}
      </main>
    )
  }

  return (
    <SidebarProvider>
      <AppSidebar active={surface} onSelect={setSurface} />
      <SidebarInset>
        {/* The phase stepper sits above every surface (ADR-0019). Non-sticky so the Anmeldungen
            filter bar below can pin to the top while a long list scrolls, as it did before. */}
        <header className="bg-background flex items-center gap-2 border-b px-4 py-3">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 !h-5" />
          <PhaseStepper phase={phase} onChange={changePhase} />
        </header>
        {surface === 'overview' ? (
          <OverviewSurface />
        ) : (
          <RegistrationsSurface
            registrations={registrations}
            filter={filter}
            onFilterChange={setFilter}
            query={query}
            onQueryChange={setQuery}
            onConfirm={confirm}
            onCancel={cancel}
            onDelete={remove}
            onRefreshLk={refreshLk}
          />
        )}
      </SidebarInset>
      {toast && <Toast text={toast.text} err={toast.err} />}
    </SidebarProvider>
  )
}

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
