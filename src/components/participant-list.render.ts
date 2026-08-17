import { isUnseededCompetition } from '../../shared'
import type { Participant } from '../../shared'

// The public participant list's DOM layer, split out of participant-list.astro so the component's
// `<script>` stays a thin fetch/phase/meter controller — the same split tournament-draw.render.ts makes
// (ADR-0046). Pure and framework-free: it takes a field's rows and a render target and fills it.
//
// One field renders one of two ways, and the difference is a single fact: **is this competition seeded?**
// (ADR-0066 — `!isUnseededCompetition(slug)`, the predicate of ADR-0058, never a slug allow-list). A seeded
// field is a **seeding board** — a position number per row, a filled circle on the seeds, the lot divider
// below them, the LK column; the unseeded mixer stays a friendly list with none of it, because it is
// unrated by construction and never drawn.

// The two club crests the avatar picks between, read off the component's dataset and handed in so this
// module stays free of the DOM it did not build.
export interface Logos {
  tv: string
  tsv: string
}

const elem = (tag: string, className: string, text?: string): HTMLElement => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// Below the seeds sit the players the lot places — say so, rather than letting the numbering imply that
// row 5 is "seeded fifth". Shown on every seeded field: the Challenger is drawn like any other (ADR-0024).
const divider = (): HTMLElement =>
  elem('li', 'pl-divider', 'Weitere im Feld — Platzierung wird bei der Auslosung gelost')

const row = (entry: Participant, position: number, seeded: boolean, logos: Logos): HTMLElement => {
  // The seed is the server's decision, carried on the wire as `seedRank` (ADR-0047): it is derived from LK
  // by provisionalSeedRanks, deliberately independent of this list's display order, so reading it off the
  // row's position would seed whoever happens to sit at the top — the bug ADR-0047 fixed in the tableau
  // preview. The two orders coincide today (ADR-0065 gave the cut, the list and the seeding one
  // comparator); the circle still shows `seedRank`, so they may diverge again without lying.
  const seed = seeded ? entry.seedRank : null
  const li = elem('li', seed !== null ? 'pl-row pl-row--seed' : 'pl-row')

  if (seeded) {
    const rank = elem('span', seed !== null ? 'pl-rank pl-rank--seed' : 'pl-rank', String(seed ?? position))
    if (seed !== null) rank.title = `An ${seed} gesetzt (vorläufig)`
    li.append(rank)
  }

  const avatar = elem('span', 'pl-avatar')
  const isTsv = entry.club.includes('TSV')
  const logo = document.createElement('img') as HTMLImageElement
  logo.src = isTsv ? logos.tsv : logos.tv
  logo.alt = isTsv ? 'TSV Winsen' : 'TV Winsen'
  logo.loading = 'lazy'
  avatar.append(logo)
  li.append(avatar)

  li.append(elem('span', 'pl-name', `${entry.firstName} ${entry.lastName}`.trim()))

  // Strength redaction is the server's decision, carried on the wire (ADR-0048): a `redacted` row omits
  // the LK entirely — neither „LK x" nor „LK folgt" — while a non-redacted `lk: null` is a genuine
  // not-yet-synced rating that shows „LK folgt". The client renders the flag; it no longer knows which
  // fields are protected. The admin still shows the LK (it needs it to bind the cap at the draw, ADR-0024).
  // An unseeded field (the social mixer) has no LK concept at all, so it never shows an LK column.
  if (seeded && !entry.redacted) {
    li.append(elem('span', entry.lk ? 'pl-lk' : 'pl-lk pl-lk--pending', entry.lk ? `LK ${entry.lk}` : 'LK folgt'))
  }

  return li
}

// Fill one competition's list with its rows, replacing whatever it held (the server-rendered skeleton, or
// the previous poll's rows). It takes the `slug` rather than a ready-made flag so that the board-or-list
// decision — the one this surface got wrong for two ADRs — is made here, in the module a test can reach,
// and not in the component's `<script>`. The entries arrive in wire order, which since ADR-0065 is the
// seeding order for every field.
export const renderField = (list: HTMLElement, entries: readonly Participant[], slug: string, logos: Logos): void => {
  const seeded = !isUnseededCompetition(slug)
  list.innerHTML = ''
  // Whether there are seeds at all is the server's call too: it applies the DTB seed count for the field's
  // draw size and the draw floor below which there is no real field yet, so a client-side count could only
  // ever disagree with it. The seeds are a prefix of the wire order (one comparator ranks both, ADR-0065),
  // so the divider goes before the first unseeded row — unless that is the first row, i.e. no seeds at all.
  const firstUnseeded = seeded ? entries.findIndex(e => e.seedRank === null) : -1
  entries.forEach((entry, i) => {
    if (i === firstUnseeded && i > 0) list.append(divider())
    list.append(row(entry, i + 1, seeded, logos))
  })
}
