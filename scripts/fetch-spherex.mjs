#!/usr/bin/env node
// Finds and downloads SPHEREx Level 2 spectral-image CUTOUTS for the game's tiles
// from NASA/IPAC IRSA, and writes a manifest with the per-tile metadata the GDD
// asks for (observation dates, detector band, wavelength range).
//
// What it does, per tile (id, RA, Dec, size):
//   1. Asks IRSA's SIA2 service which SPHEREx spectral-image MEFs cover the position.
//   2. Picks ONE pair of images: same detector band, similar wavelength range,
//      observed between --min-gap-days and --max-gap-days apart. Earlier = epoch A.
//   3. Downloads a small FITS cutout of each epoch. Full spectral-image MEFs are
//      hundreds of MB, so any response larger than --max-mb is aborted: that is the
//      tell-tale sign a server ignored the cutout parameters.
//   4. Records everything in data/spherex/manifest.json.
//
// WHY THE PREVIOUS VERSION GOT HTTP 503 ON EVERY FILE
// It assumed that appending `center`/`size` to the SIA2 access_url always reaches
// IRSA's cutout service. That convention is documented for IBE-served collections
// (/ibe/data/... URLs, e.g. WISE/ZTF); SPHEREx holdings are not guaranteed to sit
// behind it, and a URL routed to a backend that does not serve it gets a fast
// 503 "Service Temporarily Unavailable" from IRSA's Apache front end while the SIA
// service keeps answering — exactly the pattern in the failing run (SIA lookups
// returned 240-352 rows between rounds of 503s, so the IP was not throttled; the
// cutout URL itself was the problem). This version probes the documented cutout URL
// forms, in order, and keeps the first that returns a real FITS cutout:
//     1. access_url + ?center=ra,dec&size=deg          (IBE-style; old behaviour)
//     2. access_url + ?center=ra<space>dec&size=deg    (space-separated variant)
//     3. IVOA SODA: /SODA?ID=<access_url>&POS=CIRCLE+ra+dec+radius
//     4. /data/<mission>/... rewritten to /ibe/data/<mission>/... + center/size/mos
//     5. bare access_url, no params (diagnostic: proves whether the file itself is
//        reachable while the cutout params are being ignored)
// The winning form is recorded in the manifest (options.preferredStrategy) and tried
// first afterwards. EVERY attempt is logged with its URL, so if all forms fail you can
// see exactly what was requested and compare with the collection's own programmatic
// access notes (https://irsa.ipac.caltech.edu/data/SPHEREx/ — the SPHEREx Spectral
// Image Viewer's network requests show the canonical cutout URLs).
//
// If EVERY form answers 503, the data service itself is unavailable (IRSA announces
// maintenance windows; they are Pacific-time nights). Fix nothing — re-run later:
// finished tiles are skipped and SIA lookups are cached under <out>/cache/, so a
// re-run costs almost nothing. --force re-does everything.
//
// The script is also polite to IRSA, which is a condition of scripted access:
// downloads run one at a time with --delay-ms between them; 5xx/429 answers back off
// for tens of seconds (honouring Retry-After when sent) instead of the old 1.5-4.5 s;
// and after several consecutive 5xx files the run stops early instead of hammering.
//
// What it does NOT do: convert FITS to the JPEGs the game displays, measure the
// moving source's a/b pixel positions, or verify registration. Those are separate
// steps (see "Next steps" printed at the end).
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

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const SIA_ENDPOINT = 'https://irsa.ipac.caltech.edu/SIA'
const SODA_ENDPOINT = 'https://irsa.ipac.caltech.edu/SODA'
const DEFAULT_FIXTURES = new URL('../src/data/fixtures.ts', import.meta.url)
const BANDS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']
const COLLECTIONS = new Set(['spherex_qr2', 'spherex_qr2_deep', 'spherex_qr3', 'spherex_qr3_deep'])
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

/**
 * Every documented cutout URL form for an IRSA access_url, most-likely first.
 * `preferred` (a form name that already worked this or a previous run) is moved to
 * the front. A form only "wins" if it returns a small FITS payload — see attemptFetch.
 */
export function cutoutCandidates(accessUrl, ra, dec, sizeDeg, preferred) {
  const radius = (sizeDeg / 2).toFixed(6)
  const base = new URL(accessUrl)
  const list = []
  const push = (name, u) => list.push({ name, url: u.href })

  {
    const u = new URL(base)
    u.searchParams.set('center', `${ra},${dec}`)
    u.searchParams.set('size', String(sizeDeg))
    push('access_url?center=ra,dec&size', u)
  }
  {
    const u = new URL(base)
    u.searchParams.set('center', `${ra} ${dec}`)
    u.searchParams.set('size', String(sizeDeg))
    push('access_url?center="ra dec"&size', u)
  }
  push('SODA?ID&POS=CIRCLE', new URL(`${SODA_ENDPOINT}?ID=${encodeURIComponent(base.href)}&POS=CIRCLE+${ra}+${dec}+${radius}`))
  if (/^\/data\//.test(base.pathname)) {
    const u = new URL(`https://irsa.ipac.caltech.edu/ibe/data${base.pathname}`)
    u.searchParams.set('center', `${ra},${dec}`)
    u.searchParams.set('size', String(sizeDeg))
    u.searchParams.set('mos', '0')
    push('ibe/data rewrite + center,size,mos', u)
  }
  push('bare access_url (diagnostic)', new URL(base))
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

/**
 * Runs fn up to `tries` times. Backs off linearly for ordinary errors and by tens of
 * seconds for 5xx/429 (or the server's Retry-After when it sends one). Errors flagged
 * noRetry (bad URL form, non-FITS body, oversized body) are thrown at once: retrying
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

/**
 * One GET that only accepts a small FITS payload. Non-2xx becomes an Error carrying
 * .status plus a snippet of the body (IRSA's 503 pages say what is wrong); oversized
 * or non-FITS bodies are noRetry errors.
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
    if (!res.ok) {
      let detail = ''
      try { detail = (await res.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) } catch { }
      const error = new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`)
      error.status = res.status
      if ([400, 401, 403, 404, 405, 410, 451].includes(res.status)) error.noRetry = true
      const retryAfter = retryAfterMs(res.headers)
      if (retryAfter !== undefined) error.retryAfterMs = retryAfter
      throw error
    }
    const buf = await readBodyCapped(res, capBytes, ac)
    if (!isFits(buf)) {
      const ct = res.headers.get('content-type') ?? 'unknown content-type'
      const head = buf.subarray(0, 16).toString('ascii').replace(/[^\x20-\x7e]/g, '·')
      throw Object.assign(new Error(`response is not FITS (${ct}, ${buf.length} bytes, starts "${head}")`), { noRetry: true })
    }
    return buf
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError' || e.code === 'ABORT_ERR') {
      throw new Error(`aborted (timeout after ${timeoutMs} ms)`)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function querySia(ra, dec, band, collection) {
  const text = await withRetry('SIA query', async () => {
    const res = await fetch(buildSiaUrl(ra, dec, band, collection), {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(120000),
    })
    const t = await res.text()
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status} ${t.slice(0, 200).replace(/\s+/g, ' ')}`)
      error.status = res.status
      const retryAfter = retryAfterMs(res.headers)
      if (retryAfter !== undefined) error.retryAfterMs = retryAfter
      throw error
    }
    return t
  }, { tries: 4 })
  const table = JSON.parse(text).VOTABLE?.RESOURCE_ARRAY?.at(-1)?.TABLE
  const fields = table?.FIELD_ARRAY?.map((field) => field['<xmlattr>']?.name)
  const rows = table?.DATA?.TABLEDATA
  if (!fields || !Array.isArray(rows)) throw new Error('SIA response did not contain a result table')
  const seen = new Set()
  return rows.map((row) => toObservation(Object.fromEntries(fields.map((name, i) => [name, row[i] ?? '']))))
    .filter((o) => o && (!band || o.band === band))
    .filter((o) => o && !seen.has(o.obsId) && seen.add(o.obsId))
}

/**
 * Tries every cutout URL form until one returns a real FITS cutout, then writes it.
 * Each form gets `tries` attempts (with backoff). Returns which form won so the
 * manifest can record it and later files try it first.
 */
async function downloadCutout(candidates, dest, { tries, maxBytes }) {
  const name = dest.pathname.split('/').pop()
  const failures = []
  let lastErr
  for (const cand of candidates) {
    try {
      const buf = await withRetry(`${name} via ${cand.name}`, () => attemptFetch(cand.url, maxBytes), { tries, serverMs: 45000 })
      await writeFile(dest, buf)
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
  --collection <name>     SIA2 collection (default spherex_qr2; also spherex_qr3[_deep] and spherex_qr2_deep)
  --min-gap-days <n>      minimum time between epochs (default 60)
  --max-gap-days <n>      maximum time between epochs (default 400)
  --wl-tol-um <x>         max midpoint-wavelength difference in microns (default 0.02)
  --out <dir>             output directory (default data/spherex)
  --concurrency <n>       parallel SIA lookups (default 3; downloads are always serial)
  --tries <n>             download attempts per cutout URL form (default 2)
  --delay-ms <n>          pause between downloads, be nice to IRSA (default 1000)
  --max-mb <n>            reject any "cutout" bigger than this, i.e. a full MEF (default 64)
  --force                 re-query and re-download even if manifest + files look complete
  --no-cache              ignore the cached SIA responses in <out>/cache/
  -h, --help              this text`)
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
      tries: { type: 'string', default: '2' }, 'delay-ms': { type: 'string', default: '1000' }, 'max-mb': { type: 'string', default: '64' },
      force: { type: 'boolean' }, 'no-cache': { type: 'boolean' },
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
    source: `IRSA SIA2 ${v.collection} spectral-image MEFs`,
    options: { ...opts, collection: v.collection, tries: dl.tries, delayMs: dl.delayMs, maxMb: dl.maxBytes / 1048576, preferredStrategy: null },
    tiles: priorTiles,
  }

  // SIA lookups are cached per tile (keyed by collection/band, validated against the
  // tile's coordinates) so a re-run after a service outage does not re-query IRSA.
  const siaCacheUrl = (t) => new URL(`sia-${v.collection}${v.band ? `-${v.band}` : ''}-${t.id}.json`, cacheDir)
  const readSiaCache = async (t) => {
    if (v.force || v['no-cache']) return null
    try {
      const parsed = JSON.parse(await readFile(siaCacheUrl(t), 'utf8'))
      return (parsed && parsed.ra === t.ra && parsed.dec === t.dec && Array.isArray(parsed.obs)) ? parsed.obs : null
    } catch { return null }
  }
  const writeSiaCache = async (t, obs) => {
    try { await writeFile(siaCacheUrl(t), JSON.stringify({ ra: t.ra, dec: t.dec, obs })) } catch { /* best effort */ }
  }
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
    const entry = { ra: t.ra, dec: t.dec, sizeDeg: t.size, status: 'pending', covering: 0 }
    try {
      // Resume: an 'ok' entry whose two FITS files are still valid is reused, not redone.
      const prior = manifest.tiles[t.id]
      if (!v.force && prior?.status === 'ok' && prior.epochs && prior.ra === t.ra && prior.dec === t.dec && prior.sizeDeg === t.size) {
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

      let obs = await readSiaCache(t)
      if (obs) {
        console.log(`${t.id.padEnd(18)} using cached SIA lookup (${obs.length} rows)`)
      } else {
        obs = await querySia(t.ra, t.dec, v.band, v.collection)
        await writeSiaCache(t, obs)
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
              wavelengthUm: [+o.wlMin.toFixed(4), +o.wlMax.toFixed(4)], sourceUrl: o.url,
              cutoutUrl: cutoutUrl(o.url, t.ra, t.dec, t.size), file: `raw/${t.id}-${k}.fits`, bytes: null,
            }
          }
          entry.gapDays = +pair.gapDays.toFixed(1); entry.dWavelengthUm = +pair.dWlUm.toFixed(4); entry.epochs = epochs
          if (v['dry-run']) entry.status = 'dry-run'
          else {
            for (const k of ['a', 'b']) {
              const existing = !v.force && (await fileOk(epochs[k].file))
              if (existing) {
                epochs[k].bytes = existing
                epochs[k].via = 'existing file'
                console.log(`  ${t.id}-${k}.fits: already on disk and valid (${existing} bytes)`)
                continue
              }
              const candidates = cutoutCandidates(epochs[k].sourceUrl, t.ra, t.dec, t.size, preferredStrategy)
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
          console.log(`\n  ! ${breaker.failures} files in a row failed with 5xx — treating the cutout service as down; remaining tiles will be skipped.\n`)
        }
      }
    }
    manifest.tiles[t.id] = entry
    results.push([t.id, entry])
    const ep = entry.epochs
    console.log(`${t.id.padEnd(18)} ${entry.status.padEnd(12)} covering=${entry.covering}` +
      (ep ? `  ${ep.a.band}  ${ep.a.date} → ${ep.b.date}  (${entry.gapDays} d, Δλ ${entry.dWavelengthUm} µm)` : '') +
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
  1. Convert each FITS cutout to the JPEGs the game shows (stretch, orientation East-left, same size for A and B).
  2. Check the cutouts are co-registered and the spectral WCS shows matching wavelength at the target pixel.
  3. Measure the moving source's a/b pixel positions for any mover tile, then update fixtures.ts.
  4. Fill the per-tile metadata panel from manifest.json instead of the hard-coded POSS text.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1) })
}