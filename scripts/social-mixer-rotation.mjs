// Prints the Social mixer's rotation tables — the printed plan the Spielleiterin runs the day from
// (CONTEXT: Social mixer; ADR-0063, ADR-0051).
//
// This is an **offline build tool, not a feature**. The mixer produces no system result and the rotation
// never enters the app: the output here is printed on paper and carried to the courts. It deliberately
// prints a table for *every* plausible head-count, because the count is only final when everyone has
// actually turned up — with a sheet per N nobody needs a laptop, a network, or this script on the day.
//
// No scoring column, on purpose. „Kein Ergebnis" was the public promise to an audience that self-selected
// away from competition (ADR-0051 §6); a points column would quietly turn the format into the thing those
// women opted out of.
//
// Usage:
//   node scripts/social-mixer-rotation.mjs              # every head-count, 8–12
//   node scripts/social-mixer-rotation.mjs --n=9        # just one
//   node scripts/social-mixer-rotation.mjs --minutes=180 --briefing=15
//   node scripts/social-mixer-rotation.mjs --start=14:00   # after moving the block in the admin
//
// `--minutes` and `--start` mirror the mixer block (shared/social-mixer.ts): its fixed three hours and the
// start the operator has set in the admin, which is movable since ADR-0064 — pass `--start` whenever the
// block no longer sits at its default 12:00, or the sheet in the Spielleiterin's hand will name times the
// app does not. They are plain arguments rather than imports because this file is plain Node with no build
// step; the block is the source of truth if the two ever disagree.

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? Number(hit.slice(name.length + 3)) : fallback
}

const BLOCK_MINUTES = arg('minutes', 180)
const BRIEFING_MINUTES = arg('briefing', 15)

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

// Players are numbered, not named: the Spielleiterin hands out numbers on arrival, which is what makes one
// pre-printed sheet usable for whoever actually shows up.
const name = i => String(i + 1)
const pair = p => `${name(p[0])} + ${name(p[1])}`

const printTable = n => {
  const { schedule, courts, rounds, minutes, partnered, sitCount } = build(n)
  const start = START_MINUTES + BRIEFING_MINUTES

  console.log(`\n${'='.repeat(72)}`)
  console.log(
    `DAMEN DOPPEL — ${n} Spielerinnen · ${courts} ${courts === 1 ? 'Platz' : 'Plätze'} · ${rounds} Runden à ${minutes} Min`
  )
  console.log(
    `Beginn ${clock(START_MINUTES)} Uhr (Begrüßung ${BRIEFING_MINUTES} Min), Ende ca. ${clock(start + rounds * minutes)} Uhr`
  )
  console.log('='.repeat(72))
  console.log('Jede Spielerin bekommt bei der Ankunft eine Nummer. Kein Ergebnis, keine Wertung.\n')

  const courtHeads = courtNumbers(courts).map(court => `Platz ${court}`.padEnd(22))
  console.log(`${'Runde'.padEnd(7)}${'Zeit'.padEnd(8)}${courtHeads.join('')}Pause`)
  console.log('-'.repeat(72))
  schedule.forEach((round, r) => {
    const time = clock(start + r * minutes)
    const cells = round.courts.map(([p1, p2]) => `${pair(p1)} vs ${pair(p2)}`.padEnd(22))
    console.log(`${String(r + 1).padEnd(7)}${time.padEnd(8)}${cells.join('')}${round.sitters.map(name).join(', ')}`)
  })

  // The quality of the mix, printed so it is checkable rather than trusted: how often the worst-off pair
  // was handed each other, and whether the pauses came out even.
  const repeats = Math.max(0, ...partnered.values())
  const sits = [...new Set(sitCount)].sort()
  console.log(
    `\nMischung: jede Partnerin höchstens ${repeats}× dieselbe · Pausen pro Spielerin: ${sits.join(' bzw. ')}`
  )
}

const clock = total => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`

const only = arg('n', null)
for (const n of only ? [only] : [8, 9, 10, 11, 12]) printTable(n)
console.log()
