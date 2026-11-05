#!/usr/bin/env node
// Builds the SPHEREx metadata registry and the per-target acceptance fixtures
// from a timestamped IRSA TAP metadata snapshot.
//
// What it does, per seeded target (deep fields, ecliptic-pole regions, and
// Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis):
//   1. Asks IRSA TAP which SPHEREx spectral-image artifacts cover the position
//      (spherex.artifact JOIN spherex.plane, the documented cutout query).
//   2. Writes the verbatim rows into snapshot.json, keyed by a timestamp —
//      the snapshot is the archive-metadata provenance of everything below.
//   3. Runs the pure adapter in src/lib/irsa.ts over the snapshot to group the
//      observations by footprint, detector channel, processing release, survey
//      pass and time, and labels the wavelength tier: plane-level energy bounds
//      stay coarse; the wavelength AT the target pixel is only set when
//      scripts/fetch-spherex.py verified the cutout's WCS-WAVE value.
//   4. Writes registry.json (the grouped registry the app reads) and
//      acceptance-fixtures.json, where every target's expected capabilities are
//      DERIVED from the snapshot with the app's own capabilitiesFor() — none of
//      them are hand-asserted. scripts/acceptance.test.mjs re-derives from the
//      committed snapshot and fails if they no longer match.
//
// Nothing here downloads pixels; cutouts stay with fetch-spherex.* (Step 0).
// Previous snapshots are preserved with --keep-old (moved into <out>/history/).
//
// Usage:
//   node scripts/build-spherex-registry.mjs --list
//   node scripts/build-spherex-registry.mjs [--targets barnard,wise-0855] [--force|--no-cache]
//
// Env: IRSA_ROOT overrides https://irsa.ipac.caltech.edu/ (testing / mirrors).

import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { parseCsv, absoluteUrl } from './fetch-spherex.mjs'
import { buildRegistryTarget, framesFromGroups } from '../src/lib/irsa.ts'
import { capabilitiesFor } from '../src/lib/spherex.ts'

const IRSA_ROOT = (process.env.IRSA_ROOT || 'https://irsa.ipac.caltech.edu/').replace(/\/?$/, '/')
const DEFAULT_OUT = 'data/spherex/registry'
const DEFAULT_MANIFEST = 'data/spherex/manifest.json'
const USER_AGENT = 'cosmic-detective/0.1 (+https://github.com/YeadMuhammad/Cosmic-Detective)'

/**
 * Registry seed targets from PLAN.md item 2: deep fields and ecliptic-pole
 * regions, plus the five named science targets. Coordinates are ICRS degrees.
 */
const SEED_TARGETS = [
  { id: 'goods-n', label: 'GOODS-N deep field', kind: 'deep-field', ra: 189.2280, dec: 62.2390, radiusDeg: 0.15 },
  { id: 'goods-s', label: 'GOODS-S deep field', kind: 'deep-field', ra: 53.1250, dec: -27.8390, radiusDeg: 0.15 },
  { id: 'cosmos', label: 'COSMOS deep field', kind: 'deep-field', ra: 150.1162, dec: 2.2054, radiusDeg: 0.15 },
  { id: 'nep', label: 'North ecliptic pole region', kind: 'ecliptic-pole', ra: 270.0, dec: 66.5607, radiusDeg: 0.1 },
  { id: 'sep', label: 'South ecliptic pole region', kind: 'ecliptic-pole', ra: 90.0, dec: -66.5607, radiusDeg: 0.1 },
  { id: 'barnard', label: "Barnard's Star", kind: 'named', ra: 269.4587, dec: 4.6090, radiusDeg: 0.08 },
  { id: 'epsilon-indi-b', label: 'Epsilon Indi B', kind: 'named', ra: 331.0420, dec: -56.7856, radiusDeg: 0.08 },
  { id: 'wise-0855', label: 'WISE 0855 (WISE J085510.83-071442.5)', kind: 'named', ra: 133.7954, dec: -7.2442, radiusDeg: 0.08 },
  { id: 'rw-aurigae', label: 'RW Aurigae', kind: 'named', ra: 76.9546, dec: 30.4036, radiusDeg: 0.08 },
  { id: 'r-draconis', label: 'R Draconis', kind: 'named', ra: 263.4830, dec: 56.4747, radiusDeg: 0.08 },
]

function usage() {
  console.log(`Usage: node scripts/build-spherex-registry.mjs [options]
  --list                print the seed targets and exit
  --targets <a,b,...>   only these seed targets (default: all)
  --out <dir>           output directory (default ${DEFAULT_OUT})
  --max-rows <n>        TAP row limit per target (default 5000)
  --delay-ms <n>        pause between TAP queries, be nice to IRSA (default 1200)
  --force               re-query IRSA, ignoring cached TAP responses
  --no-cache            ignore cached TAP responses in <out>/cache/
  --keep-old            move the previous snapshot into <out>/history/
  --manifest <path>     cutout manifest used for pixel-verified wavelengths (default ${DEFAULT_MANIFEST})
  -h, --help            this text`)
}

/** Optional spherex.plane columns needed by the query; cached per output dir. */
async function detectPlaneColumns(cacheFile, useCache) {
  if (useCache) { try { return JSON.parse(await readFile(cacheFile, 'utf8')) } catch { /* not cached */ } }
  try {
    const csv = await tapQuery(`SELECT column_name FROM TAP_SCHEMA.columns WHERE table_name = 'spherex.plane'`)
    const names = new Set(parseCsv(csv).map((r) => (r.column_name ?? '').toLowerCase()))
    const has = (n) => (names.has(n) ? `p.${n}` : null)
    const cols = { tHi: has('time_bounds_upper'), eLo: has('energy_bounds_lower'), eHi: has('energy_bounds_upper') }
    if (names.size) { try { await writeFile(cacheFile, JSON.stringify(cols)) } catch { /* best effort */ } }
    else console.log('  TAP_SCHEMA listed no spherex.plane columns; falling back to time_bounds_lower only')
    return cols
  } catch (e) {
    console.log(`  could not read the TAP schema (${e.message}); falling back to time_bounds_lower only`)
    return {}
  }
}

/** Runs an ADQL query against IRSA TAP and returns the CSV text. */
async function tapQuery(adql, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(`${IRSA_ROOT}TAP/sync?${new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: adql })}`, {
        headers: { Accept: 'text/csv, */*;q=0.5', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(120000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const text = await res.text()
      if (/^\s*(<\?xml|<VOTABLE)/i.test(text)) throw new Error('TAP returned XML instead of CSV')
      return text
    } catch (e) {
      if (attempt === tries) throw e
      console.log(`  TAP attempt ${attempt}/${tries} failed (${e.message}); waiting 30s`)
      await new Promise((r) => setTimeout(r, 30000))
    }
  }
  throw new Error('unreachable')
}

/** ADQL for ALL SPHEREx spectral-image artifacts covering (ra, dec), oldest first. */
function buildRegistryQuery(ra, dec, cols, maxRows, radiusDeg) {
  const sel = ['a.uri AS uri', 'p.time_bounds_lower AS t_lo']
  if (cols.tHi) sel.push(`${cols.tHi} AS t_hi`)
  sel.push('p.energy_bandpassname AS band')
  if (cols.eLo) sel.push(`${cols.eLo} AS e_lo`)
  if (cols.eHi) sel.push(`${cols.eHi} AS e_hi`)
  return `SELECT TOP ${maxRows} ${sel.join(', ')} FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid ` +
    `WHERE 1 = INTERSECTS(CIRCLE('ICRS', ${ra}, ${dec}, ${radiusDeg}), p.poly) ORDER BY p.time_bounds_lower`
}

/** Keep only the columns the adapter parses, so the snapshot stays small. */
function trimRow(row) {
  return {
    uri: row.uri ?? '',
    t_lo: row.t_lo ?? '',
    ...(row.t_hi !== undefined ? { t_hi: row.t_hi } : {}),
    ...(row.band !== undefined ? { band: row.band } : {}),
    ...(row.e_lo !== undefined ? { e_lo: row.e_lo } : {}),
    ...(row.e_hi !== undefined ? { e_hi: row.e_hi } : {}),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { values: v } = parseArgs({
    options: {
      list: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      targets: { type: 'string' }, out: { type: 'string' },
      'max-rows': { type: 'string', default: '5000' }, 'delay-ms': { type: 'string', default: '1200' },
      'no-cache': { type: 'boolean' }, force: { type: 'boolean' }, 'keep-old': { type: 'boolean' },
      manifest: { type: 'string' },
    },
  })
  if (v.help) return usage()
  if (v.list) { for (const t of SEED_TARGETS) console.log(`${t.id.padEnd(16)} ${t.kind.padEnd(14)} RA ${t.ra} Dec ${t.dec} r ${t.radiusDeg}°`); return }
  if (v.targets && !v.out) throw new Error('--targets requires --out so a partial build cannot overwrite the full registry.')
  const maxRows = Math.max(1, Math.round(Number(v['max-rows'])))
  const delayMs = Math.max(0, Math.round(Number(v['delay-ms'])))
  const useCache = !(v['no-cache'] || v.force)
  const selected = v.targets
    ? v.targets.split(',').map((id) => {
        const meta = SEED_TARGETS.find((t) => t.id === id.trim())
        if (!meta) throw new Error(`Unknown target "${id.trim()}" — must be one of: ${SEED_TARGETS.map((t) => t.id).join(', ')}`)
        return meta
      })
    : SEED_TARGETS

  const cwd = pathToFileURL(`${process.cwd()}/`)
  const outDir = new URL(`${(v.out || DEFAULT_OUT).replace(/\/?$/, '/')}`, cwd)
  const cacheDir = new URL('cache/', outDir)
  const snapshotUrl = new URL('snapshot.json', outDir)
  await mkdir(cacheDir, { recursive: true })

  // --keep-old: the previous snapshot becomes history; otherwise it is replaced.
  let archiveSnapshot = null
  if (v['keep-old'] && existsSync(snapshotUrl)) {
    try {
      const prior = JSON.parse(await readFile(snapshotUrl, 'utf8'))
      if (prior?.adapter === 'irsa-tap-spherex-v1' && prior.capturedAt) archiveSnapshot = prior.capturedAt
    } catch { /* keep the current snapshot if it cannot be archived */ }
  }

  const snapshot = {
    adapter: 'irsa-tap-spherex-v1',
    irsaRoot: IRSA_ROOT,
    capturedAt: null,
    perTargetMaxRows: maxRows,
    truncatedTargets: [],
    targets: {},
  }

  const planeColumns = await detectPlaneColumns(new URL('plane-columns.json', cacheDir), useCache)

  let queried = 0
  for (const meta of selected) {
    const cacheFile = new URL(`tap-${meta.id}.json`, cacheDir)
    let csv = null
    let cacheEntry = null
    if (useCache) {
      try {
        cacheEntry = JSON.parse(await readFile(cacheFile, 'utf8'))
        if (cacheEntry?.maxRows === maxRows && cacheEntry?.ra === meta.ra && cacheEntry?.dec === meta.dec && cacheEntry?.radiusDeg === meta.radiusDeg && JSON.stringify(cacheEntry?.columns) === JSON.stringify(planeColumns)) csv = cacheEntry.csv ?? null
      } catch { /* not cached */ }
    }
    if (!csv) {
      queried++
      if (queried > 1) await sleep(delayMs)
      console.log(`${meta.id.padEnd(16)} querying IRSA TAP …`)
      csv = await tapQuery(buildRegistryQuery(meta.ra, meta.dec, planeColumns, maxRows, meta.radiusDeg))
      cacheEntry = { ra: meta.ra, dec: meta.dec, radiusDeg: meta.radiusDeg, maxRows, columns: planeColumns, csv, fetchedAt: new Date().toISOString() }
      try { await writeFile(cacheFile, JSON.stringify(cacheEntry)) } catch { /* best effort */ }
    } else {
      console.log(`${meta.id.padEnd(16)} cached TAP rows`)
    }
    const rows = parseCsv(csv).map(trimRow)
    const truncated = rows.length >= maxRows
    snapshot.targets[meta.id] = { meta, truncated, rows, fetchedAt: cacheEntry?.fetchedAt ?? null }
    if (truncated) snapshot.truncatedTargets = [...snapshot.truncatedTargets, meta.id]
    console.log(`${meta.id.padEnd(16)} rows=${rows.length}${truncated ? `  (hit the ${maxRows}-row limit)` : ''}`)
  }

  const fetchTimes = Object.values(snapshot.targets).map((target) => target.fetchedAt)
  snapshot.capturedAt = fetchTimes.length && fetchTimes.every(Boolean)
    ? fetchTimes.sort()[0]
    : null

  // ---------------------------------------------------------------- registry
  const snapshotJson = JSON.stringify(snapshot)
  let manifestTiles = null
  const manifestUrl = new URL(v.manifest ?? DEFAULT_MANIFEST, cwd)
  if (existsSync(manifestUrl)) {
    try { manifestTiles = JSON.parse(await readFile(manifestUrl, 'utf8')).tiles ?? {} } catch { manifestTiles = null }
  }

  const registry = {
    adapter: 'irsa-tap-spherex-v1',
    snapshotCapturedAt: snapshot.capturedAt,
    generatedAt: snapshot.capturedAt,
    provenance: 'Derived from IRSA TAP spherex.artifact JOIN spherex.plane metadata (snapshot.json); no pixel data is stored here.',
    wavelengthPolicy: {
      planeBounds: 'Plane-level energy bounds describe the whole detector band; they are NOT the wavelength at the target pixel (linear variable filters).',
      wcsWave: "Wavelength at the target pixel is only recorded when the cutout's WCS-WAVE table was evaluated for that observation (scripts/fetch-spherex.py).",
    },
    targets: {},
  }
  const fixtures = {
    adapter: 'irsa-tap-spherex-v1',
    snapshotCapturedAt: snapshot.capturedAt,
    generatedAt: snapshot.capturedAt,
    derivation: 'Expected capabilities are DERIVED from snapshot.json via the app adapter (src/lib/irsa.ts) and capabilitiesFor() (src/lib/spherex.ts). Do not hand-edit.',
    targets: {},
  }
  for (const meta of selected) {
    const snap = snapshot.targets[meta.id]
    if (!snap) continue
    const target = buildRegistryTarget(meta, snap.rows, manifestTiles, snap.truncated)
    target.truncated = snap.truncated
    const observations = target.observations.map((o) => ({
      uri: absoluteUrl(o.uri),
      obsId: o.obsId,
      band: o.band,
      release: o.release,
      collection: o.collection,
      surveyPass: o.surveyPass,
      surveyWeek: o.surveyWeek,
      section: o.section,
      mjdStart: o.mjdStart,
      mjdEnd: o.mjdEnd,
      mjdMid: o.mjdMid,
      wavelengthBoundsUm: o.wavelengthBoundsUm,
      wavelengthTier: o.wavelengthTier ?? 'plane-bounds',
      wavelengthAtTargetUm: o.wavelengthAtTargetUm ?? null,
    }))
    registry.targets[meta.id] = {
      meta,
      truncated: target.truncated,
      summary: target.summary,
      wavelengthTier: target.wavelengthTier,
      wavelengthAtTargetUm: target.wavelengthAtTargetUm,
      groups: target.groups,
    }
    const frames = framesFromGroups(target.groups)
    fixtures.targets[meta.id] = {
      kind: meta.kind,
      label: meta.label,
      truncated: snap.truncated,
      snapshotRows: snap.rows.length,
      observations: observations.length,
      groups: target.groups.length,
      frames,
      expectedCapabilities: capabilitiesFor(frames),
    }
    console.log(`${meta.id.padEnd(16)} registry groups=${target.groups.length}  frames=${frames.length}`)
  }

  if (archiveSnapshot) {
    const historyDir = new URL('history/', outDir)
    await mkdir(historyDir, { recursive: true })
    await rename(snapshotUrl, new URL(`snapshot-${archiveSnapshot.replace(/[:.]/g, '-')}.json`, historyDir))
  }
  await writeFile(snapshotUrl, snapshotJson + '\n')
  await writeFile(new URL('registry.json', outDir), JSON.stringify(registry) + '\n')
  await writeFile(new URL('acceptance-fixtures.json', outDir), JSON.stringify(fixtures, null, 1) + '\n')
  console.log(`\nSnapshot : ${decodeURIComponent(snapshotUrl.pathname)} (${(snapshotJson.length / 1e6).toFixed(2)} MB)`)
  console.log(`Registry : ${outDir.pathname}registry.json`)
  console.log(`Fixtures : ${outDir.pathname}acceptance-fixtures.json`)
  console.log('Next: node --test scripts/acceptance.test.mjs')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`error: ${e.message}`); process.exit(1) })
}
