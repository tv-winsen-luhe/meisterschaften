// Prints the Social mixer's rotation tables — the printed plan the Spielleiterin runs the day from
// (CONTEXT: Social mixer; ADR-0063, ADR-0051).
//
// This is an **offline build tool, not a feature**. The mixer produces no system result and the rotation
// never enters the app: the output here is printed on paper and carried to the courts. It deliberately
// prints a table for *every* plausible head-count, because the count is only final when everyone has
// actually turned up — with a sheet per N nobody needs a laptop, a network, or this script on the day.
// `--html` is those same sheets as a print-ready page rather than a second surface: still a file you print,
// still nothing the app serves, which is ADR-0063's „the rotation stays offline" held rather than crossed.
// An admin route would have had to be released for a page that is dead after Sunday 15:00.
//
// No scoring column, on purpose. „Kein Ergebnis" was the public promise to an audience that self-selected
// away from competition (ADR-0051 §6); a points column would quietly turn the format into the thing those
// women opted out of.
//
// Usage:
//   node scripts/social-mixer-rotation.mjs              # every head-count, 8–12
//   node scripts/social-mixer-rotation.mjs --n=9        # just one
//   node scripts/social-mixer-rotation.mjs --n=8,9,10   # the counts the day can plausibly have
//   node scripts/social-mixer-rotation.mjs --minutes=180 --briefing=15
//   node scripts/social-mixer-rotation.mjs --start=14:00   # after moving the block in the admin
//   node scripts/social-mixer-rotation.mjs --html > plan.html            # print-ready, one A4 page per N
//   node scripts/social-mixer-rotation.mjs --n=9 --names="Ann,Bea,…" --html > plan.html
//
// `--names` takes the actual field, comma-separated, and is what turns „2 + 3 vs 4 + 5" into names. It is
// an **argument and never a committed default**: this repository is public (ADR-0013), so no participant's
// name belongs in it, and the generated page belongs outside the working tree for the same reason. Names
// are used only on the sheet whose head-count they match exactly — on the eight-of-nine sheet nobody knows
// yet which eight turned up, so numbers are the only honest labels there.
//
// `--minutes`, `--start` and `--day` mirror the mixer block (shared/social-mixer.ts): its fixed three
// hours, the start the operator has set in the admin (movable since ADR-0064) and the day it sits on — pass
// them whenever the block no longer sits at its default Sunday 12:00, or the sheet in the Spielleiterin's
// hand will name a time the app does not. They are plain arguments rather than imports because this file is
// plain Node with no build step; the block is the source of truth if the two ever disagree.

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? Number(hit.slice(name.length + 3)) : fallback
}

const text = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const BLOCK_MINUTES = arg('minutes', 180)
const BRIEFING_MINUTES = arg('briefing', 15)

// The block's day as the label the public appointment uses (src/data/tournament.ts). Only ever printed, so
// a plain string: the sheet has to *say* which afternoon it is, because both event days share one clock.
const DAY_LABEL = text('day', 'Sonntag, 23.08.')

// The field, comma-separated, or null for the numbered sheets. Trimmed and emptied out so a trailing comma
// or a stray space cannot silently produce a nameless player.
const NAMES = (() => {
  const raw = text('names', null)
  if (!raw) return null
  const names = raw
    .split(',')
    .map(n => n.trim())
    .filter(Boolean)
  return names.length > 0 ? names : null
})()

const HTML = process.argv.includes('--html')

// The block's start as minutes from midnight, from `--start=HH:MM` (default 12:00, the block's own default).
const START_MINUTES = (() => {
  const hit = process.argv.find(a => a.startsWith('--start='))
  if (!hit) return 12 * 60
  const [h, m] = hit.slice('--start='.length).split(':').map(Number)
  return h * 60 + (m || 0)
})()

// The mixer's court rule, duplicated from `socialMixerCourts` in shared/social-mixer.ts (ADR-0064) because
// this file is plain Node with no build step and the shared module is TypeScript: four players to a court,
// `floor(n / 4)` capped at three, and the courts numbered **from the top down** so court 4 — the one
// Sunday's finals can use — is the first one released. `test/social-mixer-block.test.ts` runs this script
// and compares its column headings against the resolver, so the two cannot drift quietly. The shared rule
// additionally floors at one court (a block never silently vanishes; an empty field is a cancellation);
// here a head-count below four simply has no rotation to print.
const MAX_COURTS = 3
const courtNumbers = courts => Array.from({ length: courts }, (_, i) => 6 - courts + 1 + i)

/**
 * How the day is shaped for a given head-count.
 *
 * Courts follow the count (four players per court), and the leftovers sit a round out. The round *count*
 * is then the head-count itself whenever anyone sits out — that is what makes the pause fair: over N
 * rounds every player sits out exactly the same number of times. With a multiple of four nobody ever
 * sits out, so the count is free and 8 rounds fills the block at a comfortable length.
 */
const shapeFor = n => {
  // Capped at three, like `socialMixerCourts` in shared/social-mixer.ts (ADR-0064): a fourth court would
  // come out of the championship's Sunday, so beyond twelve players the surplus rotates out instead. The
  // cap belongs here rather than only in the labelling, because this count drives who plays each round.
  const courts = Math.min(MAX_COURTS, Math.floor(n / 4))
  const resting = n - courts * 4
  const rounds = resting > 0 ? n : 8
  return { courts, resting, rounds, minutes: Math.floor((BLOCK_MINUTES - BRIEFING_MINUTES) / rounds) }
}

// Every way to split `players` into groups of four, each group split into two pairs — the candidate
// line-ups for one round. Enumerated exhaustively (at most 12 players, so a few thousand candidates) so
// the choice below is a real optimum over the round, not a heuristic guess.
const lineups = players => {
  if (players.length === 0) return [[]]
  const [first, ...rest] = players
  const out = []
  for (let a = 0; a < rest.length; a++)
    for (let b = a + 1; b < rest.length; b++)
      for (let c = b + 1; c < rest.length; c++) {
        const four = [first, rest[a], rest[b], rest[c]]
        const remaining = rest.filter((_, i) => i !== a && i !== b && i !== c)
        // The three ways four players split into two pairs.
        const splits = [
          [
            [four[0], four[1]],
            [four[2], four[3]]
          ],
          [
            [four[0], four[2]],
            [four[1], four[3]]
          ],
          [
            [four[0], four[3]],
            [four[1], four[2]]
          ]
        ]
        for (const court of splits) for (const tail of lineups(remaining)) out.push([court, ...tail])
      }
  return out
}

const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`)

/**
 * Build the rotation: for each round, pick the line-up that repeats partners and opponents least.
 *
 * Repeat partners are penalised quadratically and far harder than repeat opponents — meeting someone
 * across the net twice is fine, being handed the same partner twice when you came to meet new people is
 * the failure the format exists to avoid. Deterministic: no clock, no randomness, so the printed sheet is
 * reproducible and a reprint is identical to the original.
 */
const build = n => {
  const { courts, resting, rounds, minutes } = shapeFor(n)
  const partnered = new Map()
  const faced = new Map()
  const sitCount = Array.from({ length: n }, () => 0)
  const schedule = []

  for (let r = 0; r < rounds; r++) {
    // Sitters rotate through the field, so the pauses spread evenly rather than landing on the same people.
    const sitters = Array.from({ length: resting }, (_, i) => (r * resting + i) % n)
    const playing = Array.from({ length: n }, (_, i) => i).filter(i => !sitters.includes(i))

    let best = null
    let bestScore = Infinity
    for (const lineup of lineups(playing)) {
      let score = 0
      for (const [p1, p2] of lineup) {
        score += (partnered.get(key(...p1)) ?? 0) ** 2 * 10 + (partnered.get(key(...p2)) ?? 0) ** 2 * 10
        for (const x of p1) for (const y of p2) score += faced.get(key(x, y)) ?? 0
      }
      if (score < bestScore) {
        bestScore = score
        best = lineup
      }
      if (score === 0) break
    }

    for (const [p1, p2] of best) {
      partnered.set(key(...p1), (partnered.get(key(...p1)) ?? 0) + 1)
      partnered.set(key(...p2), (partnered.get(key(...p2)) ?? 0) + 1)
      for (const x of p1) for (const y of p2) faced.set(key(x, y), (faced.get(key(x, y)) ?? 0) + 1)
    }
    for (const s of sitters) sitCount[s]++
    schedule.push({ courts: best, sitters })
  }

  return { schedule, courts, rounds, minutes, partnered, sitCount }
}

// Players are numbered, not named, unless `--names` supplied exactly this head-count: the Spielleiterin
// hands out numbers on arrival, which is what makes one pre-printed sheet usable for whoever actually shows
// up. The match has to be *exact* rather than merely long enough — names are only true of the full field.
const labelsFor = n => (NAMES && NAMES.length === n ? NAMES : Array.from({ length: n }, (_, i) => String(i + 1)))

const clock = total => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`

/** One sheet's facts, shared by the terminal table and the printed page so the two cannot describe different days. */
const sheetFor = n => {
  const { schedule, courts, rounds, minutes, partnered, sitCount } = build(n)
  const label = labelsFor(n)
  const named = NAMES !== null && NAMES.length === n
  const firstRound = START_MINUTES + BRIEFING_MINUTES
  return {
    n,
    courts,
    rounds,
    minutes,
    named,
    courtNumbers: courtNumbers(courts),
    resting: schedule[0]?.sitters.length ?? 0,
    repeats: Math.max(0, ...partnered.values()),
    sits: [...new Set(sitCount)].sort(),
    endMinutes: firstRound + rounds * minutes,
    rows: schedule.map((round, r) => ({
      round: r + 1,
      time: clock(firstRound + r * minutes),
      courts: round.courts.map(([p1, p2]) => ({ left: p1.map(i => label[i]), right: p2.map(i => label[i]) })),
      sitters: round.sitters.map(i => label[i])
    }))
  }
}

const printTable = n => {
  const s = sheetFor(n)
  const pair = p => p.join(' + ')
  const cellsOf = row => row.courts.map(c => `${pair(c.left)} vs ${pair(c.right)}`)
  // The court column is as wide as its widest line-up needs, never a guessed constant: „2 + 3 vs 4 + 5" and
  // „Cindy Julieth + Susanne vs Judica + Alexandra" are the same column, and a fixed width silently ran the
  // named cells into each other. `padEnd` cannot shorten, so measuring is the only thing that keeps the
  // columns columns.
  const width = Math.max(22, ...s.rows.flatMap(row => cellsOf(row).map(cell => cell.length + 2)))
  const ruleWidth = Math.max(72, 7 + 8 + s.courts * width + 5)

  console.log(`\n${'='.repeat(ruleWidth)}`)
  console.log(
    `DAMEN DOPPEL — ${n} Spielerinnen · ${s.courts} ${s.courts === 1 ? 'Platz' : 'Plätze'} · ${s.rounds} Runden à ${s.minutes} Min`
  )
  console.log(
    `${DAY_LABEL} · Beginn ${clock(START_MINUTES)} Uhr (Begrüßung ${BRIEFING_MINUTES} Min), Ende ca. ${clock(s.endMinutes)} Uhr`
  )
  console.log('='.repeat(ruleWidth))
  console.log(
    s.named
      ? 'Kein Ergebnis, keine Wertung.\n'
      : 'Jede Spielerin bekommt bei der Ankunft eine Nummer. Kein Ergebnis, keine Wertung.\n'
  )

  const courtHeads = s.courtNumbers.map(court => `Platz ${court}`.padEnd(width))
  console.log(`${'Runde'.padEnd(7)}${'Zeit'.padEnd(8)}${courtHeads.join('')}Pause`)
  console.log('-'.repeat(ruleWidth))
  for (const row of s.rows) {
    const cells = cellsOf(row).map(cell => cell.padEnd(width))
    console.log(`${String(row.round).padEnd(7)}${row.time.padEnd(8)}${cells.join('')}${row.sitters.join(', ')}`)
  }

  // The quality of the mix, printed so it is checkable rather than trusted: how often the worst-off pair
  // was handed each other, and whether the pauses came out even.
  console.log(
    `\nMischung: jede Partnerin höchstens ${s.repeats}× dieselbe · Pausen pro Spielerin: ${s.sits.join(' bzw. ')}`
  )
  // Who calls the change. With a head-count divisible by four nobody sits, so there is no rotating role to
  // hand it to and the sheet has to say so rather than leaving the day to discover it.
  console.log(
    s.resting > 0
      ? 'Wer pausiert, nimmt die Zeit: zur nächsten Uhrzeit abpfeifen, dann Plätze wechseln.'
      : 'Es pausiert niemand — die Zeit nimmt die Spielleiterin.'
  )
}

const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The same sheets as one print-ready page, an A4 sheet per head-count.
 *
 * Written to **stdout** rather than to a file: the page carries the field's names, this repository is public
 * (ADR-0013), and a script that writes into the working tree is one `git add .` away from committing them.
 * Redirecting is the caller's choice of somewhere that is not the repo.
 */
const renderHtml = counts => {
  const courtsLine = c =>
    c.length === 1 ? `Platz ${c[0]}` : `Platz ${c.slice(0, -1).join(', ')} und ${c[c.length - 1]}`

  const sheet = s => `
    <section class="sheet">
      <header>
        <h1>Damen Doppel</h1>
        <p class="when">${escape(DAY_LABEL)} · ${clock(START_MINUTES)}–${clock(START_MINUTES + BLOCK_MINUTES)} Uhr · ${courtsLine(s.courtNumbers)}</p>
        <p class="shape"><strong>${s.n} Spielerinnen</strong> · ${s.rounds} Runden à ${s.minutes} Minuten · Begrüßung ${clock(START_MINUTES)}–${clock(START_MINUTES + BRIEFING_MINUTES)} · letzte Runde bis ${clock(s.endMinutes)}</p>
      </header>

      <table>
        <thead>
          <tr>
            <th class="round">Runde</th>
            <th class="time">Zeit</th>
            ${s.courtNumbers.map(c => `<th>Platz ${c}</th>`).join('')}
            ${s.resting > 0 ? '<th class="rest">Pause · nimmt die Zeit</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${s.rows
            .map(
              row => `<tr>
            <td class="round">${row.round}</td>
            <td class="time">${row.time}</td>
            ${row.courts
              .map(
                c =>
                  `<td class="match"><span class="side">${c.left.map(escape).join(' + ')}</span><span class="side"><span class="vs">gegen</span> ${c.right.map(escape).join(' + ')}</span></td>`
              )
              .join('')}
            ${s.resting > 0 ? `<td class="rest">${row.sitters.map(escape).join(', ')}</td>` : ''}
          </tr>`
            )
            .join('')}
        </tbody>
      </table>

      ${
        s.named
          ? ''
          : `<section class="legend">
        <h2>Nummern</h2>
        <p class="hint">Bei der Ankunft eine Nummer vergeben und hier eintragen.</p>
        <ol>${Array.from({ length: s.n }, (_, i) => `<li><span class="num">${i + 1}</span><span class="line"></span></li>`).join('')}</ol>
      </section>`
      }

      <footer>
        <p class="rule">${
          s.resting > 0
            ? '<strong>Zeit nehmen:</strong> Wer pausiert, nimmt die Zeit — zur nächsten Uhrzeit einmal abpfeifen, dann wechseln alle. Die Rolle wandert jede Runde weiter, jede ist genau einmal dran.'
            : '<strong>Zeit nehmen:</strong> Bei dieser Zahl pausiert niemand — die Zeit nimmt die Spielleiterin.'
        }</p>
        <p class="rule"><strong>Kein Ergebnis, keine Wertung.</strong> Es wird nicht gezählt und nichts aufgeschrieben — es geht ums Mitspielen und Kennenlernen.</p>
        <p class="rule"><strong>Im Anschluss:</strong> gemeinsame Siegerehrung. Deshalb ist um ${clock(START_MINUTES + BLOCK_MINUTES)} Uhr Schluss.</p>
        <p class="mix">Mischung: jede Partnerin höchstens ${s.repeats}× dieselbe · Pausen pro Spielerin: ${s.sits.join(' bzw. ')}</p>
      </footer>
    </section>`

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Damen Doppel — Ablaufplan</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    font: 12pt/1.4 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #17181a;
    background: #f4f4f5;
  }
  .sheet {
    background: #fff;
    width: 210mm;
    min-height: 297mm;
    padding: 14mm;
    margin: 0 auto 8mm;
    box-shadow: 0 1px 6px rgb(0 0 0 / 0.12);
  }
  header { border-bottom: 2pt solid #17181a; padding-bottom: 3mm; }
  h1 { font-size: 24pt; margin: 0; letter-spacing: -0.01em; }
  .when { font-size: 13pt; font-weight: 600; margin: 2mm 0 0; }
  .shape { font-size: 10.5pt; color: #55565a; margin: 1.5mm 0 0; }

  table { width: 100%; border-collapse: collapse; margin-top: 5mm; }
  th {
    text-align: left; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.06em;
    color: #55565a; padding: 0 2mm 1.5mm; border-bottom: 1pt solid #babbbe;
  }
  td { padding: 2.2mm 2mm; border-bottom: 1pt solid #e6e6e8; vertical-align: middle; }
  tbody tr:nth-child(even) { background: #f7f7f8; }
  .round { width: 14mm; font-weight: 700; }
  .time { width: 18mm; font-variant-numeric: tabular-nums; font-weight: 600; }
  .rest { width: 34mm; }
  /* Each side gets its own line, always — a pairing is two lines by design rather than by accident. Left to
     wrap on its own, a long name pushed „gegen" to the start of the next line, where it read as belonging to
     the wrong pair. Two deliberate lines are also faster to scan than one long one on a sheet pinned to a
     fence. */
  .match .side { display: block; font-weight: 600; font-size: 11pt; }
  .match .vs { color: #7a7b80; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 400; }

  .legend { margin-top: 6mm; }
  .legend h2 { font-size: 11pt; margin: 0; }
  .legend .hint { font-size: 9.5pt; color: #55565a; margin: 1mm 0 2mm; }
  .legend ol { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm 6mm; }
  .legend li { display: flex; align-items: baseline; gap: 2mm; }
  .legend .num { font-weight: 700; width: 6mm; }
  .legend .line { flex: 1; border-bottom: 1pt solid #babbbe; height: 5mm; }

  footer { margin-top: 6mm; border-top: 1pt solid #babbbe; padding-top: 3mm; }
  .rule { font-size: 10pt; margin: 0 0 1.5mm; }
  .mix { font-size: 9pt; color: #7a7b80; margin: 3mm 0 0; }

  @media print {
    body { background: #fff; }
    .sheet { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; break-after: page; }
    .sheet:last-of-type { break-after: auto; }
  }
</style>
</head>
<body>
${counts.map(sheetFor).map(sheet).join('\n')}
</body>
</html>`
}

// `--n` takes one head-count or a comma-separated set, because the plausible range on the day is narrower
// than the printable one: „the nine who signed up, minus a no-show, plus a late entry" is `--n=8,9,10`, and
// printing 11 and 12 as well only buries the sheet that will actually be used.
const only = text('n', null)
const counts = only
  ? only
      .split(',')
      .map(part => Number(part.trim()))
      .filter(count => Number.isInteger(count) && count >= 4)
  : [8, 9, 10, 11, 12]
if (HTML) console.log(renderHtml(counts))
else {
  for (const n of counts) printTable(n)
  console.log()
}
