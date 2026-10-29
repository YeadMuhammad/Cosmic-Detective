#!/usr/bin/env node
// Finds and downloads SPHEREx Level 2 spectral-image CUTOUTS for the game's tiles
// from NASA/IPAC IRSA, and writes a manifest with the per-tile metadata the GDD
// asks for (observation dates, detector band, wavelength range).
//
// What it does, per tile (id, RA, Dec, size):
//   1. Asks IRSA's TAP service which SPHEREx spectral-image MEFs cover the position
//      (ADQL over spherex.artifact JOIN spherex.plane, exactly as in IRSA's own
//      "Download a collection of SPHEREx Spectral Image cutouts" tutorial).
//   2. Picks ONE pair of images: same detector band, observed between --min-gap-days
//      and --max-gap-days apart. Earlier = epoch A.
//   3. Downloads a small FITS cutout of each epoch. Full spectral-image MEFs are
//      hundreds of MB, so any response larger than --max-mb is aborted: that is the
//      tell-tale sign a server ignored the cutout parameters.
//   4. Records everything in data/spherex/manifest.json.
//
// WHY THIS VERSION CHANGED
// The previous version found images through the SIA2 service and appended
// `center=ra,dec&size=deg` to the returned access_url (then tried several guessed
// URL forms). Every attempt came back HTTP 503. IRSA's current cutout tutorial
// (https://caltech-ipac.github.io/irsa-tutorials/spherex/, updated 5 Mar 2026) uses
// a different, documented recipe, which this script now follows:
//     TAP:  SELECT a.uri, p.time_bounds_lower, ... FROM spherex.artifact a
//           JOIN spherex.plane p ON a.planeid = p.planeid
//           WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), p.poly)
//     URL:  https://irsa.ipac.caltech.edu/<a.uri>?center=<ra>,<dec>d&size=<deg>
// Note the `d` unit suffix on the center, and that the URL is built from the TAP
// artifact uri. TAP also sees new data right after weekly ingestion, without the
// ~1 day lag of SIA. The URL form that actually worked is recorded in
// manifest.options.preferredStrategy and is tried first on later runs. EVERY failed
// attempt is logged with its status and a snippet of the server's reply.
//
// If every request answers 503, the data service itself is unavailable (IRSA
// announces maintenance windows). Fix nothing — re-run later: finished tiles are
// skipped and TAP lookups are cached under <out>/cache/, so a re-run is cheap.
// --force re-does everything.
//
// The script is also polite to IRSA: downloads run one at a time with --delay-ms
// between them; 5xx/429 answers back off for tens of seconds (honouring Retry-After
// when sent); and after several consecutive 5xx files the run stops early instead of
// hammering the service.
//
// WAVELENGTH MATCHING — READ THIS
// SPHEREx uses linear variable filters, so the wavelength at a given sky position
// changes from exposure to exposure. Plane-level energy bounds describe the whole
// detector band, NOT the wavelength at your target, so they can only be a coarse
// filter. This script therefore records `wavelengthVerified: null` ("not checked").
// The true wavelength at the target pixel lives in the cutout's WCS-WAVE lookup
// table; scripts/fetch-spherex.py reads it (via astropy), can probe several
// candidate pairs until one really matches, and sets wavelengthVerified true/false.
// Use the Python script when the pair will be shown to players as "wavelength
// matched".
//
// What it does NOT do: convert FITS to the JPEGs the game displays, measure the
// moving source's a/b pixel positions, or verify registration (see "Next steps").
//
// Requirements: Node 18.3+ (global fetch, util.parseArgs, stream.Readable.fromWeb).
// No npm dependencies. The network side still needs a live check: run --dry-run,
// then a single --tile, before a full run.
//
// Usage:
//   node scripts/fetch-spherex.mjs --list
//   node scripts/fetch-spherex.mjs --dry-run                 # query + show pairs, download nothing
//   node scripts/fetch-spherex.mjs --tile barnard            # one tile (repeatable)
//   node scripts/fetch-spherex.mjs                           # every tile in fixtures.ts
//   node scripts/fetch-spherex.mjs --force                   # ignore manifest/cache, refetch all
//   node scripts/fetch-spherex.mjs --id test --ra 164.15 --dec 7.04 --size 0.1   # ad hoc
//
// Env: IRSA_ROOT overrides https://irsa.ipac.caltech.edu/ (testing / mirrors).

import { writeFile, mkdir, readFile, rename } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const IRSA_ROOT = (process.env.IRSA_ROOT || 'https://irsa.ipac.caltech.edu/').replace(/\/?$/, '/')
const TAP_ENDPOINT = `${IRSA_ROOT}TAP/sync`
const DEFAULT_FIXTURES = new URL('../src/data/fixtures.ts', import.meta.url)
const BANDS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']
const SAFE_TILE_ID = /^[A-Za-z0-9._-]+$/
const RESERVED_TILE_IDS = new Set(['__proto__', 'constructor', 'prototype'])
const isSafeTileId = (id) => typeof id === 'string' && SAFE_TILE_ID.test(id) && !RESERVED_TILE_IDS.has(id)
const USER_AGENT = 'cosmic-detective/0.1 (+https://github.com/YeadMuhammad/Cosmic-Detective)'

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

/**
 * ADQL for every SPHEREx spectral image covering (ra, dec), oldest first.
 * `cols` names optional spherex.plane columns found via TAP_SCHEMA (see detectPlaneColumns);
 * only columns that exist are selected, so a schema difference cannot break the query.
 */
export function buildCoverageQuery(ra, dec, band, cols = {}) {
  const sel = ['a.uri AS uri', 'p.time_bounds_lower AS t_lo', 'p.energy_bandpassname AS band']
  if (cols.tHi) sel.push(`p.${cols.tHi} AS t_hi`)
  if (cols.eLo) sel.push(`p.${cols.eLo} AS e_lo`)
  if (cols.eHi) sel.push(`p.${cols.eHi} AS e_hi`)
  const where = [`1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)`]
  if (band) where.push(`p.energy_bandpassname = 'SPHEREx-${band}'`)
  return `SELECT TOP 5000 ${sel.join(', ')} FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid ` +
    `WHERE ${where.join(' AND ')} ORDER BY p.time_bounds_lower`
}

export const buildTapUrl = (adql) =>
  `${TAP_ENDPOINT}?${new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: adql })}`

export const mjdToIso = (mjd) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10)

/** Absolute URL for a TAP artifact uri (relative like "ibe/data/spherex/..." or already absolute). */
export const absoluteUrl = (uri) => (/^https?:\/\//i.test(uri) ? uri : IRSA_ROOT + uri.replace(/^\/+/, ''))

/** One TAP row -> observation record. Returns null if the row is unusable. */
export function toObservation(r) {
  const uri = (r.uri ?? '').trim()
  if (!uri || !/\.fits/i.test(uri)) return null
  const tLo = parseFloat(r.t_lo)
  if (!Number.isFinite(tLo)) return null
  const tHiRaw = parseFloat(r.t_hi)
  const mjd = Number.isFinite(tHiRaw) ? (tLo + tHiRaw) / 2 : tLo
  // CAOM energy bounds are metres; tolerate values already in microns.
  const toUm = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? (n < 1e-3 ? n * 1e6 : n) : null }
  const wlMin = toUm(r.e_lo), wlMax = toUm(r.e_hi)
  const file = uri.split('?')[0].split('/').pop()
  return {
    obsId: file.replace(/\.fits.*$/i, ''),
    band: (r.band ?? '').trim().replace(/^SPHEREx-/i, ''),
    mjd, date: mjdToIso(mjd),
    wlMin, wlMax,
    wlMid: wlMin !== null && wlMax !== null ? (wlMin + wlMax) / 2 : null,
    uri,
  }
}

/**
 * Rank every acceptable epoch pair: same band, observed minGapDays..maxGapDays apart.
 * When plane-level wavelengths are known the midpoint difference must be <= wlTolUm and
 * smaller is better; then the larger time gap wins. Returns [{a, b, gapDays, dWlUm}], best first.
 * NOTE: plane-level energy bounds are a coarse match. SPHEREx uses linear variable
 * filters, so the true wavelength at the target pixel must be checked in the cutout's
 * spectral WCS before trusting a pair for blinking/subtraction (the Python script does).
 */
export function pickPairs(obs, { minGapDays, maxGapDays, wlTolUm }) {
  const pool = [...obs].sort((x, y) => x.mjd - y.mjd)
  const pairs = []
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j]
      if (a.obsId === b.obsId || a.band !== b.band) continue
      const gap = b.mjd - a.mjd
      if (gap < minGapDays || gap > maxGapDays) continue
      const known = a.wlMid !== null && b.wlMid !== null
      const dWl = known ? Math.abs(a.wlMid - b.wlMid) : null
      if (known && dWl > wlTolUm) continue
      pairs.push({ a, b, gapDays: gap, dWlUm: dWl })
    }
  }
  pairs.sort(comparePairs)
  return pairs
}

const comparePairs = (p, q) => {
  const pKnown = p.dWlUm !== null
  const qKnown = q.dWlUm !== null
  if (pKnown !== qKnown) return pKnown ? -1 : 1
  return (pKnown ? p.dWlUm - q.dWlUm : 0) || (q.gapDays - p.gapDays)
}

export function pickPair(obs, { minGapDays, maxGapDays, wlTolUm }) {
  const pool = [...obs].sort((x, y) => x.mjd - y.mjd)
  let best = null
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j]
      if (a.obsId === b.obsId || a.band !== b.band) continue
      const gap = b.mjd - a.mjd
      if (gap < minGapDays || gap > maxGapDays) continue
      const known = a.wlMid !== null && b.wlMid !== null
      const dWl = known ? Math.abs(a.wlMid - b.wlMid) : null
      if (known && dWl > wlTolUm) continue
      const pair = { a, b, gapDays: gap, dWlUm: dWl }
      if (best === null || comparePairs(pair, best) < 0) best = pair
    }
  }
  return best
}

/**
 * Cutout URL forms for a TAP artifact uri, most-likely first. The first is the exact
 * form from IRSA's SPHEREx cutout tutorial. `preferred` (a form that already worked
 * on a previous run) is moved to the front. A form only "wins" if it returns a small
 * FITS payload — see attemptFetch.
 */
export function cutoutCandidates(uri, ra, dec, sizeDeg, preferred) {
  const base = absoluteUrl(uri).split('?')[0]
  const make = (center) => `${base}?center=${center}&size=${sizeDeg}`
  const list = [
    { name: 'tap-uri?center=ra,decd&size', url: make(`${ra},${dec}d`) },
    { name: 'tap-uri?center=ra,dec&size', url: make(`${ra},${dec}`) },
  ]
  if (preferred) {
    const i = list.findIndex((c) => c.name === preferred)
    if (i > 0) list.unshift(list.splice(i, 1)[0])
  }
  return list
}

export const isFits = (buf) => buf.length > 2880 && buf.subarray(0, 9).toString('ascii') === 'SIMPLE  ='

// ---------------------------------------------------------------- network

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const retryAfterMs = (headers) => {
  const value = headers.get('retry-after')?.trim()
  if (!value) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds * 1000 : undefined
}
const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Runs fn up to `tries` times. Backs off linearly for ordinary errors and by tens of
 * seconds for 5xx/429 (or the server's Retry-After when it sends one). Errors flagged
 * noRetry (bad request, non-FITS body, oversized body) are thrown at once: retrying
 * the same URL cannot produce a different answer.
 */
async function withRetry(label, fn, { tries = 3, baseMs = 2000, serverMs = 30000 } = {}) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn()
    } catch (e) {
      if (e.noRetry) { console.log(`  ${label}: ${e.message} (not retryable)`); throw e }
      if (i === tries) { console.log(`  giving up on ${label}: ${e.message}`); throw e }
      const unit = e.status >= 500 || e.status === 429 ? serverMs : baseMs
      const wait = Math.min(300000, e.retryAfterMs ?? Math.round(unit * i * (0.75 + 0.5 * Math.random())))
      console.log(`  retry ${i}/${tries} ${label}: ${e.message} — waiting ${Math.round(wait / 1000)}s`)
      await sleep(wait)
    }
  }
  throw new Error('unreachable')
}

/** Reads the response body, refusing anything bigger than a cutout should ever be. */
async function readBodyCapped(res, capBytes, ac) {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > capBytes) {
    ac.abort()
    throw Object.assign(new Error(`body is ${declared} bytes > cap ${capBytes} — server ignored the cutout parameters and is sending the whole MEF`), { noRetry: true })
  }
  if (!res.body) return Buffer.from(await res.arrayBuffer())
  const chunks = []
  let total = 0
  for await (const chunk of Readable.fromWeb(res.body)) {
    total += chunk.byteLength
    if (total > capBytes) {
      ac.abort()
      throw Object.assign(new Error(`body exceeded cap ${capBytes} — server ignored the cutout parameters and is sending the whole MEF`), { noRetry: true })
    }
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** Turns a non-2xx response into an Error carrying .status, a body snippet and Retry-After. */
async function httpError(res) {
  let detail = ''
  try { detail = stripTags(await res.text()).slice(0, 200) } catch { /* ignore */ }
  const error = new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`)
  error.status = res.status
  if ([400, 401, 403, 404, 405, 410, 451].includes(res.status)) error.noRetry = true
  const retryAfter = retryAfterMs(res.headers)
  if (retryAfter !== undefined) error.retryAfterMs = retryAfter
  return error
}

/**
 * One GET that only accepts a small FITS payload. Non-2xx becomes an Error carrying
 * .status plus a snippet of the body; oversized or non-FITS bodies are noRetry errors.
 */
async function attemptFetch(url, capBytes, timeoutMs = 180000) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/fits, */*;q=0.8', 'User-Agent': USER_AGENT },
      signal: ac.signal,
      redirect: 'follow',
    })
    if (!res.ok) throw await httpError(res)
    const buf = await readBodyCapped(res, capBytes, ac)
    if (!isFits(buf)) {
      const ct = res.headers.get('content-type') ?? 'unknown content-type'
      const head = buf.subarray(0, 16).toString('ascii').replace(/[^\x20-\x7e]/g, '·')
      throw Object.assign(new Error(`response is not FITS (${ct}, ${buf.length} bytes, starts "${head}")`), { noRetry: true })
    }
    return buf
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError' || e.code === 'ABORT_ERR') {
      if (e.noRetry) throw e
      throw new Error(`aborted (timeout after ${timeoutMs} ms)`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** Runs an ADQL query against IRSA TAP and returns the CSV text. */
async function tapCsv(adql, tries = 3) {
  return withRetry('TAP query', async () => {
    const res = await fetch(buildTapUrl(adql), {
      headers: { Accept: 'text/csv, */*;q=0.5', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(120000),
    })
    if (!res.ok) throw await httpError(res)
    const t = await res.text()
    if (/^\s*(<\?xml|<VOTABLE)/i.test(t.slice(0, 200))) {
      throw Object.assign(new Error(`TAP returned XML instead of CSV — ${stripTags(t).slice(0, 200)}`), { noRetry: true })
    }
    return t
  }, { tries })
}

/** Which optional spherex.plane columns exist? Cached in <out>/cache/plane-columns.json. */
async function detectPlaneColumns(cacheFile, useCache) {
  if (useCache) { try { return JSON.parse(await readFile(cacheFile, 'utf8')) } catch { /* not cached */ } }
  try {
    const csv = await tapCsv(`SELECT column_name FROM TAP_SCHEMA.columns WHERE table_name = 'spherex.plane'`)
    const names = new Set(parseCsv(csv).map((r) => (r.column_name ?? '').toLowerCase()))
    const has = (n) => (names.has(n) ? n : null)
    const cols = { tHi: has('time_bounds_upper'), eLo: has('energy_bounds_lower'), eHi: has('energy_bounds_upper'), seen: names.size }
    if (names.size) { try { await writeFile(cacheFile, JSON.stringify(cols)) } catch { /* best effort */ } }
    else console.log('  TAP_SCHEMA listed no spherex.plane columns; using time_bounds_lower only (wavelength bounds unavailable)')
    return cols
  } catch (e) {
    console.log(`  could not read the TAP schema (${e.message}); using time_bounds_lower only (wavelength bounds unavailable)`)
    return { seen: 0 }
  }
}

async function queryCoverage(ra, dec, band, cols) {
  const rows = parseCsv(await tapCsv(buildCoverageQuery(ra, dec, band, cols), 4))
  const seen = new Set()
  return rows.map(toObservation).filter((o) => o && (!band || o.band === band) && !seen.has(o.obsId) && seen.add(o.obsId))
}

/**
 * Tries every cutout URL form until one returns a real FITS cutout, then writes it
 * (to a .part file first, so an interrupted run never leaves a half-written .fits).
 * Returns which form won so the manifest can record it and later files try it first.
 */
async function downloadCutout(candidates, dest, { tries, maxBytes }) {
  const name = dest.pathname.split('/').pop()
  const failures = []
  let lastErr
  for (const cand of candidates) {
    try {
      const buf = await withRetry(`${name} via ${cand.name}`, () => attemptFetch(cand.url, maxBytes), { tries, serverMs: 45000 })
      const part = new URL(`${dest.href}.part`)
      await writeFile(part, buf)
      await rename(part, dest)
      return { bytes: buf.length, via: cand.name, url: cand.url }
    } catch (e) {
      failures.push(e)
      lastErr = e
      console.log(`  ${name}: ${cand.name} → ${e.message}`)
    }
  }
  if (failures.some((e) => e.status >= 500)) lastErr.had5xx = true
  throw lastErr
}

/** Serialises downloads with a pause between them — IRSA asks for gentle scripted access. */
function makeGate(delayMs) {
  let tail = Promise.resolve()
  return (fn) => {
    const run = tail.then(fn, fn)
    tail = run.then(() => sleep(delayMs), () => sleep(delayMs))
    return run
  }
}

// ---------------------------------------------------------------- main

function usage() {
  console.log(`Usage: node scripts/fetch-spherex.mjs [options]
  --list                  print the tiles that would be processed and exit
  --dry-run               query IRSA and show chosen pairs; download nothing
  --tile <id>             only this tile id from fixtures.ts (repeatable)
  --id <s> --ra <deg> --dec <deg> [--size <deg>]   ad hoc position instead of fixtures
  --fixtures <path>       fixtures file to read tiles from (default src/data/fixtures.ts)
  --size <deg>            cutout size override for all tiles (default: each tile's own size)
  --band <D1..D6>         restrict to one SPHEREx detector band
  --min-gap-days <n>      minimum time between epochs (default 60)
  --max-gap-days <n>      maximum time between epochs (default 400)
  --wl-tol-um <x>         max plane-level wavelength difference in microns (default 0.02;
                          only applied when TAP provides energy bounds — coarse, see header)
  --out <dir>             output directory (default data/spherex)
  --concurrency <n>       parallel TAP lookups (default 3; downloads are always serial)
  --tries <n>             download attempts per cutout URL form (default 2)
  --delay-ms <n>          pause between downloads, be nice to IRSA (default 1000)
  --max-mb <n>            reject any "cutout" bigger than this, i.e. a full MEF (default 64)
  --force                 re-query and re-download even if manifest + files look complete
  --no-cache              ignore the cached TAP responses in <out>/cache/
  -h, --help              this text`)
}

async function main() {
  const { values: v } = parseArgs({
    options: {
      list: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      tile: { type: 'string', multiple: true }, id: { type: 'string' }, ra: { type: 'string' }, dec: { type: 'string' },
      fixtures: { type: 'string' }, size: { type: 'string' }, band: { type: 'string' },
      'min-gap-days': { type: 'string', default: '60' }, 'max-gap-days': { type: 'string', default: '400' },
      'wl-tol-um': { type: 'string', default: '0.02' }, out: { type: 'string', default: 'data/spherex' },
      concurrency: { type: 'string', default: '3' },
      tries: { type: 'string', default: '2' }, 'delay-ms': { type: 'string', default: '1000' }, 'max-mb': { type: 'string', default: '64' },
      force: { type: 'boolean' }, 'no-cache': { type: 'boolean' },
    },
  })
  if (v.help) return usage()
  if (v.band && !BANDS.includes(v.band)) throw new Error(`--band must be one of ${BANDS.join(', ')}`)
  const num = (name, x) => { const n = Number(x); if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`); return n }
  const opts = {
    minGapDays: num('min-gap-days', v['min-gap-days']), maxGapDays: num('max-gap-days', v['max-gap-days']),
    wlTolUm: num('wl-tol-um', v['wl-tol-um']),
  }
  if (opts.minGapDays > opts.maxGapDays) throw new Error('--min-gap-days must not exceed --max-gap-days')
  if (opts.wlTolUm < 0) throw new Error('--wl-tol-um must not be negative')
  const dl = {
    tries: Math.max(1, Math.round(num('tries', v.tries))),
    delayMs: Math.max(0, Math.round(num('delay-ms', v['delay-ms']))),
    maxBytes: Math.max(1, Math.round(num('max-mb', v['max-mb']))) * 1024 * 1024,
  }
  const validateTile = (tile) => {
    if (!isSafeTileId(tile.id)) {
      throw new Error(`Invalid tile id "${tile.id}": use only safe filename characters and not a reserved object key`)
    }
    if (!(tile.size > 0)) throw new Error(`--size must be positive for tile "${tile.id}"`)
    if (!(tile.ra >= 0 && tile.ra <= 360) || !(tile.dec >= -90 && tile.dec <= 90)) {
      throw new Error(`Tile "${tile.id}" has out-of-range coordinates (RA ${tile.ra}, Dec ${tile.dec})`)
    }
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
  const cacheDir = new URL('cache/', outDir)
  const manifestUrl = new URL('manifest.json', outDir)
  await mkdir(cacheDir, { recursive: true })
  if (!v['dry-run']) await mkdir(rawDir, { recursive: true })

  let priorTiles = {}
  let preferredStrategy = null
  try {
    const previous = JSON.parse(await readFile(manifestUrl, 'utf8'))
    if (previous.tiles && typeof previous.tiles === 'object' && !Array.isArray(previous.tiles)) {
      priorTiles = Object.fromEntries(Object.entries(previous.tiles).filter(([id]) => isSafeTileId(id)))
    }
    if (typeof previous.options?.preferredStrategy === 'string') preferredStrategy = previous.options.preferredStrategy
  } catch { /* first run or unreadable prior manifest */ }
  // Keep valid entries for tiles not selected this run; current-run metadata always wins.
  const manifest = {
    generatedAt: null,
    source: 'IRSA TAP spherex.artifact + spherex.plane (SPHEREx Level 2 spectral-image MEF cutouts)',
    options: { ...opts, band: v.band ?? null, tries: dl.tries, delayMs: dl.delayMs, maxMb: dl.maxBytes / 1048576, preferredStrategy: null },
    tiles: priorTiles,
  }
  // Parameters that decide WHICH pair is chosen; a reused manifest entry must match them.
  const params = { band: v.band ?? null, minGapDays: opts.minGapDays, maxGapDays: opts.maxGapDays, wlTolUm: opts.wlTolUm }
  const sameParams = (p) => !!p && Object.keys(params).every((k) => p[k] === params[k])

  // TAP lookups are cached per tile (keyed by band, validated against the tile's
  // coordinates) so a re-run after a service outage does not re-query IRSA.
  const useCache = !(v.force || v['no-cache'])
  const tapCacheUrl = (t) => new URL(`tap-${v.band ?? 'all'}-${t.id}.json`, cacheDir)
  const readTapCache = async (t) => {
    if (!useCache) return null
    try {
      const parsed = JSON.parse(await readFile(tapCacheUrl(t), 'utf8'))
      return (parsed && parsed.ra === t.ra && parsed.dec === t.dec && Array.isArray(parsed.obs)) ? parsed.obs : null
    } catch { return null }
  }
  const writeTapCache = async (t, obs) => {
    try { await writeFile(tapCacheUrl(t), JSON.stringify({ ra: t.ra, dec: t.dec, obs })) } catch { /* best effort */ }
  }
  let colsPromise
  const getCols = () => (colsPromise ??= detectPlaneColumns(new URL('plane-columns.json', cacheDir), useCache))

  // Returns the file's byte count when it is a valid FITS file, else 0.
  const fileOk = async (rel) => {
    try {
      if (!rel) return 0
      const buf = await readFile(new URL(rel, outDir))
      return isFits(buf) ? buf.length : 0
    } catch { return 0 }
  }

  // Circuit breaker: after this many files that 5xx'd on every URL form, assume the
  // cutout service is down and stop instead of hammering IRSA for the rest of the run.
  const breaker = { failures: 0, limit: 3, tripped: false }

  const gate = makeGate(dl.delayMs)
  const results = []
  let cachedCount = 0
  const jobs = tiles.map((t) => async () => {
    const entry = { ra: t.ra, dec: t.dec, sizeDeg: t.size, params, status: 'pending', covering: 0 }
    try {
      // Resume: an 'ok' entry for the same position/size/parameters whose two FITS files are still valid is reused.
      const prior = manifest.tiles[t.id]
      if (!v.force && prior?.status === 'ok' && prior.epochs && prior.ra === t.ra && prior.dec === t.dec &&
          prior.sizeDeg === t.size && sameParams(prior.params)) {
        const [szA, szB] = await Promise.all([fileOk(prior.epochs.a?.file), fileOk(prior.epochs.b?.file)])
        if (szA && szB) {
          cachedCount++
          results.push([t.id, prior])
          console.log(`${t.id.padEnd(18)} ${'cached'.padEnd(12)} covering=${prior.covering ?? '?'}  (manifest + files ok; --force refetches)`)
          return
        }
      }
      if (breaker.tripped) {
        entry.status = 'skipped'
        entry.error = 'cutout service unreachable earlier in this run (persistent 5xx) — re-run later; finished tiles are kept'
        manifest.tiles[t.id] = entry
        results.push([t.id, entry])
        console.log(`${t.id.padEnd(18)} skipped     ${entry.error}`)
        return
      }

      let obs = await readTapCache(t)
      if (obs) {
        console.log(`${t.id.padEnd(18)} using cached TAP lookup (${obs.length} rows)`)
      } else {
        obs = await queryCoverage(t.ra, t.dec, v.band, await getCols())
        await writeTapCache(t, obs)
      }
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
              wavelengthUm: o.wlMin !== null && o.wlMax !== null
                ? [+o.wlMin.toFixed(4), +o.wlMax.toFixed(4)]
                : null,
              wavelengthAtTargetUm: null,
              sourceUrl: absoluteUrl(o.uri),
              cutoutUrl: cutoutCandidates(o.uri, t.ra, t.dec, t.size)[0].url,
              file: `raw/${t.id}-${k}.fits`, bytes: null,
            }
          }
          entry.gapDays = +pair.gapDays.toFixed(1)
          entry.dWavelengthUm = pair.dWlUm === null ? null : +pair.dWlUm.toFixed(4)
          entry.wavelengthVerified = null // not checked here; fetch-spherex.py reads the WCS-WAVE table
          entry.epochs = epochs
          if (v['dry-run']) entry.status = 'dry-run'
          else {
            for (const k of ['a', 'b']) {
              // Reuse a file only if the previous manifest says it holds THIS observation.
              const prior = manifest.tiles[t.id]
              const sameObs = !v.force && prior?.ra === t.ra && prior?.dec === t.dec &&
                prior?.sizeDeg === t.size && prior?.epochs?.[k]?.obsId === epochs[k].obsId
              const existing = sameObs && (await fileOk(epochs[k].file))
              if (existing) {
                epochs[k].bytes = existing
                epochs[k].via = 'existing file'
                console.log(`  ${t.id}-${k}.fits: already on disk and valid (${existing} bytes)`)
                continue
              }
              const o = k === 'a' ? pair.a : pair.b
              const candidates = cutoutCandidates(o.uri, t.ra, t.dec, t.size, preferredStrategy)
              const got = await gate(() => downloadCutout(candidates, new URL(epochs[k].file, outDir), dl))
              epochs[k].bytes = got.bytes
              epochs[k].cutoutUrl = got.url
              epochs[k].via = got.via
              preferredStrategy ||= got.via
            }
            entry.status = 'ok'
          }
        }
      }
    } catch (e) {
      entry.status = 'failed'; entry.error = e.message
      if (e.had5xx || e.status >= 500) {
        breaker.failures++
        if (breaker.failures >= breaker.limit) {
          breaker.tripped = true
          console.log(`\n  ! ${breaker.failures} files in a row failed with 5xx — treating the service as down; remaining tiles will be skipped.\n`)
        }
      }
    }
    manifest.tiles[t.id] = entry
    results.push([t.id, entry])
    const ep = entry.epochs
    console.log(`${t.id.padEnd(18)} ${entry.status.padEnd(12)} covering=${entry.covering}` +
      (ep ? `  ${ep.a.band}  ${ep.a.date} → ${ep.b.date}  (${entry.gapDays} d${entry.dWavelengthUm === null ? '' : `, plane Δλ ${entry.dWavelengthUm} µm`})` : '') +
      (ep?.a?.via ? `  via ${ep.a.via}` : '') +
      (entry.error ? `  ${entry.error}` : ''))
  })
  const pool = Array.from({ length: Math.max(1, Math.min(8, Math.round(num('concurrency', v.concurrency)))) }, async () => { while (jobs.length) await jobs.shift()() })
  await Promise.all(pool)

  if (!v['dry-run']) {
    manifest.generatedAt = new Date().toISOString()
    manifest.options.preferredStrategy = preferredStrategy
    await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n')
    console.log(`\nManifest: ${manifestUrl.pathname}`)
  }
  const count = (s) => results.filter(([, e]) => e.status === s).length
  console.log(`\nok ${count('ok') + count('dry-run')} (${cachedCount} cached)  no-coverage ${count('no-coverage')}  no-pair ${count('no-pair')}  failed ${count('failed')}  skipped ${count('skipped')}`)
  if (count('failed') || count('skipped')) process.exitCode = 1
  console.log(`
Next steps (not done by this script):
  1. Check the true wavelength at each target pixel (cutout WCS-WAVE table). Run
     scripts/fetch-spherex.py for this: wavelengthVerified is null in this script's manifest.
  2. Convert each FITS cutout to the JPEGs the game shows (stretch, orientation East-left, same size for A and B).
  3. Check the cutouts are co-registered.
  4. Measure the moving source's a/b pixel positions for any mover tile, then update fixtures.ts.
  5. Fill the per-tile metadata panel from manifest.json instead of the hard-coded POSS text.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1) })
}
