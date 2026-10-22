// Chapter 4 light curves.
//
// IMPORTANT: the series below are MODEL light curves, generated deterministically
// from published periods and depths (plus seeded noise). They are NOT archival
// photometry, and the UI says so ("Simulated from published ephemeris").
// To replace any of them with real photometry (TESS, Kepler, ZTF, AAVSO ...):
//   node scripts/import-lightcurve.mjs my_data.csv hd209458
// which writes public/lc/hd209458.json. Real files take priority over the model.

export type CurveKind = 'transit' | 'eclipse' | 'pulsation' | 'flare' | 'systematic' | 'flat'
export type SignalClass = 'periodic' | 'flare' | 'glitch' | 'none'

export interface CurveMeta {
  id: string
  code: string
  name: string
  kind: CurveKind
  period?: number // days
  span: number // days
  cadence: number // days
  noise: number // relative flux
  mission: string
  catalog?: { name: string; alias: string; note: string; rows: string[] }
  rejectNote?: string
}

export interface Series { t: number[]; f: number[]; e: number; real: boolean }

export const CURVES: Record<string, CurveMeta> = {
  hd209458: {
    id: 'hd209458', code: 'PEG-2094', name: 'HD 209458 field', kind: 'transit', period: 3.52475, span: 14, cadence: 1 / 48, noise: 0.0045, mission: 'Space photometry · 30 min cadence',
    catalog: { name: 'HD 209458', alias: 'Osiris · HD 209458 b', note: 'A Sun-like star in Pegasus. A planet about the size of Jupiter crosses its disc every 3.5 days, dimming it by roughly 1.5 percent. It was the first transiting planet ever seen.', rows: ['P 3.5247 d', 'depth ≈1.5%', 'd 159 ly'] },
  },
  algol: {
    id: 'algol', code: 'PER-0212', name: 'Algol field', kind: 'eclipse', period: 2.867321, span: 14, cadence: 1 / 24, noise: 0.012, mission: 'Photometry · hourly cadence',
    catalog: { name: 'Algol (β Persei)', alias: 'The Demon Star · HD 19356', note: 'An eclipsing binary. A dim giant passes in front of a bright star every 2.87 days and the light drops to about a third. Known to Arab astronomers for centuries.', rows: ['P 2.8673 d', 'depth ≈70%', 'd 90 ly'] },
  },
  deltacep: {
    id: 'deltacep', code: 'CEP-0584', name: 'δ Cephei field', kind: 'pulsation', period: 5.366341, span: 20, cadence: 1 / 8, noise: 0.012, mission: 'Photometry · 3 h cadence',
    catalog: { name: 'δ Cephei', alias: 'HD 213306', note: 'The prototype Cepheid. The star itself swells and shrinks, brightening quickly and fading slowly every 5.37 days. Cepheids measure distances across the universe.', rows: ['P 5.3663 d', 'ΔV ≈ 0.9 mag', 'd ~890 ly'] },
  },
  'wolf359-lc': {
    id: 'wolf359-lc', code: 'LEO-1057', name: 'Wolf 359 field', kind: 'flare', span: 3, cadence: 1 / 144, noise: 0.006, mission: 'Photometry · 10 min cadence',
    catalog: { name: 'Wolf 359', alias: 'CN Leonis · Gliese 406', note: 'A tiny, faint red dwarf and a flare star. Sudden magnetic outbursts make it flash for minutes at a time.', rows: ['flare star', 'M6 dwarf', 'd 7.9 ly'] },
  },
  'flat-oph': { id: 'flat-oph', code: 'OPH-0451', name: 'Ophiuchus comparison star', kind: 'flat', span: 14, cadence: 1 / 48, noise: 0.004, mission: 'Space photometry · 30 min cadence', rejectNote: 'Flat within the noise at every trial period. A quiet star is still a result.' },
  'flat-cyg': { id: 'flat-cyg', code: 'CYG-1932', name: 'Cygnus comparison star', kind: 'flat', span: 10, cadence: 1 / 24, noise: 0.009, mission: 'Photometry · hourly cadence', rejectNote: 'No repeating dips, no outbursts. The scatter is just photon noise.' },
  'sys-ramp': { id: 'sys-ramp', code: 'AQL-1911', name: 'Aquila field star', kind: 'systematic', span: 10, cadence: 1 / 48, noise: 0.003, mission: 'Space photometry · 30 min cadence', rejectNote: 'A thermal ramp after start-up plus a step when the pointing was reset. It happens once and never repeats, so it belongs to the instrument, not the star.' },
  'sys-spike': { id: 'sys-spike', code: 'LYR-1840', name: 'Lyra field star', kind: 'systematic', span: 8, cadence: 1 / 48, noise: 0.004, mission: 'Space photometry · 30 min cadence', rejectNote: 'Isolated one-frame spikes at random times: cosmic-ray hits. Real stars do not brighten for a single exposure.' },
}

export const CURVE_IDS = ['sys-ramp', 'algol', 'flat-oph', 'hd209458', 'wolf359-lc', 'sys-spike', 'deltacep', 'flat-cyg']

export const classOf = (k: CurveKind): SignalClass =>
  k === 'transit' || k === 'eclipse' || k === 'pulsation' ? 'periodic' : k === 'flare' ? 'flare' : k === 'systematic' ? 'glitch' : 'none'

// ------------------------------------------------------------ generation
function rng(seed: number) {
  let a = seed >>> 0
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const g = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u())
  return { u, g }
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)
const frac = (x: number) => x - Math.floor(x)
const sm = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }

function model(m: CurveMeta, t: number): number {
  const P = m.period ?? 1
  switch (m.kind) {
    case 'transit': {
      const d = Math.abs(frac((t - 0.9) / P + 0.5) - 0.5) * P // days from mid-transit
      const half = 0.0639, ing = 0.0105
      return 1 - 0.015 * Math.min(1, Math.max(0, (half + ing - d) / ing))
    }
    case 'eclipse': {
      const prim = Math.abs(frac((t - 0.7) / P + 0.5) - 0.5) * P
      const sec = Math.abs(frac((t - 0.7) / P) - 0.5) * P
      const prof = (d: number, depth: number) => (d < 0.2 ? depth * Math.cos((Math.PI * d) / 0.4) ** 1.6 : 0)
      return 1 - prof(prim, 0.69) - prof(sec, 0.04)
    }
    case 'pulsation': {
      const u = frac((t - 0.4) / P)
      const s = u < 0.18 ? sm(u / 0.18) : 1 - ((u - 0.18) / 0.82) ** 0.85
      return 1 + 0.39 * (2 * s - 1) * 0.9
    }
    default: return 1
  }
}

const cache: Record<string, Series> = {}
export function makeSeries(id: string): Series {
  if (cache[id]) return cache[id]
  const m = CURVES[id]
  const { u, g } = rng(hash(id))
  const t: number[] = [], f: number[] = []
  let red = 0
  const flares = [[0.55, 0.28], [1.4, 0.55], [2.35, 0.18]]
  const spikes = Array.from({ length: 6 }, () => [u() * m.span, (u() < 0.5 ? 1 : -1) * (0.03 + u() * 0.04)])
  for (let x = 0; x < m.span; x += m.cadence) {
    if (id === 'hd209458' && x > 6.0 && x < 6.5) continue // data gap, like an orbit break
    red = 0.7 * red + 0.3 * g() * m.noise
    let y = model(m, x) + g() * m.noise + (m.kind === 'flat' ? red : 0)
    if (m.kind === 'flare') for (const [t0, A] of flares) y += A * (x >= t0 ? Math.exp(-(x - t0) / 0.035) : Math.exp((x - t0) / 0.004))
    if (id === 'sys-ramp') y += 0.022 * Math.exp(-x / 0.9) + (x > 5.2 ? 0.012 : 0)
    if (id === 'sys-spike') for (const [ts, a] of spikes) if (Math.abs(x - ts) < m.cadence / 2) y += a
    t.push(x); f.push(y)
  }
  return (cache[id] = { t, f, e: m.noise, real: false })
}

let manifest: Promise<string[]> | null = null
const realFiles = () => (manifest ??= fetch('/lc/index.json').then((r) => (r.ok ? r.json() : { files: [] })).then((j) => (Array.isArray(j.files) ? j.files : [])).catch(() => []))

/** Real photometry listed in public/lc/index.json (written by scripts/import-lightcurve.mjs) takes priority over the model. */
export async function loadSeries(id: string): Promise<Series> {
  try {
    if ((await realFiles()).includes(id)) {
      const j = await (await fetch(`/lc/${id}.json`)).json()
      if (Array.isArray(j.t) && Array.isArray(j.f) && j.t.length === j.f.length && j.t.length > 20) return { t: j.t, f: j.f, e: j.e ?? CURVES[id].noise, real: true }
    }
  } catch { /* fall through to the model */ }
  return makeSeries(id)
}

// ------------------------------------------------------------ analysis (real computation on the series)
export interface Fold { z: number; r: number; bins: (number | null)[]; counts: number[]; phase: number[] }

/** Phase-fold at period P. z = significance of the folded profile; r = even/odd cycle agreement. */
export function fold(s: Series, P: number, nb = 24): Fold {
  const n = s.t.length
  const phase = s.t.map((x) => frac(x / P))
  const sum = new Array(nb).fill(0), sq = new Array(nb).fill(0), cnt = new Array(nb).fill(0)
  const es = new Array(nb).fill(0), ec = new Array(nb).fill(0), os = new Array(nb).fill(0), oc = new Array(nb).fill(0)
  let tot = 0
  for (let i = 0; i < n; i++) {
    const b = Math.min(nb - 1, Math.floor(phase[i] * nb)), y = s.f[i]
    sum[b] += y; sq[b] += y * y; cnt[b]++; tot += y
    if (Math.floor(s.t[i] / P) % 2 === 0) { es[b] += y; ec[b]++ } else { os[b] += y; oc[b]++ }
  }
  const mean = tot / n
  let within = 0, dof = 0, chi = 0
  for (let b = 0; b < nb; b++) if (cnt[b] > 1) { within += sq[b] - (sum[b] * sum[b]) / cnt[b]; dof += cnt[b] - 1 }
  const sig2 = within / Math.max(1, dof)
  let used = 0
  for (let b = 0; b < nb; b++) if (cnt[b] > 0) { chi += (cnt[b] * (sum[b] / cnt[b] - mean) ** 2) / sig2; used++ }
  const z = (chi - (used - 1)) / Math.sqrt(2 * Math.max(1, used - 1))
  const a: number[] = [], c: number[] = []
  for (let b = 0; b < nb; b++) if (ec[b] > 0 && oc[b] > 0) { a.push(es[b] / ec[b]); c.push(os[b] / oc[b]) }
  const ma = a.reduce((p, q) => p + q, 0) / (a.length || 1), mc = c.reduce((p, q) => p + q, 0) / (c.length || 1)
  let sab = 0, saa = 0, scc = 0
  a.forEach((v, i) => { sab += (v - ma) * (c[i] - mc); saa += (v - ma) ** 2; scc += (c[i] - mc) ** 2 })
  const r = saa > 0 && scc > 0 ? sab / Math.sqrt(saa * scc) : 0
  return { z: Number.isFinite(z) ? z : 0, r, bins: sum.map((v, b) => (cnt[b] ? v / cnt[b] : null)), counts: cnt, phase }
}

/** Count excursions above the quiescent level (median + 5 robust sigma), merged within 0.02 d. */
export function excursions(s: Series) {
  const sorted = [...s.f].sort((a, b) => a - b), med = sorted[sorted.length >> 1]
  const mad = [...s.f].map((v) => Math.abs(v - med)).sort((a, b) => a - b)[s.f.length >> 1] * 1.4826 || s.e
  const hits: { t: number; amp: number; n: number }[] = []
  s.f.forEach((v, i) => {
    if ((v - med) / mad > 5) {
      const last = hits[hits.length - 1]
      if (last && s.t[i] - last.t < 0.15) { last.amp = Math.max(last.amp, v - med); last.n++ }
      else hits.push({ t: s.t[i], amp: v - med, n: 1 })
    }
  })
  return { median: med, sigma: mad, hits }
}
/** Excursions that span more than one cadence are flares; single-frame ones are glitches. */
export function singleFrameHits(s: Series) {
  const { median, sigma } = excursions(s)
  let single = 0
  for (let i = 1; i < s.f.length - 1; i++) {
    const hi = (v: number) => Math.abs(v - median) / sigma > 5
    if (hi(s.f[i]) && !hi(s.f[i - 1]) && !hi(s.f[i + 1])) single++
  }
  return single
}

/** Largest deviation (in standard errors of the mean) of the first or last 5% of the series from the median. */
export function drift(s: Series) {
  const n = s.f.length, k = Math.max(5, Math.floor(n * 0.05))
  const med = [...s.f].sort((a, b) => a - b)[n >> 1]
  const sd = Math.sqrt(s.f.reduce((a, v) => a + (v - med) ** 2, 0) / n) || s.e
  const seg = (a: number, b: number) => { let m = 0; for (let i = a; i < b; i++) m += s.f[i]; return (m / (b - a) - med) / (sd / Math.sqrt(b - a)) }
  const first = seg(0, k), last = seg(n - k, n)
  return Math.abs(first) > Math.abs(last) ? first : last
}
