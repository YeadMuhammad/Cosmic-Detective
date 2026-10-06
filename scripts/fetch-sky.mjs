// Downloads real archival sky cutouts from NASA SkyView (skyview.gsfc.nasa.gov)
// into public/sky/. Each tile is fetched twice: an early epoch (POSS-I, DSS1 Red,
// plates exposed 1949-1958) and a late epoch (POSS-II, DSS2 Red, ~1985-2000),
// resampled by SkyView onto the same J2000 grid so they can be blinked/subtracted.
// Run with: node scripts/fetch-sky.mjs
import { writeFile, mkdir } from 'node:fs/promises'

const OUT = new URL('../public/sky/', import.meta.url)
const BASE = 'https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl'

// id, ra, dec (tile centre, deg), size (deg)
const TILES = [
  ['barnard', 269.4587, 4.609, 0.25],
  ['wolf359', 164.1516, 7.0367, 0.12],
  ['lalande21185', 165.8404, 36.0083, 0.12],
  ['groombridge1830', 178.2041, 37.7654, 0.16],
  ['vanmaanen2', 12.2813, 5.4104, 0.08],
  ['field-oph', 270.62, 5.02, 0.15],
  ['field-aql', 285.0, 5.0, 0.15],
  ['m13', 250.4235, 36.4613, 0.2],
  ['m51', 202.4696, 47.1952, 0.2],
  ['vega', 279.2347, 38.7837, 0.2],
  ['albireo', 292.6804, 27.9597, 0.06],
  ['field-leo', 150.5, 20.2, 0.15],
]
const EPOCHS = [['a', 'DSS1 Red'], ['b', 'DSS2 Red']]
// Multi-band set for the Barnard's Star field (chapter 3 preview)
const BANDS = [
  ['dss1b', 'DSS1 Blue'], ['dss2r', 'DSS2 Red'], ['2massj', '2MASS-J'],
  ['2massk', '2MASS-K'], ['w1', 'WISE 3.4'], ['w2', 'WISE 4.6'],
]

async function get(file, survey, ra, dec, size, tries = 4) {
  const q = new URLSearchParams({ Position: `${ra},${dec}`, Survey: survey, Pixels: '512', Size: String(size), Scaling: 'Log', Return: 'JPEG' })
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${BASE}?${q}`, { signal: AbortSignal.timeout(150000) })
      const buf = Buffer.from(await res.arrayBuffer())
      if (res.ok && buf.length > 8000) { await writeFile(new URL(file, OUT), buf); console.log('ok', file, buf.length); return }
      console.log('retry', file, res.status, buf.length)
    } catch (e) { console.log('retry', file, e.message) }
  }
  console.log('FAILED', file)
}

await mkdir(OUT, { recursive: true })
const jobs = []
for (const [id, ra, dec, size] of TILES) for (const [ep, survey] of EPOCHS) jobs.push(() => get(`${id}-${ep}.jpg`, survey, ra, dec, size))
for (const [b, survey] of BANDS) jobs.push(() => get(`barnard-${b}.jpg`, survey, 269.4587, 4.609, 0.25))
// small concurrency pool to be polite to SkyView
const pool = Array.from({ length: 4 }, async () => { while (jobs.length) await jobs.shift()() })
await Promise.all(pool)
