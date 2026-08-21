import { useMemo, useState } from 'react'
import { Trophy } from 'lucide-react'
import {
  type AdminRegistration,
  type CompetitionDraw,
  type CompetitionSlug,
  type EnteredOutcome,
  isFullyRevealed,
  type MatchScore,
  type MatchStatus
} from '../../../shared'
import { Button } from '@/admin/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/admin/ui/empty'
import { competitions, tournament } from '@/data/tournament'
import { competitionLabel } from './registration-detail'
import { MatchRow } from './result-match-row'
import {
  courtSections,
  type Grouping,
  matchGroups,
  metaParts,
  type ResultMatch,
  type ResultsCopy,
  resultRows
} from './results-grouping'
import { ResultDrawer } from './result-drawer'
import type { SetWrite } from './result-save'

// The Ergebnisse surface (UI: „Ergebnisse", ADR-0032, issue #90): the operator's result workbench. It is
// phone-first — one operator at the desk (ADR-0001) — so it reads as a round-grouped list, not a wide
// bracket tree: per competition, every real match (a bye is auto-resolved, never played) with its two
// players (or „Sieger M{n}" / „Verlierer M{n}" feeders until they resolve), its status, court, and score.
// Entering a result advances the winner into the next round and routes a semifinal loser to the third-place
// playoff (the pure transform server-side), so the list itself *is* the per-competition bracket filling in.
//
// It carries two readings of the same rows (ADR-0077): grouped by **Runde** — per field, the default — or by
// **Platz**, which goes event-wide (a court holds matches from every field, so „was läuft auf Platz 3" has
// no per-competition answer) and hides the field tabs to say the dimension changed. Both print a **plain**
// clock time: the public „ca." hedge states what can still move a start, and the operator is what moves it.
// The grouping and the two meta lines are pure, in results-grouping.ts.

// The result the drawer hands back: the winning slot, the outcome (null ⇒ a normal scored result), and the
// fixed best-of-2 + MTB score. The shell posts it to /api/admin/match/result.
export interface ResultPayload {
  winner: 1 | 2
  outcome: EnteredOutcome | null
  score: MatchScore
}

interface ResultsSurfaceProps {
  registrations: AdminRegistration[]
  draws: CompetitionDraw[]
  // Record (or correct) a completed result — the winner advances, a semifinal loser drops to the third-place
  // playoff, a winner change cascade-clears downstream. Resolves to whether it persisted (the drawer closes
  // only on success). Mark a match läuft / beendet, capturing the actual court. Both via the shell's mutate.
  onRecordResult: (id: number, payload: ResultPayload) => Promise<boolean>
  onSetStatus: (id: number, status: MatchStatus, liveCourt?: number) => Promise<boolean>
  // Save a running match's interim score (ADR-0032, Amendment 2026-08-20): one /set call per changed set,
  // no winner, no advancement, no status move.
  onSaveSets: (id: number, writes: SetWrite[]) => Promise<boolean>
}

// Both players known ⇒ a result can be entered. The row shape itself lives with the grouping it feeds, so
// that module and its tests never import a component to get at a type; re-exported because result-drawer.tsx
// has always taken it from here.
export type { ResultMatch }

// The German the meta lines need, from the copy's home — the days for „Sa 14:00", the fields for the court
// view's required competition part.
const COPY: ResultsCopy = { days: [tournament.saturday, tournament.sunday], competitions }

// The picker's two labels. Spelled out rather than derived from the `Grouping` union, because the union is
// English wire vocabulary and these are German UI copy — the two must be free to diverge (ADR-0028).
const GROUPING_LABELS: Record<Grouping, string> = { round: 'Runde', court: 'Platz' }

export const ResultsSurface = ({
  registrations,
  draws,
  onRecordResult,
  onSetStatus,
  onSaveSets
}: ResultsSurfaceProps) => {
  const nameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const r of registrations) map.set(r.id, `${r.firstName} ${r.lastName}`.trim())
    return map
  }, [registrations])

  // Only fully-revealed main brackets carry results (a draw still being revealed must not show its pairings
  // here — the same suspense discipline the competitions surface keeps, ADR-0036). The consolation bracket
  // has no reveal show, so it would appear once it exists (#92).
  const fields = useMemo(() => draws.filter(d => d.bracket === 'main' && isFullyRevealed(d)), [draws])

  const [active, setActive] = useState<CompetitionSlug | null>(null)
  // Which reading is on screen. „Runde" is the status quo, so it is the default, and it is plain component
  // state: a stored preference is a thing to be wrong about across two event days and two devices, and
  // deriving it from the phase would infer the operator's intent (ADR-0027, ADR-0077 rule 4).
  const [grouping, setGrouping] = useState<Grouping>('round')
  // The match whose result drawer is open (null ⇒ closed).
  const [editing, setEditing] = useState<ResultMatch | null>(null)

  // The selected field, defaulting to the first one — held as a fallback so a freshly-drawn field shows
  // without the operator picking it, while an explicit pick still wins.
  const selected = fields.find(f => f.competition === active) ?? fields[0] ?? null

  // The selected competition's consolation bracket, once it is drawn (ADR-0004) — its matches record like
  // the main bracket's, appended below them under „Nebenrunde · …" headings.
  const consolation = useMemo(
    () =>
      selected
        ? (draws.find(d => d.competition === selected.competition && d.bracket === 'consolation') ?? null)
        : null,
    [draws, selected]
  )

  // The selected competition's result rows: the main bracket, then the consolation bracket, each resolved
  // + numbered over its own set and round-grouped (the third-place playoff last under its own heading).
  const groups = useMemo(
    () => (selected ? [...matchGroups(selected), ...(consolation ? matchGroups(consolation) : [])] : []),
    [selected, consolation]
  )

  // The court view's rows: **every** field's, because a court holds matches from all of them. Gated the way
  // the Spielplan surface gates the grid it places them on (`bracket !== 'main' || isFullyRevealed`) — one
  // predicate, and the same population as the surface that creates the placements this view displays.
  const sections = useMemo(
    () => courtSections(draws.filter(d => d.bracket !== 'main' || isFullyRevealed(d)).flatMap(resultRows), COPY),
    [draws]
  )

  if (fields.length === 0) {
    return (
      <Empty className="m-5 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Trophy />
          </EmptyMedia>
          <EmptyTitle>Noch keine Ergebnisse</EmptyTitle>
          <EmptyDescription>
            Sobald eine Konkurrenz ausgelost und enthüllt ist, erscheinen ihre Matches hier — zum Starten („läuft") und
            zum Eintragen der Ergebnisse.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        {/* The grouping picker — the same rows, one different axis. */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Gruppierung</span>
          {(['round', 'court'] as const).map(g => (
            <Button key={g} size="sm" variant={g === grouping ? 'default' : 'outline'} onClick={() => setGrouping(g)}>
              {GROUPING_LABELS[g]}
            </Button>
          ))}
        </div>

        {/* The field picker — one tab per drawn field. Hidden when only one field is drawn, and hidden in the
            court view: that reading is event-wide, and a court has no per-field answer, so the tabs going
            away is how the surface says the dimension changed (ADR-0077 rule 5). */}
        {grouping === 'round' && fields.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {fields.map(f => (
              <Button
                key={f.competition}
                size="sm"
                variant={f.competition === selected?.competition ? 'default' : 'outline'}
                onClick={() => setActive(f.competition)}
              >
                {competitionLabel(f.competition)}
              </Button>
            ))}
          </div>
        )}

        {grouping === 'round' && selected && (
          <div className="flex flex-col gap-6">
            {groups.map(([label, rows]) => (
              <section key={label} className="flex flex-col gap-2">
                <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{label}</h2>
                <div className="flex flex-col gap-2">
                  {rows.map(row => (
                    <MatchRow
                      key={row.match.id}
                      row={row}
                      meta={metaParts(row, grouping, COPY)}
                      nameById={nameById}
                      onOpen={() => setEditing(row)}
                      onSetStatus={onSetStatus}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* The court view: day → court → chronological, the public page's fixed hierarchy, so the operator
            and the grounds read the same shape. Empty courts and days are already gone from `sections`. */}
        {grouping === 'court' && (
          <div className="flex flex-col gap-8">
            {sections.map(day => (
              <section key={day.label} className="flex flex-col gap-4">
                <h2 className="border-b pb-1 text-sm font-semibold">{day.label}</h2>
                {day.courts.map(court => (
                  <div key={court.label ?? 'backlog'} className="flex flex-col gap-2">
                    {/* The court heading carries full ink, not the round heading's muted whisper: it is the
                        level the operator scans down, and ADR-0075 rule 1 is the record of what a quiet
                        court heading costs. It stays a rank below the day by size, not by colour. */}
                    {court.label && <h3 className="text-xs font-semibold tracking-wide uppercase">{court.label}</h3>}
                    {court.rows.map(row => (
                      <MatchRow
                        key={row.match.id}
                        row={row}
                        meta={metaParts(row, grouping, COPY)}
                        nameById={nameById}
                        onOpen={() => setEditing(row)}
                        onSetStatus={onSetStatus}
                      />
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>

      <ResultDrawer
        editing={editing}
        nameById={nameById}
        onClose={() => setEditing(null)}
        onSubmit={async (id, payload) => {
          const ok = await onRecordResult(id, payload)
          if (ok) setEditing(null)
          return ok
        }}
        onSaveSets={async (id, writes) => {
          const ok = await onSaveSets(id, writes)
          if (ok) setEditing(null)
          return ok
        }}
      />
    </div>
  )
}
