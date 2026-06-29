import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDays, X } from 'lucide-react'
import {
  absoluteSlot,
  type AdminRegistration,
  type CompetitionDraw,
  COURT_NUMBERS,
  DAY_INDICES,
  earliestPlaceableSlot,
  type Match,
  type Placement,
  resolveBracket,
  type SoftViolation,
  SLOT_INDICES,
  slotLabel,
  type SlotView,
  slotTime,
  validatePlacement
} from '../../../shared'
import { tournament } from '@/data/tournament'
import { cn } from '@/admin/lib/utils'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { competitionLabel } from './registration-detail'
import { type GridMatch, MatchCard, type SlotLabel } from './schedule-match-card'
import { hardBlockMessage, SoftWarningDialog } from './schedule-warnings'

// The schedule surface (UI: „Spielplan", ADR-0005, issue #88): the operator places drawn matches onto a
// courts × time grid, spanning both event days. A tracer bullet — placement only, no validation yet
// (#89). Interaction is select-then-place rather than drag-and-drop: tap a match (in the backlog or on
// the grid) to pick it up, then tap a cell to drop it; the rich drag affordance can layer on later.

// The two event days, labelled from the home of the date copy (src/data/tournament.ts).
const DAYS = [tournament.saturday, tournament.sunday]

interface ScheduleSurfaceProps {
  registrations: AdminRegistration[]
  draws: CompetitionDraw[]
  // Place a match into a cell, move it, or clear it back to the backlog (null). Resolves to whether the
  // write succeeded (the shell toasts + reloads); the surface reflects the new state on the reload.
  onPlace: (id: number, placement: Placement | null) => Promise<boolean>
}

// A drop the operator must confirm: a sound-but-unwise placement (soft warnings only). Held until the
// operator overrides or cancels (ADR-0033 — the operator is the authority on player load).
interface PendingDrop {
  id: number
  placement: Placement
  soft: SoftViolation[]
}

export const ScheduleSurface = ({ registrations, draws, onPlace }: ScheduleSurfaceProps) => {
  // The match the operator has picked up, waiting for a cell (or a second tap to drop it). Cleared on a
  // successful place.
  const [selected, setSelected] = useState<number | null>(null)
  // A drop awaiting the operator's confirmation past its soft warnings (null ⇒ none pending).
  const [pending, setPending] = useState<PendingDrop | null>(null)

  // Every match across every drawn field, with its current placement — what `validatePlacement` reads
  // to judge a drop (court cap spans all fields; round dependency is per bracket). The wire `Match`
  // structurally satisfies the validator's input, so no mapping is needed.
  const allMatches = useMemo<Match[]>(() => draws.flatMap(d => d.matches), [draws])

  const nameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const r of registrations) map.set(r.id, `${r.firstName} ${r.lastName}`.trim())
    return map
  }, [registrations])

  // The schedulable matches: a main bracket's real matches (a bye is auto-resolved, never played, so it
  // is never schedulable). An un-revealed bracket's *unplaced* matches stay hidden — projecting the
  // admin must not spoil a draw still being revealed — but a *placed* match is always shown even if its
  // reveal was later rewound, so the operator can still move or unplace it (the public feed withholds it
  // again while the bracket is rewound, ADR-0036 — but the operator must still be able to manage it).
  // Feeders are resolved per bracket so „Sieger M3" reads stable.
  const gridMatches = useMemo<GridMatch[]>(() => {
    // The slot label: a player's name (the grid's own regId→name join, with a `#id` fallback), or the
    // shared German copy for every undecided slot. The unresolved flag is derivable from the kind —
    // `unknown` is the only unresolved („offen") slot — so it tags the same label, rather than repeating
    // `unresolved: false` on every other branch.
    const slotText = (view: SlotView): SlotLabel => {
      const text = view.kind === 'player' ? (nameById.get(view.regId) ?? `#${view.regId}`) : slotLabel(view)
      return { text, unresolved: view.kind === 'unknown' }
    }

    const out: GridMatch[] = []
    for (const draw of draws) {
      if (draw.bracket !== 'main') continue
      const revealed = draw.cursor >= draw.total
      // Number + resolve the whole bracket through the shared resolver — the same pipeline the public
      // feed reads (#109) — then drop byes and, while unrevealed, any still-unplaced match.
      for (const { match, number, slot1, slot2 } of resolveBracket(draw.matches)) {
        if (match.outcome === 'bye') continue
        if (!revealed && match.court === null) continue
        out.push({
          match,
          number,
          competition: draw.competition,
          competitionLabel: competitionLabel(draw.competition),
          slot1: slotText(slot1),
          slot2: slotText(slot2)
        })
      }
    }
    return out
  }, [draws, nameById])

  const selectedEarliest = useMemo(() => {
    if (selected === null) return 0
    const m = allMatches.find(x => x.id === selected)
    if (!m) return 0
    return earliestPlaceableSlot(m, allMatches)
  }, [selected, allMatches])

  const backlog = gridMatches.filter(g => g.match.court === null)
  const placedByCell = useMemo(() => {
    const map = new Map<string, GridMatch>()
    for (const g of gridMatches) {
      if (g.match.court !== null && g.match.day !== null && g.match.slot !== null) {
        map.set(`${g.match.day}-${g.match.slot}-${g.match.court}`, g)
      }
    }
    return map
  }, [gridMatches])

  const place = async (id: number, placement: Placement | null) => {
    const ok = await onPlace(id, placement)
    if (ok) {
      setSelected(null)
      setPending(null)
    }
  }

  // Drop the in-hand match into a cell, gated by the shared validator (ADR-0033). A hard violation
  // blocks the drop (the match stays in hand); soft warnings open a confirm dialog the operator can
  // override; a clean placement goes straight through. Clearing to the backlog never runs this path.
  const dropInto = (placement: Placement) => {
    if (selected === null) return
    const { hard, soft } = validatePlacement(allMatches, { id: selected, placement })
    if (hard.length > 0) {
      toast.error(hardBlockMessage(hard))
      return
    }
    if (soft.length > 0) {
      setPending({ id: selected, placement, soft })
      return
    }
    void place(selected, placement)
  }

  const onCellClick = (day: number, slot: number, court: number) => {
    const cell = placedByCell.get(`${day}-${slot}-${court}`)
    if (cell) {
      // Tapping an occupied cell picks that match up to move it (a second tap on its own cell deselects).
      setSelected(prev => (prev === cell.match.id ? null : cell.match.id))
    } else if (selected !== null) {
      // An empty cell with a match in hand: drop it here.
      dropInto({ court, day, slot })
    }
  }

  if (gridMatches.length === 0) {
    return (
      <Empty className="m-5 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDays />
          </EmptyMedia>
          <EmptyTitle>Noch kein Spielplan</EmptyTitle>
          <EmptyDescription>
            Sobald eine Konkurrenz ausgelost ist, erscheinen ihre Matches hier und lassen sich auf Plätze und Zeiten
            verteilen.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="flex w-full flex-col gap-5">
        <p className="text-muted-foreground text-sm">
          {selected !== null
            ? 'Match aufgenommen — tippe eine freie Zelle, um es zu platzieren.'
            : 'Match wählen (unten oder im Raster), dann eine Zelle antippen.'}
        </p>

        <Backlog
          matches={backlog}
          selected={selected}
          onSelect={id => setSelected(prev => (prev === id ? null : id))}
        />

        {DAY_INDICES.map(day => (
          <DayGrid
            key={day}
            day={day}
            label={`${DAYS[day]?.weekday ?? `Tag ${day + 1}`} · ${DAYS[day]?.short ?? ''}`}
            placedByCell={placedByCell}
            selected={selected}
            selectedEarliest={selectedEarliest}
            onCellClick={onCellClick}
            onUnplace={id => void place(id, null)}
          />
        ))}
      </div>

      <SoftWarningDialog
        soft={pending?.soft ?? null}
        onConfirm={() => pending && void place(pending.id, pending.placement)}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}

interface BacklogProps {
  matches: GridMatch[]
  selected: number | null
  onSelect: (id: number) => void
}
// The unplaced matches, waiting to be scheduled. Empty once everything is on the grid.
const Backlog = ({ matches, selected, onSelect }: BacklogProps) => (
  <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
    <div className="flex items-center justify-between">
      <span className="font-semibold">Nicht geplant</span>
      <span className="text-muted-foreground text-sm tabular-nums">{matches.length}</span>
    </div>
    {matches.length === 0 ? (
      <p className="text-muted-foreground text-sm">Alle Matches sind verteilt.</p>
    ) : (
      <div className="flex flex-wrap gap-2">
        {matches.map(g => (
          <button
            key={g.match.id}
            type="button"
            onClick={() => onSelect(g.match.id)}
            className={cn(
              'w-52 rounded-lg border p-2 text-left transition-colors',
              selected === g.match.id
                ? 'border-foreground bg-foreground/5 ring-foreground/20 ring-2'
                : 'hover:bg-muted/50'
            )}
          >
            <MatchCard match={g} />
          </button>
        ))}
      </div>
    )}
  </section>
)

interface DayGridProps {
  day: number
  label: string
  placedByCell: Map<string, GridMatch>
  selected: number | null
  selectedEarliest: number
  onCellClick: (day: number, slot: number, court: number) => void
  onUnplace: (id: number) => void
}
// One day's courts × time grid: a row per slot (its „ca." time), a column per court.
const DayGrid = ({ day, label, placedByCell, selected, selectedEarliest, onCellClick, onUnplace }: DayGridProps) => (
  <section className="bg-card flex flex-col gap-3 rounded-xl border p-4">
    <span className="font-semibold">{label}</span>
    <div className="overflow-x-auto">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `auto repeat(${COURT_NUMBERS.length}, minmax(13rem, 1fr))` }}
      >
        {/* Header row: an empty corner, then the court labels. */}
        <div />
        {COURT_NUMBERS.map(court => (
          <div key={court} className="text-muted-foreground px-2 pb-1 text-center text-xs font-semibold">
            Platz {court}
          </div>
        ))}

        {SLOT_INDICES.map(slot => (
          <div key={slot} className="contents">
            <div className="text-muted-foreground flex items-center justify-end pr-2 text-xs font-semibold tabular-nums">
              ca. {slotTime(slot)}
            </div>
            {COURT_NUMBERS.map(court => {
              const cell = placedByCell.get(`${day}-${slot}-${court}`)
              const isSelected = cell !== undefined && cell.match.id === selected
              const abs = absoluteSlot(day, slot)
              const tooEarly = selected !== null && cell === undefined && abs < selectedEarliest
              const isDropTarget = cell === undefined && selected !== null && !tooEarly
              return (
                <button
                  key={court}
                  type="button"
                  onClick={() => onCellClick(day, slot, court)}
                  disabled={(cell === undefined && selected === null) || tooEarly}
                  className={cn(
                    'relative min-h-16 rounded-md border p-1.5 text-left transition-colors',
                    cell ? 'bg-background' : 'border-dashed',
                    isSelected && 'border-foreground ring-foreground/20 ring-2',
                    tooEarly && 'cursor-not-allowed opacity-40',
                    isDropTarget && 'border-foreground/40 bg-foreground/5 hover:bg-foreground/10',
                    cell === undefined && selected === null && 'cursor-default'
                  )}
                >
                  {cell ? (
                    <>
                      <MatchCard match={cell} />
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="Aus dem Plan nehmen"
                        onClick={e => {
                          e.stopPropagation()
                          onUnplace(cell.match.id)
                        }}
                        className="text-muted-foreground hover:bg-muted hover:text-foreground absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded"
                      >
                        <X className="size-3.5" />
                      </span>
                    </>
                  ) : null}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  </section>
)
