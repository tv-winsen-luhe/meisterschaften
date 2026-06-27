import { type AdminRegistration } from '../../../shared'
import { cn } from '@/admin/lib/utils'
import { formatRelative } from '@/admin/lib/format'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/admin/ui/table'
import { CLUB_LOGOS, competitionLabel, STATUS_META } from './registration-detail'

interface RecentSignupsProps {
  registrations: AdminRegistration[]
  // Open one registration's detail (clicking a row).
  onOpen: (reg: AdminRegistration) => void
}

// "Letzte Anmeldungen" (ADR-0023): the five most recent signups by createdAt — the only cron-safe
// timestamp (updatedAt is bumped by the LK sync, so it can't date a confirm or cancel). Each row
// carries its current status dot, so a recently-cancelled signup still surfaces. Rows are clickable
// and deep-link into the Anmeldungen detail of that player.
export const RecentSignups = ({ registrations, onOpen }: RecentSignupsProps) => {
  const recent = [...registrations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-muted-foreground text-xs font-semibold tracking-[0.08em] uppercase">Letzte Anmeldungen</h2>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Konkurrenz</TableHead>
              <TableHead>Verein</TableHead>
              <TableHead className="text-right">LK</TableHead>
              <TableHead className="text-right">Angemeldet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map(r => (
              <TableRow
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(r)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpen(r)
                  }
                }}
                className="cursor-pointer"
                title={`${r.firstName} ${r.lastName} öffnen`}
              >
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn('size-2 shrink-0 rounded-full', STATUS_META[r.status].dot)}
                      aria-label={STATUS_META[r.status].label}
                    />
                    <span
                      className={cn('font-medium', r.status === 'cancelled' && 'text-muted-foreground line-through')}
                    >
                      {r.firstName} {r.lastName}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{competitionLabel(r.competition)}</TableCell>
                <TableCell>
                  <img
                    src={CLUB_LOGOS[r.club]}
                    alt={r.club}
                    title={r.club}
                    className="size-4 object-contain"
                    width={16}
                    height={16}
                  />
                </TableCell>
                <TableCell className="text-muted-foreground text-right tabular-nums">{r.lk ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                  {formatRelative(r.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
