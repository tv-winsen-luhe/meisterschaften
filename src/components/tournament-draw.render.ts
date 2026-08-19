import {
  bracketStructure,
  bracketView,
  displayDrawSize,
  MIN_DRAW_ENTRIES,
  revealedBracket,
  roundLabel,
  scheduleNodeKey
} from '../../shared'
import { tournament } from '../data/tournament'
import type {
  BracketCell,
  BracketSegment,
  BracketView,
  CellSlot,
  CellSchedule,
  NodeSchedule,
  Participant,
  PlayerDisplay,
  PublicCompetitionBracket,
  PublicRevealStep,
  ScheduleResponse
} from '../../shared'

// The public bracket's DOM layer (ADR-0046): every builder that turns bracket data into elements, split
// out of tournament-draw.astro so the component's `<script>` stays a thin fetch/state/poll controller.
// Pure and framework-free — it takes data + a render target and returns/fills DOM, holding no state of its
// own (the selected segment + the re-render trigger are passed in). The three phase renderers at the bottom
// (`renderPreview` / `renderReveal` / `renderLive`) are the module's surface; everything above is internal.

export type Entry = Participant
// A round-1 line of the pre-draw preview. A `seed` line is a seed the DTB table fixes (Nr. 1, Nr. 2 —
// and every seed of a 4- or 8-draw); a `lot` line is one of a lot group's prescribed lines (16-draw:
// lines 5 and 12 for Nr. 3/4), which carries the whole group because §30.5b leaves it to the lot which
// of them lands where. Preview-only — the reveal and the live bracket have their own slot unions.
type Slot = { kind: 'seed'; seed: number; player: Entry } | { kind: 'lot'; seeds: number[]; players: Entry[] } | null
// PlayerDisplay (shared) is the display fields a bracket line shows — the wire contract's reveal-step
// player. A Participant is structurally assignable to it, so the preview and the reveal share one shape.

// The two members of the per-competition bracket union (ADR-0046), narrowed for the renderers below: a
// still-revealing field (cursor-sliced reveal steps) vs. a fully-revealed one (resolved live brackets).
export type RevealingBracket = Extract<PublicCompetitionBracket, { phase: 'revealing' }>
export type LiveCompetition = Extract<PublicCompetitionBracket, { phase: 'live' }>
// Which bracket a live competition's segment shows — the main KO tree or the consolation (ADR-0046).
// Re-exported from the view module rather than redeclared, so the controller's state and the view's
// parameter are the same type by construction.
export type Segment = BracketSegment

// createElement + className (+ optional text) in one — the module's many small line-builders lean on it, so
// each element is one statement rather than the create/className/textContent triple repeated ~30 times.
const elem = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// One bracket's round labels, outermost → final — the file's only round-label source (ADR-0028: the
// German label is derived at the edge, from one rule). The shared `roundLabel` reads from the *end*
// of the bracket, so a 16-, 8- or 4-draw needs no parallel list, and the preview, the reveal and the live
// tree cannot drift from the schedule cards. The round *count* stays topology: `totalRounds` is the
// bracket's own depth (log2(size) for the preview and the reveal, the wire's `totalRounds` for a live one).
const roundLabels = (totalRounds: number, bracket: Segment): string[] =>
  Array.from({ length: totalRounds }, (_, r) => roundLabel({ bracket, round: r + 1, totalRounds }))

// The event's date copy, handed to the view like the schedule page hands it (src/data/tournament.ts is the
// client's, and `shared/` must not reach into it). The view abbreviates it to „Sa"/„So" for the tight cell
// footer; the full „Samstag · 22.08." stays on /spielplan.
const DAYS = [tournament.saturday, tournament.sunday]
// The reveal phase still builds its own caption from the older per-node index (see `scheduleNoteEl`), so it
// keeps the two-letter form here.
const DAY_ABBR = DAYS.map(d => d.weekday.slice(0, 2))

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

// A lot-group line of the pre-draw preview („3/4 · wird gelost"): both prescribed lines carry both
// seeds, because the lines are fixed by the table but the pairing is the lot's (DTB §30.5b). It keeps
// the accepted relative-rank signal — which players are seeded (ADR-0047) — without claiming a
// placement the draw has not made. The seed pill drops on a redacted field like any other seed number
// (ADR-0048); the LKs stay off the line entirely, two ratings would not fit and are not the point here.
const lotSlotEl = (seeds: number[], players: Entry[], redacted: boolean): HTMLElement => {
  const el = elem('div', 'dm-slot dm-slot--lot')
  const label = seeds.join('/')
  if (!redacted) {
    const no = elem('span', 'dm-lotno', label)
    no.title = `An ${label} gesetzt — die Linie wird gelost`
    el.append(no)
  }
  el.append(elem('span', 'dm-name', players.map(p => `${p.firstName} ${p.lastName}`.trim()).join(' / ')))
  el.append(elem('span', 'dm-lot', 'wird gelost'))
  return el
}

const slotEl = (slot: Slot, redacted: boolean): HTMLElement => {
  if (!slot) return tbdEl()
  if (slot.kind === 'lot') return lotSlotEl(slot.seeds, slot.players, redacted)
  return playerEl(slot.player, slot.seed, redacted)
}

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

// ── The live bracket's cell (ADR-0070, #311) ─────────────────────────────────────────────────────
//
// Everything below is a **translation** of the finished `bracketView` tree: no sorting, no label building,
// no „is this decided" arithmetic, and no German assembled from parts. The one thing this layer decides is
// which class carries which fact, which is what a stylesheet is for.

// One contestant line of a cell: seed · name · LK, then the score column, in the tennis anatomy the schedule
// row uses (#309). The winner is marked twice — an inked line with a navy accent bar (the class) *and* a
// check — because a weight difference alone does not survive a phone in bright sunlight.
const cellSlotEl = (slot: CellSlot): HTMLElement => {
  const el = elem('div', 'dm-slot dm-slot--cell')
  // A placeholder line („Freilos", „Sieger M3", „offen") wears the dashed, muted treatment; the view already
  // decided it is one, so this never re-reads the label to find out.
  if (slot.tbd) el.classList.add('dm-slot--feeder')
  else el.classList.add('dm-slot--seed')
  if (slot.winner) el.classList.add('dm-slot--winner')
  if (slot.loser) el.classList.add('dm-slot--loser')

  if (slot.seed) {
    const no = elem('span', 'dm-seedno', slot.seed.text)
    // „An 3 gesetzt" — a bare number beside a name means nothing read aloud.
    no.title = slot.seed.label
    no.setAttribute('aria-label', slot.seed.label)
    el.append(no)
  }
  el.append(elem('span', slot.tbd ? 'dm-feeder' : 'dm-name', slot.text))
  if (slot.lk) el.append(elem('span', slot.lk.pending ? 'dm-lk dm-lk--pending' : 'dm-lk', slot.lk.text))
  if (slot.winner) {
    const check = elem('span', 'dm-check', '✓')
    check.title = 'Sieger'
    check.setAttribute('role', 'img')
    check.setAttribute('aria-label', 'Sieger')
    el.append(check)
  }
  // The games span is emitted even when empty, so the sets keep their column and line up between the two
  // contestant lines — a skipped cell would slide a walkover's „w.o." into the sets' place.
  el.append(elem('span', 'dm-games', slot.games))
  if (slot.outcome) el.append(elem('span', 'dm-outcome', slot.outcome))
  return el
}

// The court + floor caption („Platz 3 · Sa" / „ab 14:00"), the **gated** half of the cell (ADR-0070): it is
// simply absent when the plan is withheld, while the score above stays. The floor is its own span so it can
// read quieter as a follow-on, and so the „ab" / „nicht vor ca." wording is the schedule's verbatim.
const whenEl = (when: CellSchedule): DocumentFragment => {
  const frag = document.createDocumentFragment()
  frag.append(elem('span', 'dm-when__where', when.where))
  const time = elem('span', 'dm-when__time', when.time)
  if (when.followsOn) time.classList.add('dm-when__time--follows')
  frag.append(time)
  return frag
}

// One cell: its header line (court + floor, and „läuft" for a match on court right now), then the two
// contestant lines. The header is emitted even when empty so every match in a column keeps the same height
// and the CSS elbow connectors stay aligned.
const liveMatchEl = (cell: BracketCell | null): HTMLElement => {
  const el = elem('div', 'dm-match')
  const head = elem('div', 'dm-when')
  if (cell?.schedule) head.append(whenEl(cell.schedule))
  // The one status worth a badge — the view decided which, so this only asks whether there is one.
  if (cell?.statusLabel) head.append(elem('span', 'dm-live', cell.statusLabel))
  el.append(head)
  el.append(cell ? cellSlotEl(cell.slot1) : tbdEl(), cell ? cellSlotEl(cell.slot2) : tbdEl())
  return el
}

// The tree: one column per round, outermost → final, rendered in the order the view hands over. It does not
// reuse `renderTree` (the preview/reveal shell) because that one addresses slots by index into a draw size,
// while the view already hands over the columns and their cells — and re-deriving them from `size` here
// would put the topology back on both sides of the seam.
const renderLiveTree = (view: BracketView): HTMLElement => {
  const tree = elem('div', 'dm-tree')
  for (const round of view.rounds) {
    const col = elem('div', 'dm-round')
    const label = elem('div', 'dm-round__label')
    label.append(round.label, elem('span', 'dm-round__count', String(round.matchCount)))
    col.append(label)

    const matches = elem('div', 'dm-round__matches')
    for (const cell of round.cells) matches.append(liveMatchEl(cell))
    col.append(matches)
    tree.append(col)
  }
  return tree
}

// The „Spiel um Platz 3" box beneath the Hauptrunde tree (ADR-0046): the playoff resolved like any other
// cell — score included — under the label the view gives it, because it shares the final's round and would
// otherwise sit in the final's column.
const thirdPlaceBox = (cell: BracketCell): HTMLElement => {
  const box = elem('div', 'dm-third')
  box.append(elem('div', 'dm-third__label', cell.label ?? ''))
  const pair = elem('div', 'dm-third__match')
  const head = elem('div', 'dm-when')
  if (cell.schedule) head.append(whenEl(cell.schedule))
  if (cell.statusLabel) head.append(elem('span', 'dm-live', cell.statusLabel))
  box.append(head)
  pair.append(cellSlotEl(cell.slot1), cellSlotEl(cell.slot2))
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
  // preview's seed lines and count can't drift from the draw's — including which groups are drawn by
  // lot, so a lot group is recognised from the table rather than from a hardcoded „Nr.3/4" here.
  const struct = bracketStructure(size)
  const slots: Slot[] = Array.from({ length: size }, () => null)
  // Seeds go on by the server-computed `seedRank` (by LK, ADR-0047), never by list position: the
  // participants feed is in list order — registration date for a Challenger field — so slicing the top
  // of it would seed the earliest registrants, not the LK-strongest (the prod bug). Seed numbers stay
  // hidden on a `redacted` field and the LK never reaches this wire.
  const bySeed = new Map<number, Entry>()
  for (const player of players) if (player.seedRank != null) bySeed.set(player.seedRank, player)
  for (const group of struct.seedGroups) {
    const seeded = group.seeds.filter(seed => bySeed.has(seed))
    if (seeded.length === 0) continue
    if (group.seeds.length === 1) {
      // A one-seed group: the table fixes the line (Nr. 1 → first, Nr. 2 → last), nothing is drawn.
      slots[group.lines[0]] = { kind: 'seed', seed: seeded[0], player: bySeed.get(seeded[0])! }
      continue
    }
    // A lot group (Nr. 3/4 in a 16-draw): the lines are prescribed, the pairing is the lot's (§30.5b).
    // Both lines therefore show the whole group — pinning one seed per line here would pre-announce a
    // placement the draw has yet to make.
    const entry: Slot = { kind: 'lot', seeds: seeded, players: seeded.map(seed => bySeed.get(seed)!) }
    for (const line of group.lines) slots[line] = entry
  }
  bracket.innerHTML = ''
  bracket.append(
    renderTree(size, roundLabels(Math.log2(size), 'main'), (r, i) => (r === 0 ? slotEl(slots[i], redacted) : tbdEl()))
  )
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
      roundLabels(Math.log2(draw.size), 'main'),
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

// A fully-revealed competition (phase two, ADR-0046, ADR-0070): project the field through `bracketView` and
// render the segment it hands back. The Hauptrunde view is the main KO tree plus the „Spiel um Platz 3" box;
// the Nebenrunde view is the consolation tree alone. `selected` + `onSelect` carry the segment state, which
// lives in the controller so it survives a poll — the *effective* segment comes back from the view, which
// falls back to the main bracket when the one asked for does not exist.
//
// It takes the whole schedule **feed** rather than a per-node index, because the cell footer states a floor
// („im Anschluss · nicht vor ca. 14:00", ADR-0069) and that is a statement about the court's neighbours —
// mostly matches of other fields this tree never draws. The score does **not** come from here: it rides the
// draw wire, so it survives a plan the operator has reset (ADR-0070).
export const renderLive = (
  segmentsEl: HTMLElement,
  bracket: HTMLElement,
  live: LiveCompetition,
  feed: Pick<ScheduleResponse, 'matches'>,
  selected: Segment,
  onSelect: (segment: Segment) => void
) => {
  const view = bracketView(live, feed, { days: DAYS, segment: selected })
  if (view.hasConsolation) {
    renderSegments(segmentsEl, view.segment, onSelect)
    segmentsEl.hidden = false
  } else {
    segmentsEl.hidden = true
  }
  bracket.innerHTML = ''
  bracket.append(renderLiveTree(view))
  if (view.thirdPlace) bracket.append(thirdPlaceBox(view.thirdPlace))
}
