// Turns a real light curve CSV into public/lc/<id>.json for the Chapter 4 analyzer.
// Usage:  node scripts/import-lightcurve.mjs data.csv hd209458 [--tcol 0] [--fcol 1] [--days 14]
//
// Works with CSVs exported from MAST/TESS (via lightkurve or the MAST portal), Kepler/K2, ZTF,
// ASAS-SN or AAVSO. The first column is time (any unit of days, e.g. BTJD, BJD, JD) and the second
// is flux or magnitude-derived flux. Rows with non-numeric values are skipped.
// Magnitudes: pass --mag to convert to relative flux (brighter = larger).
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const [file, id, ...rest] = process.argv.slice(2)
if (!file || !id) { console.error('usage: node scripts/import-lightcurve.mjs data.csv <curve-id> [--tcol N] [--fcol N] [--days D] [--mag]'); process.exit(1) }
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d }
const tcol = opt('--tcol', 0), fcol = opt('--fcol', 1), days = opt('--days', 14), mag = rest.includes('--mag')

const rows = (await readFile(file, 'utf8')).split(/\r?\n/).map((l) => l.split(/[,\t ]+/).map(Number))
let pts = rows.map((r) => [r[tcol], r[fcol]]).filter(([t, f]) => Number.isFinite(t) && Number.isFinite(f))
if (mag) pts = pts.map(([t, m]) => [t, Math.pow(10, -0.4 * m)])
pts.sort((a, b) => a[0] - b[0])
const t0 = pts[0][0]
pts = pts.filter(([t]) => t - t0 <= days)
const sorted = pts.map((p) => p[1]).sort((a, b) => a - b)
const med = sorted[sorted.length >> 1]
const f = pts.map((p) => +(p[1] / med).toFixed(6))
const t = pts.map((p) => +(p[0] - t0).toFixed(5))
const dev = f.map((v) => Math.abs(v - 1)).sort((a, b) => a - b)
const e = +(1.4826 * dev[dev.length >> 1]).toFixed(5)
await mkdir(new URL('../public/lc/', import.meta.url), { recursive: true })
await writeFile(new URL(`../public/lc/${id}.json`, import.meta.url), JSON.stringify({ t, f, e }))
console.log(`wrote public/lc/${id}.json: ${t.length} points over ${t[t.length - 1].toFixed(2)} d, robust scatter ${(e * 100).toFixed(2)}%`)
// keep the manifest the app reads in sync
const idx = new URL('../public/lc/index.json', import.meta.url)
const files = existsSync(idx) ? JSON.parse(await readFile(idx, 'utf8')).files ?? [] : []
if (!files.includes(id)) files.push(id)
await writeFile(idx, JSON.stringify({ files }))
