import { useCallback, useEffect, useMemo, useState } from 'react'
import { hc } from 'hono/client'
import { toast } from 'sonner'
import type { AppType } from '../../worker/app'
import { type AdminRegistration, type CompetitionDraw, type CompetitionSlug, type Phase } from '../../shared'
import { errorMessage, isAuthRedirect } from './lib/api'
import { useDraw } from './use-draw'
import { useReveal } from './use-reveal'
import { useResults } from './use-results'
import { useSchedule } from './use-schedule'
import { Button } from '@/admin/ui/button'
import { Separator } from '@/admin/ui/separator'
import { Toaster } from '@/admin/ui/sonner'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/admin/ui/sidebar'
import { AppSidebar, type Surface } from './app-sidebar'
import { PHASE_LABELS, PhaseStepper } from './phase-stepper'
import { CompetitionsSurface } from './surfaces/competitions-surface'
import { ScheduleSurface } from './surfaces/schedule-surface'
import { ResultsSurface } from './surfaces/results-surface'
import { DrawShow } from './draw-show'
import { DebugSurface } from './surfaces/debug-surface'
import { OverviewSurface } from './surfaces/overview-surface'
import { type CompetitionFilter, RegistrationsSurface, type StatusFilter } from './surfaces/registrations-surface'
import { SeedingSurface } from './surfaces/seeding-surface'
import { type ConfirmPayload } from './surfaces/registration-detail'

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
  const [draws, setDraws] = useState<CompetitionDraw[]>([])
  const [phase, setPhase] = useState<Phase | null>(null)
  // Whether the debug-only reset surface exists in this environment (RESET_ENABLED, ADR-0029). Off in
  // production, so the Debug nav entry and surface never appear there.
  const [resetEnabled, setResetEnabled] = useState(false)
  const [surface, setSurface] = useState<Surface>('overview')
  // The competition whose large-screen draw show is running (issue #71), or null for the normal admin.
  // When set, the shell hands the whole screen to the beamer projection instead of the sidebar layout.
  const [showCompetition, setShowCompetition] = useState<CompetitionSlug | null>(null)
  // The registrations filter/search live here, not in the surface, so they survive the operator
  // switching to another surface and back (the surface unmounts; the shell does not).
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [competitionFilter, setCompetitionFilter] = useState<CompetitionFilter>('all')
  const [query, setQuery] = useState('')
  // A registration the overview asked to open (deep-link from "recent registrations"); the
  // registrations surface seeds its selection from it. Cleared on every other navigation so it never
  // re-selects a stale row when the surface remounts.
  const [selectId, setSelectId] = useState<number | null>(null)

  // `redirect: 'manual'` so an Access login redirect surfaces as an opaque-redirect response
  // (status 0) instead of being transparently followed cross-origin — see isAuthRedirect.
  const client = useMemo(
    () =>
      hc<AppType>(location.origin, {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, redirect: 'manual' })
      }),
    []
  )

  // The draw show's two server seams (read one competition's reveal, advance its cursor), kept out of the
  // shell (issue #71). Pure playback (ADR-0003): the read is already cursor-sliced server-side.
  const { loadReveal, advanceReveal } = useReveal(client)

  const load = useCallback(async () => {
    try {
      const res = await client.api.admin.list.$get()
      if (isAuthRedirect(res)) return location.reload()
      if (!res.ok) {
        toast.error('Konnte nicht laden.')
        setReady(true)
        return
      }
      const data = await res.json()
      setRegistrations(data.registrations)
      setEverLoaded(true)
      setReady(true)
      // The drawn brackets (competitions surface), the phase (stepper), and the debug-reset capability
      // (RESET_ENABLED, ADR-0029) are best-effort reads independent of the list — fetch them together and
      // let any one fail without taking down the admin: a rejected read keeps that slice's last known
      // value (allSettled never rejects), so a blip never blanks the stepper or hides a drawn field.
      await Promise.allSettled([
        client.api.admin.draws.$get().then(async r => r.ok && setDraws((await r.json()).draws)),
        client.api.phase.$get().then(async r => r.ok && setPhase((await r.json()).phase)),
        client.api.admin.reset.$get().then(async r => r.ok && setResetEnabled((await r.json()).enabled))
      ])
    } catch {
      toast.error('Konnte nicht laden.')
      setReady(true)
    }
  }, [client])

  useEffect(() => {
    load()
  }, [load])

  // Wrap a mutation: run it, force a full reload on an Access redirect (re-runs the login), toast its
  // error, else reload the list — toasting success only when given a message. Resolves to whether the
  // action succeeded, so callers can advance/close UI only on success (and not on a rejected save). A
  // `null` success is the deliberate silence for routine, self-evident edits (place/move/remove a match,
  // #139) where the grid already shows the result; errors still always toast.
  const mutate = useCallback(
    async (run: () => Promise<Response>, success: string | null): Promise<boolean> => {
      try {
        const res = await run()
        if (isAuthRedirect(res)) {
          location.reload()
          return false
        }
        if (!res.ok) {
          toast.error(await errorMessage(res))
          return false
        }
        if (success) toast.success(success)
        await load()
        return true
      } catch {
        toast.error('Aktion fehlgeschlagen.')
        return false
      }
    },
    [load]
  )

  // The schedule write seams (ADR-0041, ADR-0005), kept out of the shell like useReveal: place/move plus the
  // published flag and the publish/reset actions, each routed through `mutate` for the shared behaviour.
  const { placeMatch, published, publishSchedule, resetSchedule } = useSchedule(client, mutate)

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

  // Resolves to whether the save succeeded, so the surface auto-advances only on success and
  // keeps the operator on a rejected row (their edits intact) instead of skipping ahead.
  const confirm = useCallback(
    async (id: number, payload: ConfirmPayload): Promise<boolean> => {
      try {
        const res = await client.api.admin.confirm.$post({ json: { id, ...payload } })
        if (isAuthRedirect(res)) {
          location.reload()
          return false
        }
        if (!res.ok) {
          toast.error(await errorMessage(res))
          return false
        }
        const data = await res.json()
        toast.success(data.lkFetched ? `Gespeichert · LK ${data.lkFetched} geholt.` : 'Gespeichert.')
        await load()
        return true
      } catch {
        toast.error('Fehler beim Speichern.')
        return false
      }
    },
    [client, load]
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

  // The draw seams (ADR-0025, ADR-0004), kept out of the shell like useResults: „Jetzt auslosen" (which on
  // success hands off to the beamer show) and „Nebenrunde auslosen" (published directly). Each owns its
  // pending flag; both ride the shared `mutate`, so the success reload re-fetches the drawn brackets.
  const { drawCompetition, drawingCompetition, drawConsolation, drawingConsolation } = useDraw(
    client,
    mutate,
    setShowCompetition
  )

  const refreshLk = useCallback(async () => {
    toast('Aktualisiere LK aus nuLiga …')
    await mutate(() => client.api.admin['refresh-lk'].$post(), 'LK aktualisiert.')
  }, [client, mutate])

  // The result-entry seams (ADR-0032, ADR-0026), kept out of the shell like useSchedule/useReveal: the live
  // status transition (with the actual court) and the result write that advances the bracket. Both ride the
  // shared `mutate`, so the success reload re-fetches the draws and the bracket reflects the new result.
  const { recordResult, setMatchStatus } = useResults(client, mutate)

  // The debug-only reset levers (ADR-0029): all three go through mutate, so they share the
  // 401-regate/error/toast behaviour, and the success reload re-fetches draws + phase so the UI
  // reflects the teardown. The surface owns the confirmation dialogs; these just perform the request.
  const undraw = useCallback(
    (competition: CompetitionSlug) =>
      mutate(() => client.api.admin.reset.undraw.$post({ json: { competition } }), 'Auslosung zurückgesetzt.'),
    [client, mutate]
  )
  const readmit = useCallback(
    () => mutate(() => client.api.admin.reset.readmit.$post(), 'Spieler neu zugelassen.'),
    [client, mutate]
  )
  const backToSignup = useCallback(
    () => mutate(() => client.api.admin.reset['back-to-signup'].$post(), 'Zurück zur Anmeldung.'),
    [client, mutate]
  )

  // The overview's "new — to confirm" call-to-action: open registrations pre-filtered to the
  // "new" queue so the operator starts triage in one click (ADR-0019).
  const goToNew = useCallback(() => {
    setSelectId(null)
    setFilter('new')
    setSurface('registrations')
  }, [])

  // A competition row in the overview opens registrations scoped to that field, all statuses — "show
  // me this competition" (ADR-0019). The filter lives in the shell, so it survives the surface switch.
  const goToCompetition = useCallback((slug: CompetitionSlug) => {
    setSelectId(null)
    setCompetitionFilter(slug)
    setFilter('all')
    setSurface('registrations')
  }, [])

  // Deep-link from "recent registrations" to one player's detail: drop all filters so the row is
  // visible whatever its status/competition, then open the registrations surface on it (ADR-0023).
  const goToRegistration = useCallback((reg: AdminRegistration) => {
    setSelectId(reg.id)
    setFilter('all')
    setCompetitionFilter('all')
    setQuery('')
    setSurface('registrations')
  }, [])

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
        <Toaster />
      </main>
    )
  }

  // The large-screen draw show takes over the whole viewport (issue #71): a beamer projection has no
  // place for the sidebar/stepper chrome, so it renders instead of the admin shell. Exiting re-reads the
  // list so the competitions surface reflects the cursor the operator advanced to. The Toaster rides
  // along so an advance error still surfaces over the show.
  if (showCompetition) {
    return (
      <>
        <DrawShow
          competition={showCompetition}
          onLoad={loadReveal}
          onAdvance={advanceReveal}
          onExit={() => {
            setShowCompetition(null)
            void load()
          }}
        />
        <Toaster />
      </>
    )
  }

  // The "new" queue size drives the sidebar badge (ADR-0023) — the ambient signal that replaced the
  // overview's old call-to-action block.
  const newCount = registrations.filter(r => r.status === 'new').length

  return (
    // h-svh + overflow-hidden turns the shell into a fixed-height app frame: the header stays put
    // and each surface scrolls inside its own region (the registrations queue and detail panel keep
    // their action bars pinned) rather than the whole page scrolling.
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar
        active={surface}
        onSelect={s => {
          setSelectId(null)
          setSurface(s)
        }}
        newCount={newCount}
        showDebug={resetEnabled}
      />
      <SidebarInset className="min-h-0 overflow-hidden">
        {/* The phase stepper sits above every surface (ADR-0019). Non-sticky so the registrations
            filter bar below can pin to the top while a long list scrolls, as it did before. The
            trigger stays hard-left; the stepper is centered in the remaining width (ADR-0023). */}
        <header className="bg-background flex items-center gap-2 border-b px-4 py-3">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 !h-5" />
          <div className="flex flex-1 justify-center">
            <PhaseStepper phase={phase} onChange={changePhase} />
          </div>
        </header>
        {surface === 'overview' ? (
          <OverviewSurface
            registrations={registrations}
            onGoToNew={goToNew}
            onGoToCompetition={goToCompetition}
            onOpenRegistration={goToRegistration}
          />
        ) : surface === 'seeding' ? (
          <SeedingSurface registrations={registrations} />
        ) : surface === 'competitions' ? (
          <CompetitionsSurface
            registrations={registrations}
            draws={draws}
            phase={phase}
            onDraw={drawCompetition}
            drawingCompetition={drawingCompetition}
            onStartShow={setShowCompetition}
            onDrawConsolation={drawConsolation}
            drawingConsolation={drawingConsolation}
          />
        ) : surface === 'schedule' ? (
          <ScheduleSurface
            registrations={registrations}
            draws={draws}
            published={published}
            onPlace={placeMatch}
            onPublish={publishSchedule}
            onReset={resetSchedule}
          />
        ) : surface === 'results' ? (
          <ResultsSurface
            registrations={registrations}
            draws={draws}
            onRecordResult={recordResult}
            onSetStatus={setMatchStatus}
          />
        ) : surface === 'debug' && resetEnabled ? (
          <DebugSurface draws={draws} onUndraw={undraw} onReadmit={readmit} onBackToSignup={backToSignup} />
        ) : (
          <RegistrationsSurface
            registrations={registrations}
            selectId={selectId}
            filter={filter}
            onFilterChange={setFilter}
            competitionFilter={competitionFilter}
            onCompetitionFilterChange={setCompetitionFilter}
            query={query}
            onQueryChange={setQuery}
            onConfirm={confirm}
            onCancel={cancel}
            onDelete={remove}
            onRefreshLk={refreshLk}
          />
        )}
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  )
}
