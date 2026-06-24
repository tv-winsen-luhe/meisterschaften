#!/usr/bin/env node
// Prüft die OG-/SEO-Metadaten in dist/**/*.html auf Längen-Limits.
// Läuft nach `astro build`. Harte Limits → exit 1, weiche Limits → nur Warnung.
// Aufruf: node scripts/check-meta.mjs [--strict]
//   --strict  behandelt auch Warnungen als Fehler (exit 1)

import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')
const STRICT = process.argv.includes('--strict')

// Empfohlene Längen (Zeichen). warn = weich, error = hart.
const LIMITS = {
  title: { warn: 60, error: 70, label: '<title>' },
  description: { warn: 160, error: 200, label: 'meta description', min: 50 },
  'og:title': { warn: 70, error: 90, label: 'og:title' },
  'og:description': { warn: 160, error: 300, label: 'og:description', min: 50 }
}

const NAMED = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '', // soft hyphen: unsichtbar, zählt nicht
  ndash: '–',
  mdash: '—',
  darr: '↓',
  hellip: '…'
}

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => (name in NAMED ? NAMED[name] : m))
}

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* htmlFiles(p)
    else if (entry.name.endsWith('.html')) yield p
  }
}

function extract(html) {
  const grabMeta = (attr, val) => {
    const re = new RegExp(`<meta[^>]*${attr}=["']${val}["'][^>]*content=["']([^"']*)["']`, 'i')
    const m = html.match(re)
    return m ? decode(m[1]) : null
  }
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i)
  return {
    title: titleMatch ? decode(titleMatch[1]) : null,
    description: grabMeta('name', 'description'),
    'og:title': grabMeta('property', 'og:title'),
    'og:description': grabMeta('property', 'og:description')
  }
}

let errors = 0
let warnings = 0
const rows = []

for await (const file of htmlFiles(DIST)) {
  const html = await readFile(file, 'utf8')
  const meta = extract(html)
  const rel = relative(DIST, file)

  for (const [key, cfg] of Object.entries(LIMITS)) {
    const value = meta[key]
    if (value == null) {
      // title fehlt = Fehler; alle anderen dürfen fehlen (z. B. Legal-Seiten)
      if (key === 'title') {
        errors++
        rows.push({ rel, key: cfg.label, len: '—', status: 'FEHLER', note: 'fehlt' })
      }
      continue
    }
    const len = [...value].length
    let status = 'ok'
    let note = `${len} Zeichen`
    if (len > cfg.error) {
      status = 'FEHLER'
      errors++
      note = `${len} > ${cfg.error}`
    } else if (len > cfg.warn) {
      status = 'WARNUNG'
      warnings++
      note = `${len} > ${cfg.warn}`
    } else if (cfg.min && len < cfg.min) {
      status = 'WARNUNG'
      warnings++
      note = `${len} < ${cfg.min} (kurz)`
    }
    rows.push({ rel, key: cfg.label, len, status, note })
  }
}

const icon = { ok: '✓', WARNUNG: '⚠', FEHLER: '✗' }
let lastFile = null
for (const r of rows) {
  if (r.rel !== lastFile) {
    console.log(`\n${r.rel}`)
    lastFile = r.rel
  }
  console.log(`  ${icon[r.status]} ${r.key.padEnd(18)} ${r.note}`)
}

console.log(`\n${rows.length} Felder geprüft — ${errors} Fehler, ${warnings} Warnungen`)

if (errors > 0 || (STRICT && warnings > 0)) process.exit(1)
