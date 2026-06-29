import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDays, Sparkles } from 'lucide-react'
import {
  type AdminRegistration,
  type CompetitionDraw,
  DAY_INDICES,
  earliestPlaceableSlot,
  type Match,
  type Placement,
  resolveBracket,
  type SchedulableMatch,
  type SoftViolation,
  slotLabel,
  type SlotView,
  suggestSchedule,
  validatePlacement
} from '../../../shared'
import { tournament } from '@/data/tournament'
import { Button } from '@/admin/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { competitionLabel } from './registration-detail'
import { Backlog, DayGrid } from './schedule-grid-parts'
import { type GridMatch, type SlotLabel } from './schedule-match-card'
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

  const [suggesting, setSuggesting] = useState(false)

  const suggest = async () => {
    setSuggesting(true)
    try {
      const mainMatches = allMatches.filter(m => m.bracket === 'main') as SchedulableMatch[]
      const suggestions = suggestSchedule(mainMatches)
      if (suggestions.length === 0) {
        toast.info('Keine Matches zum Platzieren.')
        return
      }
      let placed = 0
      for (const s of suggestions) {
        const ok = await onPlace(s.id, s.placement)
        if (!ok) break
        placed++
      }
      setSelected(null)
      if (placed === suggestions.length) {
        toast.success(`${placed} Matches vorgeschlagen.`)
      } else {
        toast.warning(`${placed} von ${suggestions.length} Matches platziert.`)
      }
    } finally {
      setSuggesting(false)
    }
  }

  const onCellClick = (day: number, slot: number, court: number) => {
    if (suggesting) return
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
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            {selected !== null
              ? 'Match aufgenommen — tippe eine freie Zelle, um es zu platzieren.'
              : 'Match wählen (unten oder im Raster), dann eine Zelle antippen.'}
          </p>

          {backlog.length > 0 && (
            <Button size="sm" disabled={suggesting} onClick={suggest}>
              <Sparkles className="size-4" />
              Vorschlag
            </Button>
          )}
        </div>

        <Backlog
          matches={backlog}
          selected={selected}
          onSelect={id => {
            if (!suggesting) setSelected(prev => (prev === id ? null : id))
          }}
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
