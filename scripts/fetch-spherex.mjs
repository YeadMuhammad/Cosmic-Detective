#!/usr/bin/env node
// Finds and downloads SPHEREx Level 2 spectral-image CUTOUTS for the game's tiles
// from NASA/IPAC IRSA, and writes a manifest with the per-tile metadata the GDD
// asks for (observation dates, detector band, wavelength range).
//
// What it does, per tile (id, RA, Dec, size):
//   1. Asks IRSA's SIA2 service which SPHEREx spectral-image MEFs cover the position.
//   2. Picks ONE pair of images: same detector band, similar wavelength range,
//      observed between --min-gap-days and --max-gap-days apart. Earlier = epoch A.
//   3. Downloads a small FITS cutout of each from IRSA's cutout service
//      (full spectral-image files are hundreds of MB, so we never fetch those).
//   4. Records everything in data/spherex/manifest.json.
//
// What it does NOT do: convert FITS to the JPEGs the game displays, measure the
// moving source's a/b pixel positions, or verify registration. Those are separate
// steps (see "Next steps" printed at the end).
//
// Requirements: Node 18.3+ (global fetch, util.parseArgs). No npm dependencies.
// Network: the sandbox this file was written in had no network access, so the
// network calls are UNTESTED. Pure helpers (CSV, pair selection, fixtures parsing)
// were tested offline. Run with --dry-run first.
//
// Usage:
//   node scripts/fetch-spherex.mjs --list
//   node scripts/fetch-spherex.mjs --dry-run                 # query + show pairs, download nothing
//   node scripts/fetch-spherex.mjs --tile barnard            # one tile (repeatable)
//   node scripts/fetch-spherex.mjs                           # every tile in fixtures.ts
//   node scripts/fetch-spherex.mjs --id test --ra 164.15 --dec 7.04 --size 0.1   # ad hoc position
//
// Sources: IRSA SIA2 https://irsa.ipac.caltech.edu/SIA and the SPHEREx archive
// documentation. SIA2 access_url values point at real on-premises MEFs; the
// documented cutout service is used to download only the requested region.

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const SIA_ENDPOINT = 'https://irsa.ipac.caltech.edu/SIA'
const DEFAULT_FIXTURES = new URL('../src/data/fixtures.ts', import.meta.url)
const BANDS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']
const COLLECTIONS = new Set(['spherex_qr2', 'spherex_qr2_deep', 'spherex_qr3', 'spherex_qr3_deep'])
const SAFE_TILE_ID = /^[A-Za-z0-9._-]+$/
const RESERVED_TILE_IDS = new Set(['__proto__', 'constructor', 'prototype'])
const isSafeTileId = (id) => typeof id === 'string' && SAFE_TILE_ID.test(id) && !RESERVED_TILE_IDS.has(id)

// ---------------------------------------------------------------- pure helpers

/** Reads id/ra/dec/size for every tile in src/data/fixtures.ts so coordinates have ONE source of truth. */
export function parseFixtureTiles(source) {
  const re = /\bid:\s*'([^']+)'[^}]*?\bra:\s*(-?[\d.]+),\s*dec:\s*(-?[\d.]+),\s*size:\s*([\d.]+)/g
  const tiles = []
  for (const m of source.matchAll(re)) tiles.push({ id: m[1], ra: +m[2], dec: +m[3], size: +m[4] })
  return tiles
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). Returns array of row objects keyed by lower-case header. */
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') q = false
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  if (!rows.length) return []
  const head = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

export function buildSiaUrl(ra, dec, band, collection = 'spherex_qr2') {
  const params = new URLSearchParams({
    COLLECTION: collection,
    POS: `circle ${ra} ${dec} 0.001`,
    RESPONSEFORMAT: 'JSON',
    MAXREC: '1000',
  })
  return `${SIA_ENDPOINT}?${params}`
}

export const mjdToIso = (mjd) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10)

/** One SIA2 row -> observation record. Returns null if the row is unusable. */
export function toObservation(r) {
  const url = r.access_url
  const did = r.obs_publisher_did ?? ''
  const id = r.obs_id || /\?([^/]+)/.exec(did)?.[1]
  const lo = parseFloat(r.t_min), hi = parseFloat(r.t_max)
  const wlLo = parseFloat(r.em_min) * 1e6, wlHi = parseFloat(r.em_max) * 1e6 // m -> µm
  if (!url || !id || ![lo, hi, wlLo, wlHi].every(Number.isFinite)) return null
  if (!/\.fits(\?|$)/i.test(url) || r.access_format !== 'image/fits') return null
  const name = r.energy_bandpassname ?? ''
  return {
    obsId: `${id}/${name}`,
    band: name.includes('-') ? name.split('-').pop() : name,
    mjd: (lo + hi) / 2,
    date: mjdToIso((lo + hi) / 2),
    wlMin: wlLo, wlMax: wlHi, wlMid: (wlLo + wlHi) / 2,
    url,
  }
}

/**
 * Choose the best epoch pair: same band, observed minGapDays..maxGapDays apart,
 * midpoint wavelength within wlTolUm. Prefers the smallest wavelength mismatch,
 * then the larger time gap. Returns {a, b, gapDays, dWlUm} or null.
 * NOTE: plane-level energy bounds are a coarse match. SPHEREx uses linear variable
 * filters, so the true wavelength at the target pixel must be checked in the
 * cutout's spectral WCS before trusting a pair for blinking/subtraction.
 */
export function pickPair(obs, { minGapDays, maxGapDays, wlTolUm }) {
  const pool = [...obs].sort((x, y) => x.mjd - y.mjd)
  let best = null
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j]
      if (a.obsId === b.obsId || a.band !== b.band) continue
      const gap = b.mjd - a.mjd
      if (gap < minGapDays || gap > maxGapDays) continue
      const dWl = Math.abs(a.wlMid - b.wlMid)
      if (dWl > wlTolUm) continue
      if (!best || dWl < best.dWlUm - 1e-9 || (Math.abs(dWl - best.dWlUm) <= 1e-9 && gap > best.gapDays)) {
        best = { a, b, gapDays: gap, dWlUm: dWl }
      }
    }
  }
  return best
}

export const cutoutUrl = (url, ra, dec, sizeDeg) => {
  const target = new URL(url)
  target.searchParams.set('center', `${ra},${dec}`)
  target.searchParams.set('size', sizeDeg)
  return target.href
}
const isFits = (buf) => buf.length > 2880 && buf.subarray(0, 9).toString('ascii') === 'SIMPLE  ='

// ---------------------------------------------------------------- network

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const retryAfterMs = (headers) => {
  const value = headers.get('retry-after')?.trim()
  if (!value) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}

async function withRetry(label, fn, tries = 4) {
  let err
  for (let i = 1; i <= tries; i++) {
    try { return await fn() } catch (e) {
      err = e
      console.log(`  retry ${i}/${tries} ${label}: ${e.message}`)
      if (i < tries) await sleep(Math.min(30000, e.retryAfterMs ?? 1500 * i))
    }
  }
  throw err
}

async function querySia(ra, dec, band, collection) {
  const text = await withRetry('SIA query', async () => {
    const res = await fetch(buildSiaUrl(ra, dec, band, collection), {
      headers: { Accept: 'application/json', 'User-Agent': 'cosmic-detective/0.1 (+https://github.com/YeadMuhammad/Cosmic-Detective)' },
      signal: AbortSignal.timeout(120000),
    })
    const t = await res.text()
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status} ${t.slice(0, 200).replace(/\s+/g, ' ')}`)
      const retryAfter = retryAfterMs(res.headers)
      if (retryAfter !== undefined) error.retryAfterMs = retryAfter
      throw error
    }
    return t
  })
  const table = JSON.parse(text).VOTABLE?.RESOURCE_ARRAY?.at(-1)?.TABLE
  const fields = table?.FIELD_ARRAY?.map((field) => field['<xmlattr>']?.name)
  const rows = table?.DATA?.TABLEDATA
  if (!fields || !Array.isArray(rows)) throw new Error('SIA response did not contain a result table')
  const seen = new Set()
  return rows.map((row) => toObservation(Object.fromEntries(fields.map((name, i) => [name, row[i] ?? '']))))
    .filter((o) => o && (!band || o.band === band))
    .filter((o) => o && !seen.has(o.obsId) && seen.add(o.obsId))
}

async function downloadCutout(url, dest) {
  const buf = await withRetry(dest.pathname.split('/').pop(), async () => {
    const res = await fetch(url, {
      headers: { Accept: 'application/fits', 'User-Agent': 'cosmic-detective/0.1 (+https://github.com/YeadMuhammad/Cosmic-Detective)' },
      signal: AbortSignal.timeout(180000),
    })
    const b = Buffer.from(await res.arrayBuffer())
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status} ${res.statusText}`)
      const retryAfter = retryAfterMs(res.headers)
      if (retryAfter !== undefined) error.retryAfterMs = retryAfter
      throw error
    }
    if (!isFits(b)) throw new Error(`response is not a FITS file (${b.length} bytes)`)
    return b
  })
  await writeFile(dest, buf)
  return buf.length
}

// ---------------------------------------------------------------- main

function usage() {
  console.log(`Usage: node scripts/fetch-spherex.mjs [options]
  --list                  print the tiles that would be processed and exit
  --dry-run               query IRSA and show chosen pairs; download nothing, write nothing
  --tile <id>             only this tile id from fixtures.ts (repeatable)
  --id <s> --ra <deg> --dec <deg> [--size <deg>]   ad hoc position instead of fixtures
  --fixtures <path>       fixtures file to read tiles from (default src/data/fixtures.ts)
  --size <deg>            cutout size override for all tiles (default: each tile's own size)
  --band <D1..D6>         restrict to one SPHEREx detector band
  --collection <name>     SIA2 collection (default spherex_qr2; also spherex_qr3[_deep] and spherex_qr2_deep)
  --min-gap-days <n>      minimum time between epochs (default 60)
  --max-gap-days <n>      maximum time between epochs (default 400)
  --wl-tol-um <x>         max midpoint-wavelength difference in microns (default 0.02)
  --out <dir>             output directory (default data/spherex)
  --concurrency <n>       parallel tiles (default 3)`)
}

async function main() {
  const { values: v } = parseArgs({
    options: {
      list: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      tile: { type: 'string', multiple: true }, id: { type: 'string' }, ra: { type: 'string' }, dec: { type: 'string' },
      fixtures: { type: 'string' }, size: { type: 'string' }, band: { type: 'string' }, collection: { type: 'string', default: 'spherex_qr2' },
      'min-gap-days': { type: 'string', default: '60' }, 'max-gap-days': { type: 'string', default: '400' },
      'wl-tol-um': { type: 'string', default: '0.02' }, out: { type: 'string', default: 'data/spherex' },
      concurrency: { type: 'string', default: '3' },
    },
  })
  if (v.help) return usage()
  if (v.band && !BANDS.includes(v.band)) throw new Error(`--band must be one of ${BANDS.join(', ')}`)
  if (!COLLECTIONS.has(v.collection)) throw new Error(`--collection must be one of ${[...COLLECTIONS].join(', ')}`)
  const num = (name, x) => { const n = Number(x); if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`); return n }
  const opts = {
    minGapDays: num('min-gap-days', v['min-gap-days']), maxGapDays: num('max-gap-days', v['max-gap-days']),
    wlTolUm: num('wl-tol-um', v['wl-tol-um']),
  }
  if (opts.minGapDays > opts.maxGapDays) throw new Error('--min-gap-days must not exceed --max-gap-days')
  if (opts.wlTolUm < 0) throw new Error('--wl-tol-um must not be negative')
  const validateTile = (tile) => {
    if (!isSafeTileId(tile.id)) {
      throw new Error(`Invalid tile id "${tile.id}": use only safe filename characters and not a reserved object key`)
    }
    if (!(tile.size > 0)) throw new Error(`--size must be positive for tile "${tile.id}"`)
    return tile
  }

  // Targets
  let tiles
  if (v.ra || v.dec || v.id) {
    if (!(v.ra && v.dec && v.id)) throw new Error('Ad hoc mode needs --id, --ra and --dec together')
    tiles = [validateTile({ id: v.id, ra: num('ra', v.ra), dec: num('dec', v.dec), size: num('size', v.size ?? '0.1') })]
  } else {
    const src = await readFile(v.fixtures ? new URL(v.fixtures, `file://${process.cwd()}/`) : DEFAULT_FIXTURES, 'utf8')
    tiles = parseFixtureTiles(src).map(validateTile)
    if (!tiles.length) throw new Error('Found no tiles in the fixtures file; has its format changed?')
    if (v.tile?.length) {
      const missing = v.tile.filter((t) => !tiles.some((x) => x.id === t))
      if (missing.length) throw new Error(`Unknown tile id(s): ${missing.join(', ')}`)
      tiles = tiles.filter((t) => v.tile.includes(t.id))
    }
    if (v.size) tiles = tiles.map((t) => validateTile({ ...t, size: num('size', v.size) }))
  }

  if (v.list) { for (const t of tiles) console.log(`${t.id.padEnd(18)} RA ${t.ra}  Dec ${t.dec}  size ${t.size}°`); return }

  const outDir = new URL(`${v.out.replace(/\/?$/, '/')}`, `file://${process.cwd()}/`)
  const rawDir = new URL('raw/', outDir)
  const manifestUrl = new URL('manifest.json', outDir)
  if (!v['dry-run']) await mkdir(rawDir, { recursive: true })

  let priorTiles = {}
  try {
    const previous = JSON.parse(await readFile(manifestUrl, 'utf8'))
    if (previous.tiles && typeof previous.tiles === 'object' && !Array.isArray(previous.tiles)) {
      priorTiles = Object.fromEntries(Object.entries(previous.tiles).filter(([id]) => isSafeTileId(id)))
    }
  } catch { /* first run or unreadable prior manifest */ }
  // Keep valid entries for tiles not selected this run; current-run metadata always wins.
  const manifest = { generatedAt: null, source: `IRSA SIA2 ${v.collection} spectral-image MEFs`, options: { ...opts, collection: v.collection }, tiles: priorTiles }

  const results = []
  const jobs = tiles.map((t) => async () => {
    const entry = { ra: t.ra, dec: t.dec, sizeDeg: t.size, status: 'pending', covering: 0 }
    try {
      const obs = await querySia(t.ra, t.dec, v.band, v.collection)
      entry.covering = obs.length
      if (!obs.length) entry.status = 'no-coverage'
      else {
        const pair = pickPair(obs, opts)
        if (!pair) entry.status = 'no-pair'
        else {
          const epochs = {}
          for (const [k, o] of [['a', pair.a], ['b', pair.b]]) {
            epochs[k] = {
              obsId: o.obsId, band: o.band, date: o.date, mjd: +o.mjd.toFixed(4),
              wavelengthUm: [+o.wlMin.toFixed(4), +o.wlMax.toFixed(4)], sourceUrl: o.url,
              cutoutUrl: cutoutUrl(o.url, t.ra, t.dec, t.size), file: `raw/${t.id}-${k}.fits`, bytes: null,
            }
          }
          entry.gapDays = +pair.gapDays.toFixed(1); entry.dWavelengthUm = +pair.dWlUm.toFixed(4); entry.epochs = epochs
          if (v['dry-run']) entry.status = 'dry-run'
          else {
            for (const k of ['a', 'b']) epochs[k].bytes = await downloadCutout(epochs[k].cutoutUrl, new URL(`${t.id}-${k}.fits`, rawDir))
            entry.status = 'ok'
          }
        }
      }
    } catch (e) { entry.status = 'failed'; entry.error = e.message }
    manifest.tiles[t.id] = entry
    results.push([t.id, entry])
    const e = entry.epochs
    console.log(`${t.id.padEnd(18)} ${entry.status.padEnd(12)} covering=${entry.covering}` + (e ? `  ${e.a.band}  ${e.a.date} → ${e.b.date}  (${entry.gapDays} d, Δλ ${entry.dWavelengthUm} µm)` : '') + (entry.error ? `  ${entry.error}` : ''))
  })
  const pool = Array.from({ length: Math.max(1, Math.min(8, Math.round(num('concurrency', v.concurrency)))) }, async () => { while (jobs.length) await jobs.shift()() })
  await Promise.all(pool)

  if (!v['dry-run']) {
    manifest.generatedAt = new Date().toISOString()
    await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n')
    console.log(`\nManifest: ${manifestUrl.pathname}`)
  }
  const count = (s) => results.filter(([, e]) => e.status === s).length
  console.log(`\nok ${count('ok') + count('dry-run')}  no-coverage ${count('no-coverage')}  no-pair ${count('no-pair')}  failed ${count('failed')}`)
  if (count('failed')) process.exitCode = 1
  console.log(`
Next steps (not done by this script):
  1. Convert each FITS cutout to the JPEGs the game shows (stretch, orientation East-left, same size for A and B).
  2. Check the cutouts are co-registered and the spectral WCS shows matching wavelength at the target pixel.
  3. Measure the moving source's a/b pixel positions for any mover tile, then update fixtures.ts.
  4. Fill the per-tile metadata panel from manifest.json instead of the hard-coded POSS text.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1) })
}
