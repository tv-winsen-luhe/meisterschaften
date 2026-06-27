import { useEffect, useMemo, useRef, useState } from 'react'
import { Inbox, RefreshCw } from 'lucide-react'
import { type AdminRegistration, COMPETITION_SLUGS, type CompetitionSlug } from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { Button } from '@/admin/ui/button'
import { Input } from '@/admin/ui/input'
import { NativeSelect } from '@/admin/ui/native-select'
import { ScrollArea } from '@/admin/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/admin/ui/tabs'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/admin/ui/drawer'
import { useIsMobile } from '@/admin/hooks/use-mobile'
import { nextSelection } from './auto-advance'
import { competitionLabel, RegistrationDetail, STATUS_META, type ConfirmPayload } from './registration-detail'
import { compareBy, SORT_OPTIONS, type SortKey } from './registration-sort'

export type StatusFilter = 'all' | AdminRegistration['status']
export type CompetitionFilter = 'all' | CompetitionSlug

// Filter-tab labels: the three status labels come from STATUS_META (single source), plus "Alle".
const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'Alle',
  new: STATUS_META.new.label,
  confirmed: STATUS_META.confirmed.label,
  cancelled: STATUS_META.cancelled.label
}
const TABS: StatusFilter[] = ['new', 'confirmed', 'cancelled', 'all']

// The detail panel seeds its edit state from the row and is remounted when any displayed field
// changes (selection, or a save that moves the row to confirmed) — so it always reflects the
// persisted state without an effect to sync it.
const detailKey = (reg: AdminRegistration) =>
  `${reg.id}:${reg.status}:${reg.competition}:${reg.club}:${reg.playerId}:${reg.lk}:${reg.updatedAt}`

interface RegistrationsSurfaceProps {
  registrations: AdminRegistration[]
  // A registration to open on mount (deep-link from the overview); null = default selection.
  selectId: number | null
  filter: StatusFilter
  onFilterChange: (filter: StatusFilter) => void
  competitionFilter: CompetitionFilter
  onCompetitionFilterChange: (filter: CompetitionFilter) => void
  query: string
  onQueryChange: (query: string) => void
  // The mutations resolve to whether they succeeded, so the surface advances/closes only on success.
  onConfirm: (id: number, payload: ConfirmPayload) => Promise<boolean>
  onCancel: (id: number) => Promise<boolean>
  onDelete: (reg: AdminRegistration) => Promise<boolean>
  onRefreshLk: () => void
}

// The registrations surface (ADR-0019): a two-pane triage workbench. The left pane is the filtered,
// searchable queue; the right pane is the selected registration's detail/edit panel. After a
// confirm the next entry opens automatically (nextSelection), so the operator works the "new"
// queue without re-clicking. On a narrow screen the panes collapse to one and the detail panel
// becomes a bottom drawer. The shell owns the data, the mutations, and the filter/search state (so
// they survive switching surfaces); the selection is local to this surface.
export const RegistrationsSurface = ({
  registrations,
  selectId,
  filter,
  onFilterChange,
  competitionFilter,
  onCompetitionFilterChange,
  query,
  onQueryChange,
  onConfirm,
  onCancel,
  onDelete,
  onRefreshLk
}: RegistrationsSurfaceProps) => {
  const isMobile = useIsMobile()
  // Seed from the deep-link target (the shell drops all filters first, so it is in the queue); the
  // surface remounts per navigation, so this initialiser runs fresh each time it is opened.
  const [selectedId, setSelectedId] = useState<number | null>(selectId ?? null)
  const [sort, setSort] = useState<SortKey>('date-asc')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Everything matching the competition filter + search, before the status tab is applied. The tab
  // counts are taken over this scoped set, so "new 2" with Herren selected means 2 new in Herren —
  // the counts never contradict the list. Memoised so clicking rows / toggling the drawer does not
  // re-scan the whole list on every render.
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase()
    return registrations
      .filter(r => competitionFilter === 'all' || r.competition === competitionFilter)
      .filter(
        r => !q || `${r.firstName} ${r.lastName} ${r.email} ${r.club} ${r.playerId ?? ''}`.toLowerCase().includes(q)
      )
  }, [registrations, competitionFilter, query])
  const counts = useMemo(
    () => ({
      all: scoped.length,
      new: scoped.filter(r => r.status === 'new').length,
      confirmed: scoped.filter(r => r.status === 'confirmed').length,
      cancelled: scoped.filter(r => r.status === 'cancelled').length
    }),
    [scoped]
  )
  const visible = useMemo(
    () => scoped.filter(r => filter === 'all' || r.status === filter).sort(compareBy(sort)),
    [scoped, filter, sort]
  )

  // Keep the selection valid as the queue changes (filter/search/reload): drop it when the queue
  // empties, default to the first row when the current selection has left the queue.
  useEffect(() => {
    if (visible.length === 0) {
      if (selectedId !== null) setSelectedId(null)
    } else if (!visible.some(r => r.id === selectedId)) {
      setSelectedId(visible[0].id)
    }
  }, [visible, selectedId])

  // Deep-link from the overview on a phone: open the detail drawer for the pre-selected row.
  useEffect(() => {
    if (selectId != null && isMobile) setDrawerOpen(true)
  }, [selectId, isMobile])

  // `/` focuses the search box, so the operator can filter without reaching for the mouse — unless
  // they are already typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const selected = visible.find(r => r.id === selectedId) ?? null

  const selectRow = (id: number) => {
    setSelectedId(id)
    if (isMobile) setDrawerOpen(true)
  }

  // Auto-advance: after a *successful* confirm, open the next entry (nextSelection over the queue
  // as it stood when the operator acted). A rejected save resolves false — the operator stays on
  // the row with their edits intact rather than being skipped past a still-"Neu" entry.
  const handleConfirm = async (id: number, payload: ConfirmPayload) => {
    const next = nextSelection(visible, id)
    if (!(await onConfirm(id, payload))) return
    setSelectedId(next)
    if (next === null) setDrawerOpen(false)
  }
  // Close the drawer only once the mutation actually succeeds, so a failed cancel/delete leaves the
  // panel open on the unchanged row instead of vanishing as if it had worked.
  const handleCancel = async (id: number) => {
    if (await onCancel(id)) setDrawerOpen(false)
  }
  const handleDelete = async (reg: AdminRegistration) => {
    if (await onDelete(reg)) setDrawerOpen(false)
  }

  if (registrations.length === 0) {
    return (
      <Empty className="m-5 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox />
          </EmptyMedia>
          <EmptyTitle>Noch keine Anmeldungen</EmptyTitle>
          <EmptyDescription>Die Liste füllt sich, sobald jemand das Formular abschickt.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left pane — the queue. Full width on a phone; a fixed column beside the detail on desktop. */}
      <div className="flex w-full min-w-0 flex-col md:w-[360px] md:border-r lg:w-[400px]">
        <div className="flex flex-col gap-2 border-b p-3">
          <div className="flex gap-2">
            <Input
              ref={searchRef}
              className="flex-1"
              type="search"
              placeholder="Name, E-Mail, Verein, ID …  ( / )"
              autoComplete="off"
              value={query}
              onChange={e => onQueryChange(e.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={onRefreshLk}
              title="Seeding-LK aller verknüpften Spieler holen"
            >
              <RefreshCw />
              <span className="max-[420px]:sr-only">LK</span>
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NativeSelect
              aria-label="Konkurrenz filtern"
              value={competitionFilter}
              onChange={e => onCompetitionFilterChange(e.target.value as CompetitionFilter)}
            >
              <option value="all">Alle Konkurrenzen</option>
              {COMPETITION_SLUGS.map(slug => (
                <option key={slug} value={slug}>
                  {competitionLabel(slug)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Sortierung" value={sort} onChange={e => setSort(e.target.value as SortKey)}>
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Tabs value={filter} onValueChange={v => onFilterChange(v as StatusFilter)}>
            <TabsList className="w-full">
              {TABS.map(s => (
                <TabsTrigger key={s} value={s}>
                  {STATUS_LABELS[s]}
                  <span className="text-xs font-bold opacity-60">{counts[s]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {visible.length === 0 ? (
            <p className="text-muted-foreground px-4 py-12 text-center text-sm">Keine Treffer für diesen Filter.</p>
          ) : (
            visible.map(reg => (
              <button
                key={reg.id}
                type="button"
                onClick={() => selectRow(reg.id)}
                className={cn(
                  'flex w-full items-center gap-3 border-b px-4 py-2.5 text-left transition-colors',
                  selectedId === reg.id ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <span
                  className={cn('size-2 shrink-0 rounded-full', STATUS_META[reg.status].dot)}
                  aria-label={STATUS_META[reg.status].label}
                />
                <span className="min-w-0 flex-1">
                  {/* Cancelled entries recede — struck and muted — so the active queue stands out. */}
                  <span
                    className={cn(
                      'block truncate text-sm font-medium',
                      reg.status === 'cancelled' && 'text-muted-foreground line-through'
                    )}
                  >
                    {reg.firstName} {reg.lastName}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {competitionLabel(reg.competition)}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{reg.lk ?? '—'}</span>
              </button>
            ))
          )}
        </ScrollArea>
      </div>

      {/* Right pane — the detail/edit panel (desktop). On a phone it rides in the drawer below. */}
      {!isMobile && (
        <div className="hidden min-w-0 flex-1 md:flex">
          {selected ? (
            <RegistrationDetail
              key={detailKey(selected)}
              reg={selected}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
              onDelete={handleDelete}
            />
          ) : (
            <div className="text-muted-foreground grid flex-1 place-items-center p-8 text-center text-sm">
              Eintrag in der Liste wählen.
            </div>
          )}
        </div>
      )}

      {/* Mobile: the detail panel as a bottom drawer (vaul), so triage works one-handed. */}
      {isMobile && (
        <Drawer open={drawerOpen && selected !== null} onOpenChange={setDrawerOpen}>
          <DrawerContent className="h-[80svh]">
            <DrawerTitle className="sr-only">
              {selected ? `${selected.firstName} ${selected.lastName}` : 'Anmeldung'}
            </DrawerTitle>
            <DrawerDescription className="sr-only">Anmeldung bearbeiten</DrawerDescription>
            {selected && (
              <RegistrationDetail
                key={detailKey(selected)}
                reg={selected}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                onDelete={handleDelete}
              />
            )}
          </DrawerContent>
        </Drawer>
      )}
    </div>
  )
}
