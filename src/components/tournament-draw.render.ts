import {
  bracketStructure,
  displayDrawSize,
  MIN_DRAW_ENTRIES,
  revealedBracket,
  roundLabel,
  scheduleNodeKey,
  slotLabel
} from '../../shared'
import { tournament } from '../data/tournament'
import type {
  LiveBracket,
  LiveBracketMatch,
  LiveBracketSlot,
  NodeSchedule,
  Participant,
  PlayerDisplay,
  PublicCompetitionBracket,
  PublicRevealStep
} from '../../shared'

// The public bracket's DOM layer (ADR-0046): every builder that turns bracket data into elements, split
// out of tournament-draw.astro so the component's `<script>` stays a thin fetch/state/poll controller.
// Pure and framework-free — it takes data + a render target and returns/fills DOM, holding no state of its
// own (the selected segment + the re-render trigger are passed in). The three phase renderers at the bottom
// (`renderPreview` / `renderReveal` / `renderLive`) are the module's surface; everything above is internal.

export type Entry = Participant
type Slot = { seed: number; player: Entry } | null
// PlayerDisplay (shared) is the display fields a bracket line shows — the wire contract's reveal-step
// player. A Participant is structurally assignable to it, so the preview and the reveal share one shape.

// The two members of the per-competition bracket union (ADR-0046), narrowed for the renderers below: a
// still-revealing field (cursor-sliced reveal steps) vs. a fully-revealed one (resolved live brackets).
export type RevealingBracket = Extract<PublicCompetitionBracket, { phase: 'revealing' }>
export type LiveCompetition = Extract<PublicCompetitionBracket, { phase: 'live' }>
// Which bracket a live competition's segment shows — the main KO tree or the consolation (ADR-0046).
export type Segment = 'main' | 'consolation'

// createElement + className (+ optional text) in one — the module's many small line-builders lean on it, so
// each element is one statement rather than the create/className/textContent triple repeated ~30 times.
const elem = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// Round labels, outermost → final. A bracket reads the tail for its size (16 → all four, 8 → last
// three, 4 → last two), so one ordered list covers every size and a new size needs no parallel entry
// — the round *count* is topology (log2(size)), the labels are display copy (the live-draw bracket's
// own; the schedule cards' round names are the shared `roundLabel`, shared/schedule.ts).
const ROUND_LABELS = ['Achtelfinale', 'Viertelfinale', 'Halbfinale', 'Finale']
const roundLabels = (size: number): string[] => ROUND_LABELS.slice(ROUND_LABELS.length - Math.log2(size))

// Compact day labels for the matchup court/time line („Sa"/„So"), from the event's date copy — the
// weekday's first two letters (Samstag → Sa, Sonntag → So), indexed by the wire `day` (0/1). The full
// „Samstag · 22.08." stays on /spielplan; the bracket line is tight, so a two-letter day reads cleanest.
const DAY_ABBR = [tournament.saturday, tournament.sunday].map(d => d.weekday.slice(0, 2))

// An empty „?" line — not yet drawn (a round-1 line before its reveal, or any later-round feeder).
const tbdEl = (): HTMLElement => {
  const el = elem('div', 'dm-slot dm-slot--tbd')
  const q = elem('span', 'dm-q', '?')
  q.setAttribute('aria-label', 'Wird ausgelost')
  el.append(q)
  return el
}

// A placed line: a player with their name, LK, and (if seeded) the seed badge. Shared by the
// provisional preview (always seeded), the live reveal (seeded or drawn), and the fully-revealed live
// bracket. When the wire says this field is `redacted` (ADR-0048) the public bracket does not advertise
// strength, so both the seed badge and the LK are omitted — the client renders the flag, not a slug check,
// and only the admin draw show keeps them. `state` marks a decided match's winner (navy accent) or loser
// (faded) in the live phase (ADR-0046); it is undefined during the preview/reveal, where no result exists yet.
const playerEl = (
  player: PlayerDisplay,
  seed: number | null,
  redacted: boolean,
  state?: 'winner' | 'loser'
): HTMLElement => {
  const el = elem('div', 'dm-slot dm-slot--seed')
  if (state === 'winner') el.classList.add('dm-slot--winner')
  else if (state === 'loser') el.classList.add('dm-slot--loser')

  if (seed !== null && !redacted) {
    const no = elem('span', 'dm-seedno', String(seed))
    no.title = `An ${seed} gesetzt`
    el.append(no)
  }

  el.append(elem('span', 'dm-name', `${player.firstName} ${player.lastName}`.trim()))

  if (!redacted)
    el.append(elem('span', player.lk ? 'dm-lk' : 'dm-lk dm-lk--pending', player.lk ? `LK ${player.lk}` : 'LK folgt'))

  return el
}

const slotEl = (slot: Slot, redacted: boolean): HTMLElement =>
  slot ? playerEl(slot.player, slot.seed, redacted) : tbdEl()

// An empty bye line („Freilos", §31) — the paired seed advances „ohne Spiel". Shared by the reveal (a
// revealed bye step) and the live bracket (a resolved round-1 bye slot).
const byeEl = (): HTMLElement => {
  const el = elem('div', 'dm-slot dm-slot--bye')
  el.append(elem('span', 'dm-bye', 'Freilos'))
  return el
}

// A revealed reveal step → its line element: a placed player, or an empty bye line („Freilos", §31).
const revealSlotEl = (step: PublicRevealStep | undefined, redacted: boolean): HTMLElement => {
  if (!step) return tbdEl()
  if (step.kind === 'bye') return byeEl()
  return step.player ? playerEl(step.player, step.seed, redacted) : tbdEl()
}

// A not-yet-decided later-round line in the live bracket: „Sieger M3" / „Verlierer M2" / „offen" — the
// shared `slotLabel` (ADR-0035) owns the copy, so it reads identically to the schedule feed.
const feederEl = (label: string): HTMLElement => {
  const el = elem('div', 'dm-slot dm-slot--feeder')
  el.append(elem('span', 'dm-feeder', label))
  return el
}

// Whether a slot is a decided match's winner (navy accent), its loser (faded), or neither (undecided) —
// the highlight the live bracket bolds the advancing player with (ADR-0046).
const slotState = (match: LiveBracketMatch, slot: 1 | 2): 'winner' | 'loser' | undefined =>
  match.winner === null ? undefined : match.winner === slot ? 'winner' : 'loser'

// One resolved live-bracket slot → its line element (ADR-0046). A player shows name + LK + seed (with the
// winner/loser highlight); an empty round-1 slot is „Freilos"; a feeder/loser/unknown is its shared label.
const liveSlotEl = (slot: LiveBracketSlot, state: 'winner' | 'loser' | undefined, redacted: boolean): HTMLElement => {
  if (slot.kind === 'player') return playerEl(slot, slot.seed, redacted, state)
  if (slot.kind === 'bye') return byeEl()
  return feederEl(slotLabel(slot))
}

// The matchup's court + approximate time line („Platz 3 · Sa ca. 14:00", #159) — a compact caption above
// the two slots, shown only when the schedule index carries this node. The feed already gates it (placed +
// published + revealed), so an unscheduled or withheld match never reaches here. The time carries „ca." —
// it is explicitly a plan, not a promise (ADR-0032), matching /spielplan; the day is abbreviated for the
// tight column.
const scheduleNoteEl = (entry: NodeSchedule): HTMLElement => {
  const day = DAY_ABBR[entry.day] ?? `Tag ${entry.day + 1}`
  return elem('div', 'dm-when', `Platz ${entry.court} · ${day} ca. ${entry.time}`)
}

// Render a bracket as a horizontal row of round columns and return the `.dm-tree` element. `rounds` are
// the column labels outermost → final; `cellFor(roundIndex, slotIndex)` yields each slot's element (round
// 0's slots are the first-round lines 0..size−1, round r's its 2·matchCount feeders); `noteFor(roundIndex,
// matchIndex)` the optional per-matchup court/time caption (#159), simply absent when it returns null. The
// shared shell for the preview, the reveal, and the live bracket — each decides per slot what to show. The
// caller owns the render target, so a live Hauptrunde can append the „Spiel um Platz 3" box after the tree.
const renderTree = (
  size: number,
  rounds: string[],
  cellFor: (roundIndex: number, slotIndex: number) => HTMLElement,
  noteFor?: (roundIndex: number, matchIndex: number) => HTMLElement | null
): HTMLElement => {
  const tree = elem('div', 'dm-tree')
  for (let r = 0; r < rounds.length; r++) {
    const matchCount = size / 2 ** (r + 1)
    const col = elem('div', 'dm-round')
    const label = elem('div', 'dm-round__label')
    label.append(rounds[r], elem('span', 'dm-round__count', String(matchCount)))
    col.append(label)

    const matches = elem('div', 'dm-round__matches')
    for (let m = 0; m < matchCount; m++) {
      const match = elem('div', 'dm-match')
      // The court/time caption sits ABOVE the pairing (#159), labelling the matchup from the top before its
      // two slots; preview passes no noteFor, so the line is simply absent there.
      const note = noteFor?.(r, m)
      if (note) match.append(note)
      match.append(cellFor(r, 2 * m), cellFor(r, 2 * m + 1))
      matches.append(match)
    }
    col.append(matches)
    tree.append(col)
  }
  return tree
}

// Below the draw floor (ADR-0034) there is no real field yet: show a „needs ≥4" count card, never a
// bracket. A 4-skeleton for 2–3 confirmed would look ready, but the draw can't be cast — and after
// registration closes it never will. Phase-agnostic: during signup it reads as a countdown, after
// close as „didn't reach 4".
const needFourEl = (count: number): HTMLElement => {
  const remaining = MIN_DRAW_ENTRIES - count
  const wrap = elem('div', 'dm-needfour')
  wrap.append(elem('div', 'dm-needfour__eyebrow', 'Auslosung ab vier'))

  // The signature: four marks for the draw floor — the confirmed entrants fill in, the rest stay open.
  // The field fills toward four; below that there is no draw yet (so never a bracket). The filled mark
  // echoes a seed head without claiming a seeding, so it reads from the draw's own world.
  const pips = elem('div', 'dm-needfour__pips')
  pips.setAttribute('role', 'img')
  pips.setAttribute('aria-label', `${count} von ${MIN_DRAW_ENTRIES} Plätzen belegt`)
  for (let i = 0; i < MIN_DRAW_ENTRIES; i++) pips.append(elem('span', i < count ? 'dm-pip dm-pip--filled' : 'dm-pip'))
  wrap.append(pips)

  const noun = remaining === 1 ? 'Anmeldung' : 'Anmeldungen'
  wrap.append(elem('div', 'dm-needfour__caption', `Noch ${remaining} ${noun} bis zur Auslosung.`))
  return wrap
}

// The fully-revealed live bracket (phase two, ADR-0046): one segment (main or consolation) resolved from
// the matches aggregate, winners advanced round-by-round. Renders the `.dm-tree`, joined to the schedule
// for the court/time caption (#159) — the third-place match is pulled out into its own box by the caller.
const renderLiveTree = (
  live: LiveBracket,
  bracketKind: Segment,
  competition: string,
  redacted: boolean,
  scheduleIndex: Map<string, NodeSchedule>
): HTMLElement => {
  // Index the KO matches by (round, position); the third-place match rides its own box, not the tree.
  const matchAt = new Map<string, LiveBracketMatch>()
  for (const m of live.matches) if (!m.thirdPlace) matchAt.set(`${m.round}-${m.position}`, m)
  const rounds = Array.from({ length: live.totalRounds }, (_, r) =>
    roundLabel({ bracket: bracketKind, round: r + 1, totalRounds: live.totalRounds })
  )
  return renderTree(
    live.size,
    rounds,
    (r, slotIndex) => {
      const m = matchAt.get(`${r + 1}-${Math.floor(slotIndex / 2)}`)
      if (!m) return tbdEl()
      const isSlot1 = slotIndex % 2 === 0
      return liveSlotEl(isSlot1 ? m.slot1 : m.slot2, slotState(m, isSlot1 ? 1 : 2), redacted)
    },
    (r, m) => {
      const entry = scheduleIndex.get(scheduleNodeKey(competition, bracketKind, r + 1, m))
      return entry ? scheduleNoteEl(entry) : null
    }
  )
}

// The „Spiel um Platz 3" box beneath the Hauptrunde tree (ADR-0046): the third-place match resolved like
// any other line, under its own label and (once placed) court/time caption. Fed by the two semifinal
// losers, so its slots read „Verlierer M{n}" until they resolve.
const thirdPlaceBox = (
  match: LiveBracketMatch,
  competition: string,
  redacted: boolean,
  scheduleIndex: Map<string, NodeSchedule>
): HTMLElement => {
  const box = elem('div', 'dm-third')
  box.append(elem('div', 'dm-third__label', 'Spiel um Platz 3'))

  const entry = scheduleIndex.get(scheduleNodeKey(competition, 'main', match.round, match.position))
  if (entry) box.append(scheduleNoteEl(entry))

  const pair = elem('div', 'dm-third__match')
  pair.append(
    liveSlotEl(match.slot1, slotState(match, 1), redacted),
    liveSlotEl(match.slot2, slotState(match, 2), redacted)
  )
  box.append(pair)
  return box
}

// The Hauptrunde / Nebenrunde segment control (ADR-0046) — the buttons are created once per panel, then
// re-synced on each render (so a poll never drops focus or duplicates a listener). Clicking calls `onSelect`
// (the controller switches the panel's segment + re-renders). The 3rd-place box rides under Hauptrunde, so
// there is no tab for it.
const renderSegments = (segmentsEl: HTMLElement, selected: Segment, onSelect: (segment: Segment) => void) => {
  if (segmentsEl.childElementCount === 0) {
    for (const seg of ['main', 'consolation'] as const) {
      const btn = elem('button', 'dm-seg', seg === 'main' ? 'Hauptrunde' : 'Nebenrunde') as HTMLButtonElement
      btn.type = 'button'
      btn.setAttribute('role', 'tab')
      btn.dataset.seg = seg
      btn.addEventListener('click', () => onSelect(seg))
      segmentsEl.append(btn)
    }
  }
  segmentsEl.querySelectorAll<HTMLButtonElement>('[data-seg]').forEach(btn => {
    btn.setAttribute('aria-selected', String(btn.dataset.seg === selected))
  })
}

// ── The three phase renderers (the module's surface) ──────────────────────────────────────────────

// The provisional preview (before the draw): the strongest LKs sit on their seed lines, every other
// line is „?". Pure affordance — the lot has not run. The size follows the **confirmed field**, not the
// competition capacity (ADR-0034): 7 confirmed shows an 8-bracket, not a 16, mirroring the real draw.
// displayDrawSize clamps to the supported sizes (4/8/16), so bracketStructure never throws.
export const renderPreview = (bracket: HTMLElement, players: Entry[], redacted: boolean) => {
  if (players.length < MIN_DRAW_ENTRIES) {
    bracket.innerHTML = ''
    bracket.append(needFourEl(players.length))
    return
  }
  const size = displayDrawSize(players.length)
  // One bracketStructure — the single topology source the real draw also uses (ADR-0025), so the
  // preview's seed lines and count can't drift from the draw's. Lot seeds (Nr.3/4) sit on the first
  // of their prescribed lines until the actual lot runs at the draw.
  const struct = bracketStructure(size)
  const seedPos: Record<number, number> = {}
  for (const group of struct.seedGroups) group.seeds.forEach((seed, i) => (seedPos[seed] = group.lines[i]))
  const slots: Slot[] = Array.from({ length: size }, () => null)
  // Place each seed on its line by the server-computed `seedRank` (by LK, ADR-0047), never by list
  // position: the participants feed is in list order — registration date for a Challenger field — so
  // slicing the top of it would seed the earliest registrants, not the LK-strongest (the prod bug). The
  // seed number stays hidden on a `redacted` field (playerEl) and the LK never reaches this wire.
  for (const player of players) {
    if (player.seedRank == null) continue
    const pos = seedPos[player.seedRank]
    if (pos !== undefined) slots[pos] = { seed: player.seedRank, player }
  }
  bracket.innerHTML = ''
  bracket.append(renderTree(size, roundLabels(size), (r, i) => (r === 0 ? slotEl(slots[i], redacted) : tbdEl())))
}

// The live reveal (phase one, ADR-0046): the server sends only the steps revealed so far (sliced to the
// cursor), each placing a player onto its first-round line. A revealed round-1 bye is a resolved match
// (§31): the paired player advances „ohne Spiel", so once both its lines are revealed it already shows in
// round 2 — the one round a bye carries a player forward (ADR-0025; deeper rounds stay „?" until the field
// is fully revealed and switches to the live results view).
export const renderReveal = (
  bracket: HTMLElement,
  draw: RevealingBracket,
  redacted: boolean,
  scheduleIndex: Map<string, NodeSchedule>
) => {
  // The revealed bracket: round-1 lines by position and the round-2 bye-winners (§31). The same shared
  // interpretation the operator draw show renders (CONTEXT: Revealed bracket) — no bracket logic here,
  // only the DOM binding below.
  const { lines, byeWinners } = revealedBracket(draw.size, draw.steps)

  bracket.innerHTML = ''
  bracket.append(
    renderTree(
      draw.size,
      roundLabels(draw.size),
      (r, i) => {
        if (r === 0) return revealSlotEl(lines[i], redacted)
        const winner = r === 1 ? byeWinners[i] : null
        return winner ? playerEl(winner.player, winner.seed, redacted) : tbdEl()
      },
      // The court/time annotation (#159): while revealing, the public bracket shows the **main** bracket
      // only (the consolation has no reveal show), and a node at column r, match m is the schedule's round
      // r+1, position m. Joins on topology via `scheduleNodeKey`; a node the feed doesn't carry has no line.
      (r, m) => {
        const entry = scheduleIndex.get(scheduleNodeKey(draw.competition, 'main', r + 1, m))
        return entry ? scheduleNoteEl(entry) : null
      }
    )
  )
}

// A fully-revealed competition (phase two, ADR-0046): render the selected segment into the bracket, and
// show the segment control only when a consolation bracket exists. The Hauptrunde view is the main KO tree
// plus the „Spiel um Platz 3" box; the Nebenrunde view is the consolation tree alone. `selected` + `onSelect`
// carry the segment state, which lives in the controller so it survives a poll.
export const renderLive = (
  segmentsEl: HTMLElement,
  bracket: HTMLElement,
  live: LiveCompetition,
  redacted: boolean,
  scheduleIndex: Map<string, NodeSchedule>,
  selected: Segment,
  onSelect: (segment: Segment) => void
) => {
  const { consolation } = live
  if (consolation) {
    renderSegments(segmentsEl, selected, onSelect)
    segmentsEl.hidden = false
  } else {
    segmentsEl.hidden = true
  }
  bracket.innerHTML = ''
  if (consolation && selected === 'consolation') {
    bracket.append(renderLiveTree(consolation, 'consolation', live.competition, redacted, scheduleIndex))
    return
  }
  bracket.append(renderLiveTree(live.main, 'main', live.competition, redacted, scheduleIndex))
  const third = live.main.matches.find(m => m.thirdPlace)
  if (third) bracket.append(thirdPlaceBox(third, live.competition, redacted, scheduleIndex))
}
