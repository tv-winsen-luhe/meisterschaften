import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarDays } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  type AdminRegistration,
  type CompetitionDraw,
  DAY_INDICES,
  earliestPlaceableSlot,
  isUnplaced,
  type Match,
  overlapsSocialMixerBlock,
  type Placement,
  resolveSocialMixerBlock,
  type SchedulableMatch,
  type SocialMixerBlock,
  type SocialMixerPlacement,
  type SoftViolation,
  suggestSchedule,
  validatePlacement
} from '../../../shared'
import { tournament } from '@/data/tournament'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { MixerBlockDialog, ScheduleControls } from './schedule-controls'
import { type SettableStatus } from './match-actions'
import { ResultDrawer, type ResultPayload } from './result-drawer'
import type { SetWrite } from './result-save'
import { Backlog, DayGrid, DragChip } from './schedule-grid-parts'
import { gridCards, type GridMatch } from './schedule-match-card'
import { hardBlockMessage, SoftWarningDialog } from './schedule-warnings'

// The schedule surface (UI: „Spielplan", ADR-0005, issue #88): the operator places drawn matches onto a
// courts × time grid, spanning both event days. Two coexisting input gestures feed one placement path
// (ADR-0038): drag-and-drop is primary (drag a backlog card onto a cell, or drag a placed match between
// cells), and select-then-place is a first-class fallback (tap a match to pick it up, tap a cell to drop
// it) — load-bearing for the horizontally-scrolling grid, a phone during a rain delay, and keyboard
// users. Both gestures funnel through the same `validatePlacement` authority (ADR-0033), so neither can
// commit a hard-invalid placement and both surface the same soft warnings. A „Vorschlag" button auto-fills
// the backlog through the same validator (#122). The grid lives in schedule-grid-parts.tsx; this surface
// owns the state and the placement path.

// The two event days, labelled from the home of the date copy (src/data/tournament.ts).
const DAYS = [tournament.saturday, tournament.sunday]

interface ScheduleSurfaceProps {
  registrations: AdminRegistration[]
  draws: CompetitionDraw[]
  // Whether the planned schedule is currently published (ADR-0041) — drives the publish control's state.
  published: boolean
  // Place a match into a cell, move it, or clear it back to the backlog (null). Resolves to whether the
  // write succeeded; the shell reloads (and error-toasts on failure) but stays **silent on success** —
  // the grid already shows the move (#139). The surface reflects the new state on the reload.
  onPlace: (id: number, placement: Placement | null) => Promise<boolean>
  // Reveal the whole planned schedule, or wipe placements back to the backlog (both auto-handled by the
  // shell: 401-regate, one confirmation toast, reload). Reset also un-publishes (ADR-0041).
  onPublish: () => Promise<boolean>
  onReset: () => Promise<boolean>
  // The Social mixer's court block (ADR-0064): the resolved block the grid shades and the validator warns
  // against (`null` — nothing reserved — when the mixer is cancelled), the placement the dialog edits, the
  // confirmed head-count its courts follow, and the move itself.
  socialMixerBlock: SocialMixerBlock | null
  socialMixerPlacement: SocialMixerPlacement
  socialMixerConfirmed: number
  onMoveSocialMixerBlock: (placement: SocialMixerPlacement) => Promise<boolean>
  // The grid's second door into result entry (ADR-0080): the *same* three seams the Ergebnisse surface
  // holds, handed to the *same* drawer, so a result entered here is identical in every respect — the
  // legal-score gate, the Zwischenstand path, the advancement cascade. Not a second entry path; a second
  // caller of the one that exists.
  onRecordResult: (id: number, payload: ResultPayload) => Promise<boolean>
  onSetStatus: (id: number, status: SettableStatus, liveCourt?: number) => Promise<boolean>
  onSaveSets: (id: number, writes: SetWrite[]) => Promise<boolean>
}

// A drop the operator must confirm: a sound-but-unwise placement (soft warnings only). Held until the
// operator overrides or cancels (ADR-0033 — the operator is the authority on player load).
interface PendingDrop {
  id: number
  placement: Placement
  soft: SoftViolation[]
}

export const ScheduleSurface = ({
  registrations,
  draws,
  published,
  onPlace,
  onPublish,
  onReset,
  socialMixerBlock,
  socialMixerPlacement,
  socialMixerConfirmed,
  onMoveSocialMixerBlock,
  onRecordResult,
  onSetStatus,
  onSaveSets
}: ScheduleSurfaceProps) => {
  // The match the operator has picked up by *tap*, waiting for a cell (or a second tap to drop it).
  // Cleared on a successful place.
  const [selected, setSelected] = useState<number | null>(null)
  // The match currently being *dragged* (null ⇒ no drag in flight). Drives the same grid affordances as
  // a tap pickup for the duration of the gesture, then clears when the pointer is released.
  const [dragId, setDragId] = useState<number | null>(null)
  // A drop awaiting the operator's confirmation past its soft warnings (null ⇒ none pending).
  const [pending, setPending] = useState<PendingDrop | null>(null)
  // The „Vorschlag" auto-fill in flight — locks out the manual gestures while it writes (#122).
  const [suggesting, setSuggesting] = useState(false)
  // The match whose result drawer is open (null ⇒ closed). Held as an **id**, not the card object: every
  // write here reloads the draws, so a held card would be a stale copy of a match the server has just
  // moved on. The drawer is keyed on the match id, so re-deriving the card never re-seeds its form.
  const [editingId, setEditingId] = useState<number | null>(null)

  // Drag is the desktop gesture; tap stays the phone/keyboard path (ADR-0038). A small movement
  // threshold on the mouse keeps a plain click a click (so tap-to-select still fires), and a short
  // press-hold on touch lets a deliberate drag start without hijacking the grid's horizontal scroll.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  )

  // Every match across every drawn field, with its current placement — what `validatePlacement` reads
  // to judge a drop (court cap spans all fields; round dependency is per bracket). The wire `Match`
  // structurally satisfies the validator's input, so no mapping is needed.
  const allMatches = useMemo<Match[]>(() => draws.flatMap(d => d.matches), [draws])

  const nameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const r of registrations) map.set(r.id, `${r.firstName} ${r.lastName}`.trim())
    return map
  }, [registrations])

  // The cards the grid draws — the whole projection lives with the type it produces
  // (schedule-match-card.tsx), so this surface holds only the state and the placement path.
  const gridMatches = useMemo<GridMatch[]>(() => gridCards(draws, nameById), [draws, nameById])

  // The match "in hand" — picked up by tap or held mid-drag. Drives the grid's drop-target highlight and
  // the too-early greying for whichever gesture is active, so drag and tap surface the same guard.
  const inHand = selected ?? dragId

  const inHandEarliest = useMemo(() => {
    if (inHand === null) return 0
    const m = allMatches.find(x => x.id === inHand)
    if (!m) return 0
    return earliestPlaceableSlot(m, allMatches)
  }, [inHand, allMatches])

  const backlog = gridMatches.filter(g => isUnplaced(g.match))
  // Whether any match has already started or finished — escalates the reset confirm (ADR-0041): reset
  // leaves running/done matches on their court, but warns that the public plan goes dark until republished.
  const hasLiveMatches = gridMatches.some(g => g.match.status === 'running' || g.match.status === 'done')
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

  // Drop a match into a cell, gated by the shared validator (ADR-0033). A hard violation blocks the drop
  // (the match stays in hand / in place); soft warnings open a confirm dialog the operator can override;
  // a clean placement goes straight through. The single funnel for both gestures: tap a cell, or release
  // a drag over it. Clearing to the backlog never runs this path.
  const placeInto = (id: number, placement: Placement) => {
    const { hard, soft } = validatePlacement(allMatches, { id, placement }, socialMixerBlock)
    if (hard.length > 0) {
      toast.error(hardBlockMessage(hard))
      return
    }
    if (soft.length > 0) {
      setPending({ id, placement, soft })
      return
    }
    void place(id, placement)
  }

  // Auto-fill the backlog (#122): the shared planner proposes placements, then each is written through
  // the same endpoint a hand placement uses — so the suggestion can never commit a hard-invalid plan.
  const suggest = async () => {
    setSuggesting(true)
    try {
      // Every bracket's matches — suggestSchedule packs the consolation on Saturday (targetDay) and skips
      // byes itself, so the auto-fill places consolation matches too, not just the main bracket (#92).
      const suggestions = suggestSchedule(allMatches as SchedulableMatch[], socialMixerBlock)
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
      placeInto(selected, { court, day, slot })
    }
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    // A new gesture takes over: drop any tap pickup so the two paths can't both claim a match in hand.
    setSelected(null)
    setDragId(Number(active.id))
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragId(null)
    if (!over) return
    // The structural guard greys too-early cells as disabled droppables, so dnd-kit never reports one
    // here; the validator stays the authority all the same.
    const placement = over.data.current as Placement | undefined
    if (placement) placeInto(Number(active.id), placement)
  }

  // A drag abandoned without a drop — Escape, a tab switch, a window resize — fires cancel, never end, so
  // it must clear the held match too, or the grid freezes in a phantom „match in hand" state.
  const onDragCancel = () => setDragId(null)

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

  const dragged = gridMatches.find(g => g.match.id === dragId) ?? null
  // The card the drawer is open on, re-derived from the current cards rather than held — see `editingId`.
  // `GridMatch` satisfies the drawer's `DrawerMatch` structurally, so the grid builds no results row.
  const editing = gridMatches.find(g => g.match.id === editingId) ?? null

  // How many placed matches a candidate placement would put inside the block — the number the move dialog
  // states up front, so the warnings that appear afterwards are not a surprise (ADR-0064). Counted against
  // the *candidate* block, resolved at the same head-count: moving is never refused, it only warns
  // (ADR-0033).
  const affectedByBlock = (placement: SocialMixerPlacement): number => {
    const candidate = resolveSocialMixerBlock({ ...placement, confirmed: socialMixerConfirmed })
    if (!candidate) return 0
    return allMatches.filter(
      m => m.court !== null && m.day !== null && m.slot !== null && overlapsSocialMixerBlock(candidate, m as Placement)
    ).length
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex w-full flex-col gap-5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              {inHand !== null
                ? 'Match aufgenommen — auf eine freie Zelle ziehen oder eine antippen, um es zu platzieren.'
                : 'Match auf eine freie Zelle ziehen — oder antippen und dann eine Zelle wählen.'}
            </p>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {socialMixerBlock && (
                <MixerBlockDialog
                  block={socialMixerBlock}
                  placement={socialMixerPlacement}
                  confirmed={socialMixerConfirmed}
                  affectedCount={placement => affectedByBlock(placement)}
                  onMove={onMoveSocialMixerBlock}
                />
              )}
              <ScheduleControls
                published={published}
                backlogCount={backlog.length}
                suggesting={suggesting}
                hasLiveMatches={hasLiveMatches}
                onSuggest={suggest}
                onPublish={onPublish}
                onReset={onReset}
              />
            </div>
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
              inHand={inHand}
              inHandEarliest={inHandEarliest}
              socialMixerBlock={socialMixerBlock}
              onCellClick={onCellClick}
              onUnplace={id => void place(id, null)}
              onOpenResult={setEditingId}
              onSetStatus={(id, status, liveCourt) => void onSetStatus(id, status, liveCourt)}
            />
          ))}
        </div>

        {/* One drawer, two doors (ADR-0080 rule 1): the component Ergebnisse opens, on the same match,
            with the same props. The card it is handed is re-derived each render rather than held, so the
            drawer never keeps a copy of a match the server has since moved on — the form itself is keyed
            on the match id and so keeps the operator's typing across a reload, exactly as on Ergebnisse.
            A match that leaves the grid entirely (unplaced from a second device, a reveal rewound) closes
            the drawer, which is the honest end: there is no card left to have opened it. */}
        <ResultDrawer
          editing={editing}
          nameById={nameById}
          onClose={() => setEditingId(null)}
          onSubmit={async (id, payload) => {
            const ok = await onRecordResult(id, payload)
            if (ok) setEditingId(null)
            return ok
          }}
          onSaveSets={async (id, writes) => {
            const ok = await onSaveSets(id, writes)
            if (ok) setEditingId(null)
            return ok
          }}
        />

        <SoftWarningDialog
          soft={pending?.soft ?? null}
          socialMixerBlock={socialMixerBlock}
          onConfirm={() => pending && void place(pending.id, pending.placement)}
          onCancel={() => setPending(null)}
        />
      </div>

      {/* The card under the pointer while dragging — rendered detached so the grid layout doesn't shift. */}
      <DragOverlay>{dragged ? <DragChip match={dragged} /> : null}</DragOverlay>
    </DndContext>
  )
}
