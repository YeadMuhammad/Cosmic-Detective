// Downloads the six-band cutout set (DSS1 Blue, DSS2 Red, 2MASS J/Ks, WISE W1/W2) for one sector
// from NASA SkyView, registered to the same grid, into public/sky/<id>-<band>.jpg.
// Usage: node scripts/fetch-bands.mjs <id> <ra_deg> <dec_deg> <size_deg>
// Then add the id to LIVE_BAND_SECTORS in src/data/fixtures.ts and give the compositor that sector's
// band files. NOTE: this script has not been run against the live service yet.
import { writeFile } from 'node:fs/promises'
const [id, ra, dec, size = '0.25'] = process.argv.slice(2)
if (!id || !ra || !dec) { console.error('usage: node scripts/fetch-bands.mjs <id> <ra> <dec> [size]'); process.exit(1) }
const BASE = 'https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl'
const BANDS = [['dss1b', 'DSS1 Blue'], ['dss2r', 'DSS2 Red'], ['2massj', '2MASS-J'], ['2massk', '2MASS-K'], ['w1', 'WISE 3.4'], ['w2', 'WISE 4.6']]
const failed = []
for (const [b, survey] of BANDS) {
  const q = new URLSearchParams({ Position: `${ra},${dec}`, Survey: survey, Pixels: '512', Size: size, Scaling: 'Log', Return: 'JPEG' })
  try {
    const res = await fetch(`${BASE}?${q}`, { signal: AbortSignal.timeout(150000) })
    const buf = Buffer.from(await res.arrayBuffer())
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 // SkyView can return an HTML error page with a 200
    if (res.ok && isJpeg && buf.length > 3000) { await writeFile(new URL(`../public/sky/${id}-${b}.jpg`, import.meta.url), buf); console.log('ok', id, b, buf.length) }
    else { console.error('FAILED', id, b, res.status); failed.push(b) }
  } catch (err) { console.error('FAILED', id, b, err.message); failed.push(b) }
}
if (failed.length) {
  console.error(`Incomplete band set for ${id}: missing ${failed.join(', ')}. Do not add it to LIVE_BAND_SECTORS; re-run the script.`)
  process.exit(1)
}
  const q = new URLSearchParams({ Position: `${ra},${dec}`, Survey: survey, Pixels: '512', Size: size, Scaling: 'Log', Return: 'JPEG' })
  const res = await fetch(`${BASE}?${q}`, { signal: AbortSignal.timeout(150000) })
  const buf = Buffer.from(await res.arrayBuffer())
  if (res.ok && buf.length > 3000) { await writeFile(new URL(`../public/sky/${id}-${b}.jpg`, import.meta.url), buf); console.log('ok', id, b, buf.length) } else console.log('FAILED', id, b, res.status)
}
