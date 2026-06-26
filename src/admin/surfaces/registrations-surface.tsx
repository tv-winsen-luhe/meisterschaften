import { RefreshCw } from 'lucide-react'
import type { AdminRegistration } from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { Button } from '@/admin/ui/button'
import { Input } from '@/admin/ui/input'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/admin/ui/empty'
import { RegistrationCard, type ConfirmPayload } from '../registration-card'

export type StatusFilter = 'all' | AdminRegistration['status']

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

interface RegistrationsSurfaceProps {
  registrations: AdminRegistration[]
  filter: StatusFilter
  onFilterChange: (filter: StatusFilter) => void
  query: string
  onQueryChange: (query: string) => void
  onConfirm: (id: number, payload: ConfirmPayload) => void
  onCancel: (id: number) => void
  onDelete: (reg: AdminRegistration) => void
  onRefreshLk: () => void
}

// The registration workbench (ADR-0019): the stat tiles, status tabs, search, and the editable
// cards that were the whole admin before the shell. Moved here unchanged so registration
// management keeps working — the two-pane triage redesign rides in a later slice. The shell owns
// the data, the mutations, and the filter/search state (so it survives switching surfaces).
export const RegistrationsSurface = ({
  registrations,
  filter,
  onFilterChange,
  query,
  onQueryChange,
  onConfirm,
  onCancel,
  onDelete,
  onRefreshLk
}: RegistrationsSurfaceProps) => {
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

  let lastStatus: string | null = null
  const grouped = filter === 'all'

  return (
    <>
      <div className="grid grid-cols-3 gap-2 px-5 py-4 min-[721px]:grid-cols-6">
        <Tile label="Gesamt" value={registrations.length} />
        <Tile label="Neu" value={count('new')} />
        <Tile label="Bestätigt" value={confirmed.length} highlight />
        <Tile label="Herren" value={byCompetition('mens')} />
        <Tile label="Challenger" value={byCompetition('mens-challenger')} />
        <Tile label="Damen" value={byCompetition('womens')} />
      </div>
      <div className="bg-background/95 sticky top-0 z-10 border-y backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-5 py-2">
          <div className="flex flex-wrap gap-1">
            {TABS.map(s => (
              <Button
                key={s}
                size="sm"
                variant={filter === s ? 'secondary' : 'ghost'}
                onClick={() => onFilterChange(s)}
              >
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
            onChange={e => onQueryChange(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={onRefreshLk}>
            <RefreshCw />
            LK aus nuLiga
          </Button>
        </div>
      </div>
      <div className="p-5">
        {registrations.length === 0 ? (
          <Empty className="my-8 border">
            <EmptyHeader>
              <EmptyTitle>Noch keine Anmeldungen</EmptyTitle>
              <EmptyDescription>Die Liste füllt sich, sobald jemand das Formular abschickt.</EmptyDescription>
            </EmptyHeader>
          </Empty>
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
                <RegistrationCard reg={reg} onConfirm={onConfirm} onCancel={onCancel} onDelete={onDelete} />
              </div>
            )
          })
        )}
      </div>
    </>
  )
}

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
