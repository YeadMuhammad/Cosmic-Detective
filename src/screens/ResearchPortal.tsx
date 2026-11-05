import { useEffect, useMemo, useRef, useState } from 'react'
import { Btn } from '../components/ui'
import { navigate } from '../lib/util'
import { SquadPanel } from '../components/SquadPanel'
import type { FieldData } from '../lib/squad'
import { readFitsImage, renderFitsImage } from '../lib/fits'
import { capabilitiesFor, type Capabilities } from '../lib/spherex'
import { parseIRSASpectrophotometry, type ImportedIRSAResult } from '../lib/spherex-irsa'
import { buildLightCurve, lightCurveGroups, phaseFold } from '../lib/spherex-series'
import { loadSpherexRegistry, targetCapabilities, type SpherexRegistry } from '../lib/registry'
import snapshot from '../../data/spherex/manifest.json'
import type { SnapshotTile } from '../lib/spherex'

const BANDS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as const
const WAVE: Record<string, string> = { D1: '0.75–1.09 µm', D2: '1.10–1.62 µm', D3: '1.63–2.41 µm', D4: '2.42–3.82 µm', D5: '3.83–4.41 µm', D6: '4.42–5.00 µm' }
type Frame = { id: string; band: string; date: string; time: number; url: string; cutout: string; obs: string; release: string }
const COLLECTIONS = ['spherex_qr3', 'spherex_qr2'] as const
const DEMO_FIELDS = [
  { label: 'IRSA sample field', ra: '156.09328159', dec: '-41.64466331' },
  { label: 'Sample field · nearby east', ra: '156.0980', dec: '-41.64466331' },
  { label: 'Sample field · nearby north', ra: '156.09328159', dec: '-41.6400' },
]
const frameKey = (f: Frame) => `${f.obs}-${f.band}-${f.release}`
const snapshotGeneratedAt = snapshot.generatedAt
const snapshotTiles = snapshot.tiles as Record<string, SnapshotTile>

function rowsFromVOTable(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('IRSA returned an unreadable table response.')
  const statuses = [...doc.getElementsByTagName('*')].filter((el) => el.localName === 'INFO' && el.getAttribute('name') === 'QUERY_STATUS')
  const failed = statuses.find((el) => el.getAttribute('value') === 'ERROR')
  if (failed) throw new Error(failed.textContent?.trim() || 'IRSA rejected the archive query.')
  // VOTable uses an XML namespace; localName keeps this working whether IRSA
  // includes that namespace or changes its prefix.
  const fields = [...doc.getElementsByTagName('*')].filter((el) => el.localName === 'FIELD')
    .map((f) => (f.getAttribute('name') || f.getAttribute('ID') || '').toLowerCase())
  const tableData = [...doc.getElementsByTagName('*')].find((el) => el.localName === 'TABLEDATA')
  if (!tableData) throw new Error('IRSA returned a VOTable without a TABLEDATA result. Try again or open the SPHEREx Data Explorer.')
  const rows = [...tableData.getElementsByTagName('*')].filter((el) => el.localName === 'TR').map((tr) => {
    const cells = [...tr.getElementsByTagName('*')].filter((el) => el.localName === 'TD').map((td) => td.textContent?.trim() ?? '')
    return Object.fromEntries(fields.map((f, i) => [f, cells[i] ?? '']))
  })
  return { rows, overflow: statuses.some((el) => el.getAttribute('value') === 'OVERFLOW') }
}

function initialQuery() {
  const raw = window.location.hash.split('?')[1] ?? ''
  const query = new URLSearchParams(raw)
  return {
    ra: query.get('ra') ?? DEMO_FIELDS[0].ra,
    dec: query.get('dec') ?? DEMO_FIELDS[0].dec,
    fov: query.get('fov') ?? '6',
    source: query.get('source') === 'cached' ? 'cached' as const : 'live' as const,
  }
}

function updateQuery(ra: string, dec: string, fov: string) {
  const hash = window.location.hash.split('?')[0]
  window.history.replaceState(null, '', `${hash}?ra=${encodeURIComponent(ra)}&dec=${encodeURIComponent(dec)}&fov=${encodeURIComponent(fov)}`)
}

function coordinateMatches(result: ImportedIRSAResult | null, raText: string, decText: string): boolean {
  if (!result) return false
  const ra = Number(raText), dec = Number(decText)
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return false
  const deltaRa = ((ra - result.target.ra + 540) % 360) - 180
  return Math.hypot(deltaRa * Math.cos(dec * Math.PI / 180), dec - result.target.dec) * 3600 <= 6
}

function cachedFrames(ra: number, dec: number, fov: number): Frame[] {
  const radius = fov / 60
  const tile = Object.values(snapshotTiles)
    .filter((candidate) => candidate.epochs?.a?.cutoutUrl || candidate.epochs?.b?.cutoutUrl)
    .map((candidate) => ({ candidate, distance: Math.hypot((candidate.ra - ra) * Math.cos(dec * Math.PI / 180), candidate.dec - dec) }))
    .filter(({ candidate, distance }) => distance <= Math.max(radius, candidate.sizeDeg) / 2)
    .sort((a, b) => a.distance - b.distance)[0]?.candidate
  if (!tile?.epochs) return []
  return (['a', 'b'] as const).map((epoch) => {
    const item = tile.epochs?.[epoch]
    if (!item?.cutoutUrl || !item.sourceUrl) return null
    const cutout = new URL(item.cutoutUrl)
    cutout.searchParams.set('center', `${ra},${dec}`)
    cutout.searchParams.set('size', String(radius))
    const time = Number.isFinite(item.mjd) ? (item.mjd! - 40587) * 86400000 : Date.parse(item.date ?? '')
    return { id: item.obsId ?? `${epoch}-${tile.ra}-${tile.dec}`, band: item.band ?? 'unknown', date: item.date ?? 'Date unavailable', time, url: item.sourceUrl, cutout: cutout.toString(), obs: item.obsId ?? 'Cached observation', release: 'cached-live' }
  }).filter((frame): frame is Frame => !!frame)
}

function BrowseImage({ frame, onStart, onReady }: { frame: Frame; onStart: () => void; onReady: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    let active = true
    setState('loading')
    onStart()
    const url = import.meta.env.DEV ? `/spherex-cutout?url=${encodeURIComponent(frame.cutout)}` : `/.netlify/functions/spherex-cutout?url=${encodeURIComponent(frame.cutout)}`
    fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Cutout request failed (${response.status}).`)
      return response.arrayBuffer()
    }).then((buffer) => {
      if (!active || !canvas.current) return
      renderFitsImage(canvas.current, readFitsImage(buffer))
      setState('ready')
      onReady()
    }).catch(() => { if (active) { setState('error'); onReady() } })
    return () => { active = false }
  }, [frame])
  return <div className="research-image">
    <canvas ref={canvas} aria-label={`Rendered SPHEREx ${frame.band} cutout`} />
    {state !== 'ready' && <div className="research-image-state mono">{state === 'loading' ? 'Rendering FITS cutout…' : 'Cutout rendering unavailable. Open the FITS product for inspection.'}</div>}
  </div>
}

function MeasurementPlot({
  points,
  xLabel,
  yLabel,
  label,
}: {
  points: Array<{ x: number; y: number; error?: number }>
  xLabel: string
  yLabel: string
  label: string
}) {
  if (!points.length) return null
  const width = 760, height = 280, left = 64, right = 24, top = 20, bottom = 48
  const xMin = Math.min(...points.map((point) => point.x)), xMax = Math.max(...points.map((point) => point.x))
  const yMin = Math.min(...points.map((point) => point.y - (point.error ?? 0))), yMax = Math.max(...points.map((point) => point.y + (point.error ?? 0)))
  const xSpan = xMax - xMin || 1, ySpan = yMax - yMin || Math.max(1, Math.abs(yMax) * 0.1)
  const x = (value: number) => left + (value - xMin) / xSpan * (width - left - right)
  const y = (value: number) => top + (yMax - value) / ySpan * (height - top - bottom)
  return <svg className="research-timeline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    <line x1={left} x2={left} y1={top} y2={height - bottom} />
    <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
    {points.map((point, index) => <g key={`${point.x}-${index}`}>
      {point.error !== undefined && <><line x1={x(point.x)} x2={x(point.x)} y1={y(point.y - point.error)} y2={y(point.y + point.error)} /><line x1={x(point.x) - 3} x2={x(point.x) + 3} y1={y(point.y - point.error)} y2={y(point.y - point.error)} /><line x1={x(point.x) - 3} x2={x(point.x) + 3} y1={y(point.y + point.error)} y2={y(point.y + point.error)} /></>}
      <circle cx={x(point.x)} cy={y(point.y)} r="4" />
    </g>)}
    <text x={left} y={height - 12}>{xMin.toFixed(3)}</text><text x={width - right} y={height - 12} textAnchor="end">{xMax.toFixed(3)}</text>
    <text x="12" y={top + 8}>{yMax.toPrecision(4)}</text><text x="12" y={height - bottom}>{yMin.toPrecision(4)}</text>
    <text x={width / 2} y={height - 2} textAnchor="middle">{xLabel}</text><text x="14" y={height / 2} transform={`rotate(-90 14 ${height / 2})`} textAnchor="middle">{yLabel}</text>
  </svg>
}

export function ResearchPortal() {
  const initial = initialQuery()
  const [ra, setRa] = useState(initial.ra), [dec, setDec] = useState(initial.dec), [fov, setFov] = useState(initial.fov), [seed, setSeed] = useState('42')
  const [bands, setBands] = useState<string[]>([...BANDS]), [frames, setFrames] = useState<Frame[]>([])
  const [activeKey, setActiveKey] = useState('')
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('Search the live IRSA SPHEREx archive for coverage at a sky position.'), [error, setError] = useState(false)
  const [view, setView] = useState<'bands' | 'raw'>('bands')
  const [sourceMode, setSourceMode] = useState<'live' | 'cached'>(initial.source)
  const [provenance, setProvenance] = useState<'live' | 'cached-live'>('live')
  const [playing, setPlaying] = useState(false)
  const [readyFrames, setReadyFrames] = useState<Set<string>>(new Set())
  const [registry, setRegistry] = useState<SpherexRegistry | null>(null)
  const [registryTarget, setRegistryTarget] = useState('')
  const [irsaResult, setIrsaResult] = useState<ImportedIRSAResult | null>(null)
  const [irsaError, setIrsaError] = useState('')
  const [analysisTool, setAnalysisTool] = useState<'lightcurve' | 'phaseFold' | null>(null)
  const [analysisBand, setAnalysisBand] = useState('')
  const [analysisRelease, setAnalysisRelease] = useState<'qr2' | 'qr3' | ''>('')
  const [analysisPassband, setAnalysisPassband] = useState('')
  const [trialPeriodDays, setTrialPeriodDays] = useState('')
  useEffect(() => {
    let active = true
    loadSpherexRegistry().then((data) => { if (active) setRegistry(data) }).catch(() => { /* the portal still works without the registry asset */ })
    return () => { active = false }
  }, [])
  const selectedRegistry = registry?.targets[registryTarget] ?? null
  const registryCapabilities = useMemo<Capabilities | null>(() => (selectedRegistry ? targetCapabilities(selectedRegistry) : null), [selectedRegistry])
  const selectedFrames = useMemo(() => frames.filter((f) => bands.includes(f.band)), [frames, bands])
  const activeIRSAResult = coordinateMatches(irsaResult, ra, dec) ? irsaResult : null
  const capabilities = useMemo<Capabilities>(() => capabilitiesFor(activeIRSAResult?.observations ?? []), [activeIRSAResult])
  const curveGroups = activeIRSAResult ? lightCurveGroups(activeIRSAResult.observations) : []
  const availableBands = [...new Set(curveGroups.map((group) => group.band))]
  const effectiveBand = availableBands.includes(analysisBand) ? analysisBand : curveGroups[0]?.band ?? ''
  const availableReleases = curveGroups.filter((group) => group.band === effectiveBand).map((group) => group.release)
  const effectiveRelease = availableReleases.includes(analysisRelease as 'qr2' | 'qr3') ? analysisRelease as 'qr2' | 'qr3' : availableReleases[0]
  const passbandGroups = curveGroups.filter((group) => group.band === effectiveBand && group.release === effectiveRelease)
  const passbandKey = (wavelength: number, bandwidth: number) => `${wavelength.toFixed(4)}:${bandwidth.toFixed(4)}`
  const effectivePassband = passbandGroups.find((group) => passbandKey(group.wavelength, group.bandwidth) === analysisPassband) ?? passbandGroups[0]
  const lightCurve = effectiveBand && effectiveRelease && effectivePassband && activeIRSAResult
    ? buildLightCurve(activeIRSAResult.observations, effectiveBand, 3, effectiveRelease, effectivePassband.wavelength, effectivePassband.bandwidth)
    : null
  const periodResult = lightCurve?.available && trialPeriodDays
    ? phaseFold(lightCurve.value, Number(trialPeriodDays) * 86400000)
    : null
  const phaseReason = !lightCurve
    ? 'Requires validated live measurements in a matching bandpass.'
    : !lightCurve.available
      ? lightCurve.reason
      : periodResult && !periodResult.available
        ? periodResult.reason
        : 'Enter a trial period; at least six points spanning two cycles are required.'
  const phaseCapability = periodResult?.available
    ? { state: 'available' as const, reason: 'Validated same-channel photometry spans at least two trial-period cycles.' }
    : { state: 'unavailable' as const, reason: phaseReason }
  const analysisCapabilities = { ...capabilities, phaseFold: phaseCapability }
  const activeFrame = selectedFrames.find((f) => frameKey(f) === activeKey) ?? selectedFrames[0] ?? null
  const currentKey = activeFrame ? frameKey(activeFrame) : ''
  const activeIndex = activeFrame ? selectedFrames.findIndex((f) => frameKey(f) === frameKey(activeFrame)) : -1
  const timePoints = selectedFrames.map((frame) => ({ frame, time: frame.time })).filter((point) => Number.isFinite(point.time))
  const timeMin = timePoints.length ? Math.min(...timePoints.map((point) => point.time)) : 0
  const timeMax = timePoints.length ? Math.max(...timePoints.map((point) => point.time)) : 1
  const explorerUrl = new URL('https://irsa.ipac.caltech.edu/applications/spherex/')
  explorerUrl.searchParams.set('api', 'spectral-images'); explorerUrl.searchParams.set('ra', ra); explorerUrl.searchParams.set('dec', dec); explorerUrl.searchParams.set('sr', `${Number(fov) / 120}d`)
  const toggleBand = (band: string) => setBands((xs) => xs.includes(band) ? xs.filter((x) => x !== band) : [...xs, band])
  const pickRegistryTarget = (id: string) => {
    const target = registry?.targets[id]
    setRegistryTarget(id)
    if (!target) return
    const fovArcmin = String(+(target.meta.radiusDeg * 120).toFixed(1))
    setRa(String(target.meta.ra)); setDec(String(target.meta.dec)); setFov(fovArcmin)
    updateQuery(String(target.meta.ra), String(target.meta.dec), fovArcmin)
  }
  const randomize = () => {
    const s = Math.max(1, Math.min(99, Math.floor(Number(seed) || 1))); setSeed(String(s))
    let x = s; const next = () => { x = (x * 9301 + 49297) % 233280; return x / 233280 }
    setRa((next() * 360).toFixed(6)); setDec((next() * 180 - 90).toFixed(6))
  }
  useEffect(() => {
    if (!playing || selectedFrames.length < 2) return
    const id = window.setInterval(() => {
      if (!readyFrames.has(currentKey)) return
      const next = selectedFrames[(activeIndex + 1) % selectedFrames.length]
      if (next) setActiveKey(frameKey(next))
    }, 1400)
    return () => window.clearInterval(id)
  }, [playing, selectedFrames, activeIndex, currentKey, readyFrames])
  const loadField = (f: FieldData) => {
    setRa(String(f.ra)); setDec(String(f.dec)); setFov(String(f.fov)); setBands(f.bands.length ? f.bands : [...BANDS])
    const fs = f.frames as Frame[]
    setFrames(fs); setActiveKey(fs[0] ? frameKey(fs[0]) : ''); setError(false)
    setStatus(`Assignment loaded: ${fs.length} observation${fs.length === 1 ? '' : 's'} at RA ${f.ra}, Dec ${f.dec}.`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const search = async (e: React.FormEvent) => {
    e.preventDefault(); setError(false); setFrames([]); setIrsaResult(null); setAnalysisTool(null)
    const r = Number(ra), d = Number(dec), size = Number(fov)
    if (!Number.isFinite(r) || r < 0 || r > 360 || !Number.isFinite(d) || d < -90 || d > 90 || !Number.isFinite(size) || size <= 0 || size > 30) {
      setError(true); setStatus('Enter RA 0–360°, Dec −90–90°, and a field size above 0 and at most 30 arcmin.'); return
    }
    if (!bands.length) { setError(true); setStatus('Select at least one detector band.'); return }
    updateQuery(ra, dec, fov)
    if (sourceMode === 'cached') {
      const cached = cachedFrames(r, d, size)
      const filtered = cached.filter((frame) => bands.includes(frame.band))
      setFrames(filtered); setActiveKey(filtered[0] ? frameKey(filtered[0]) : ''); setProvenance('cached-live')
      setStatus(filtered.length
        ? `Cached snapshot selected explicitly (${snapshotGeneratedAt}); ${filtered.length} observation${filtered.length === 1 ? '' : 's'} loaded.`
        : `The cached snapshot (${snapshotGeneratedAt}) has no registered observation at this position.`)
      return
    }
    setProvenance('live')
    setBusy(true); setStatus('Querying IRSA for live SPHEREx QR3 and QR2 observations…')
    try {
      const endpoint = import.meta.env.DEV ? '/irsa-sia' : '/.netlify/functions/spherex-sia'
      const results = await Promise.allSettled(COLLECTIONS.map(async (release) => {
        const url = new URL(endpoint, window.location.origin)
        url.searchParams.set('COLLECTION', release)
        url.searchParams.set('POS', `CIRCLE ${r} ${d} ${size / 120}`)
        url.searchParams.set('RESPONSEFORMAT', 'VOTABLE')
        url.searchParams.set('MAXREC', '100')
        const response = await fetch(url, { signal: AbortSignal.timeout(52000) })
        if (!response.ok) throw new Error((await response.text()).trim() || `SPHEREx proxy returned HTTP ${response.status}.`)
        return { release, ...rowsFromVOTable(await response.text()) }
      }))
      const tables = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
      if (!tables.length) throw new Error(results.map((r) => r.status === 'rejected' ? (r.reason as Error).message : '').filter(Boolean).join(' '))
      const rows = tables.flatMap((table) => table.rows.map((row) => ({ row, release: table.release })))
      const found = rows.map(({ row, release }): Frame | null => {
        const source = row.access_url || row['access_url'] || ''
        const id = row.obs_id || row.obsid || source.split('/').pop() || 'SPHEREx observation'
        const match = `${id} ${source}`.match(/D([1-6])(?:\D|$)/i)
        const band = match ? `D${match[1]}` : ''
        if (!source || !band || !bands.includes(band)) return null
        const dateVal = row.t_min || row.time_bounds_lower || row.date_obs || ''
        const mjd = Number(dateVal)
        const time = Number.isFinite(mjd) && mjd > 30000 ? (mjd - 40587) * 86400000 : Date.parse(dateVal)
        const date = Number.isFinite(time) ? new Date(time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : dateVal || 'Date unavailable'
        let cutout: URL
        try { cutout = new URL(source) } catch { return null }
        if (cutout.protocol !== 'https:' && cutout.protocol !== 'http:') return null
        cutout.searchParams.set('center', `${r},${d}`); cutout.searchParams.set('size', String(size / 60))
        return { id, band, date, time, url: source, cutout: cutout.toString(), obs: row.obs_id || id, release }
      }).filter((f): f is Frame => !!f)
      found.sort((a, b) => (a.release === 'spherex_qr3' ? -1 : 1) - (b.release === 'spherex_qr3' ? -1 : 1) || (Number.isFinite(a.time) && Number.isFinite(b.time) ? a.time - b.time : 0))
      const seen = new Set<string>()
      const unique = found.filter((frame) => {
        const key = `${frame.obs}-${frame.band}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      unique.sort((a, b) => {
        const ta = Number.isFinite(a.time) ? a.time : Infinity
        const tb = Number.isFinite(b.time) ? b.time : Infinity
        return ta === tb ? 0 : ta < tb ? -1 : 1
      })
      setFrames(unique)
      setActiveKey(unique[0] ? frameKey(unique[0]) : '')
      const overflow = tables.some((table) => table.overflow || table.rows.length >= 100)
      const partial = tables.length !== COLLECTIONS.length
      setStatus(unique.length
        ? `${unique.length} live spectral image${unique.length === 1 ? '' : 's'} found across SPHEREx QR3 and QR2.${overflow ? ' One or both releases reached the 100-result limit; narrow the field for a complete set.' : ''}${partial ? ' One release could not be queried.' : ''}`
        : rows.length
          ? `IRSA returned ${rows.length} result${rows.length === 1 ? '' : 's'}, but none matched the selected detector bands. Try selecting all bands.${partial ? ' One release could not be queried.' : ''}`
          : `No matching QR2 or QR3 images cover this position and selected detector bands.${partial ? ' One release could not be queried, so this result may be incomplete.' : ' Try one of the example fields or a larger field size.'}`)
    } catch (err) {
      setError(true); setStatus(err instanceof DOMException && err.name === 'TimeoutError'
        ? 'The archive search took too long. Try a smaller field of view or fewer detector bands.'
        : err instanceof TypeError
          ? 'Could not reach the SPHEREx archive proxy. Check that the local dev server or deployed site functions are available.'
          : (err as Error).message)
    } finally { setBusy(false) }
  }
  const importIRSAFile = async (file?: File) => {
    setIrsaError(''); setIrsaResult(null); setAnalysisTool(null)
    if (!file) return
    try {
      const parsed = parseIRSASpectrophotometry(await file.text(), { ra: Number(ra), dec: Number(dec) })
      setIrsaResult(parsed)
      setAnalysisBand('')
      const eligibleRows = parsed.rows - parsed.rejected
      setStatus(eligibleRows
        ? `Imported ${parsed.rows} IRSA spectrophotometry rows; ${eligibleRows} pass the informational SOURCE/FULLSAMPLE flag gate and ${parsed.rejected} remain excluded from analysis.`
        : `Imported ${parsed.rows} rows for inspection, but none pass the informational SOURCE/FULLSAMPLE flag gate. Scientific tools remain unavailable.`)
    } catch (error) {
      setIrsaError((error as Error).message)
    }
  }
  const capabilityLabel = (id: keyof Capabilities) => {
    const capability = analysisCapabilities[id]
    return <span className={`capability-state ${capability.state}`}>{capability.state}</span>
  }
  return <div className="screen case-screen research-screen" style={{ ['--accent' as any]: '#ffd84a' }}>
    <div className="case-bar"><div className="case-id"><span className="mono kicker">CH 5 · LIVE ARCHIVE</span><h1 className="display">Open Sky Research Portal</h1></div><div className="case-actions"><Btn variant="ghost" onClick={() => navigate('/map')}>Case board</Btn></div></div>
    <p className="lede">Browse rendered SPHEREx QR3 and QR2 spectral images by ICRS position. This public view shows archive coverage; it does not claim that different wavelengths are a valid science comparison.</p>
    <form className="research-form" onSubmit={search}>
      <label>RA (deg, ICRS)<input type="number" min="0" max="360" step="any" required value={ra} onChange={(e) => setRa(e.target.value)} /></label>
      <label>Dec (deg, ICRS)<input type="number" min="-90" max="90" step="any" required value={dec} onChange={(e) => setDec(e.target.value)} /></label>
      <label>Field size (arcmin)<input type="number" min="0.5" max="30" step="any" value={fov} onChange={(e) => setFov(e.target.value)} /></label>
      <label>Data source<select value={sourceMode} onChange={(e) => setSourceMode(e.target.value as 'live' | 'cached')}><option value="live">Live IRSA archive</option><option value="cached">Cached snapshot ({snapshotGeneratedAt.slice(0, 10)})</option></select></label>
      <label>Random seed (1–99)<span className="seed-row"><input type="number" min="1" max="99" value={seed} onChange={(e) => setSeed(e.target.value)} /><button type="button" className="research-link" onClick={randomize}>Random position</button></span></label>
      <label>Example field<select value="" onChange={(e) => { const demo = DEMO_FIELDS[Number(e.target.value)]; if (demo) { setRa(demo.ra); setDec(demo.dec); setFov('6'); updateQuery(demo.ra, demo.dec, '6') } }}><option value="">Choose a sample position</option>{DEMO_FIELDS.map((demo, i) => <option key={demo.label} value={i}>{demo.label}</option>)}</select></label>
      <label>Registry target<select value={registryTarget} onChange={(e) => pickRegistryTarget(e.target.value)}><option value="">Choose a registered target</option>{Object.values(registry?.targets ?? {}).map((target) => <option key={target.meta.id} value={target.meta.id}>{target.meta.label}</option>)}</select></label>
      <fieldset className="band-checks"><legend>Detector bands</legend>{BANDS.map((band) => <label key={band}><input type="checkbox" checked={bands.includes(band)} onChange={() => toggleBand(band)} />{band} <small>{WAVE[band]}</small></label>)}</fieldset>
      <Btn disabled={busy}>{busy ? 'Searching IRSA…' : sourceMode === 'cached' ? 'Load selected cached snapshot' : 'Fetch live SPHEREx data'}</Btn>
    </form>
    <section className="registry-target" aria-label="Import validated IRSA spectrophotometry">
      <div className="panel-title mono">SCIENTIFIC INPUT · IRSA SPECTROPHOTOMETRY</div>
      <p>Run the official IRSA Spectrophotometry Tool for this coordinate, download its spectrum as a VOTable, then import it here. IRSA fits flux while holding your input position and morphology fixed; inspect its cutouts for centering and blends, and ensure the supplied morphology is appropriate for the source. The portal accepts only rows with documented units, matching target coordinates, QR2/QR3 release, detector and exposure provenance, finite uncertainties, and flags limited to informational SOURCE and/or FULLSAMPLE bits.</p>
      <a href="https://irsa.ipac.caltech.edu/applications/spherex/" target="_blank" rel="noreferrer">Open the official IRSA SPHEREx tools ↗</a>
      <label className="research-link">Import IRSA VOTable<input type="file" accept=".vot,.xml,application/xml,text/xml" onChange={(event) => void importIRSAFile(event.target.files?.[0])} /></label>
      {analysisCapabilities.lightcurve.state === 'available' && <label>Trial period for phase fold (days)<input type="number" min="0" step="any" value={trialPeriodDays} onChange={(event) => setTrialPeriodDays(event.target.value)} /></label>}
      {irsaError && <p className="research-status error" role="alert">{irsaError}</p>}
      {irsaResult && <p className="research-note" role="status">{irsaResult.source} · RA {irsaResult.target.ra}, Dec {irsaResult.target.dec} · {irsaResult.rows} points · {irsaResult.rows - irsaResult.rejected} pass the approved flag gate · {irsaResult.rejected} excluded by flags. {activeIRSAResult ? 'Imported data is held in this page only.' : 'The query coordinate changed; this import is inactive until you reload a matching result.'}</p>}
      {activeIRSAResult && activeIRSAResult.rejected > 0 && <details><summary>Review {activeIRSAResult.rejected} rows excluded by flags</summary><p>These rows are excluded from analysis because they contain flags beyond the documented informational SOURCE and FULLSAMPLE bits. IRSA says most flags are warnings rather than automatic rejection criteria; this portal does not yet model those flag-specific effects. Inspect values and fit quality against <a href="https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html" target="_blank" rel="noreferrer">IRSA's flag definitions and guidance</a> before deciding whether they are suitable for a separate workflow.</p><div className="research-table-wrap"><table className="research-table"><thead><tr><th>UTC</th><th>Flags</th><th>Fit quality</th><th>Flux (µJy)</th><th>Uncertainty (µJy)</th><th>Background (MJy/sr)</th><th>Wavelength (µm)</th><th>Detector</th><th>LVF exposure</th></tr></thead><tbody>{activeIRSAResult.observations.filter((observation) => observation.measurement && !observation.measurement.usable).map((observation, index) => { const point = observation.measurement!; return <tr key={`${point.time}-${index}`}><td>{new Date(point.time).toISOString()}</td><td>{point.flags}</td><td>{point.fitQuality}</td><td>{point.flux}</td><td>{point.uncertainty}</td><td>{point.backgroundFluxMJySr}</td><td>{point.wavelength.toFixed(4)}</td><td>{point.provenance.detector}</td><td>{point.provenance.exposureId}</td></tr> })}</tbody></table></div></details>}
    </section>
    {provenance === 'cached-live' && <div className="provenance-banner" role="status">CACHED-LIVE SNAPSHOT · {snapshotGeneratedAt} · Explicitly selected; this does not automatically replace unavailable live data.</div>}
    {selectedRegistry && registry && registryCapabilities && <section className="registry-target" aria-label="Registered target metadata">
      <div className="panel-title mono">REGISTRY TARGET · {selectedRegistry.meta.label.toUpperCase()}{selectedRegistry.truncated ? ' · TRUNCATED AT THE ROW LIMIT' : ''}</div>
      <p className="mono">{selectedRegistry.meta.kind} · RA {selectedRegistry.meta.ra}° Dec {selectedRegistry.meta.dec}° · {selectedRegistry.meta.radiusDeg}° radius</p>
      <p>Archive metadata snapshot {registry.snapshotCapturedAt}: {selectedRegistry.summary.groups} observation groups, {selectedRegistry.summary.items} observations across {selectedRegistry.summary.channels.length} channels — {selectedRegistry.summary.channels.map((channel) => `${channel.channel} (${channel.observations})`).join(' · ')}</p>
      <p>Survey passes: {selectedRegistry.summary.surveyPasses.join(', ') || 'none'} · Releases: {selectedRegistry.summary.releases.slice(0, 6).join(', ')}{selectedRegistry.summary.releases.length > 6 ? ' …' : ''}</p>
      <div className="capability-grid" aria-label="Registry-derived analysis capabilities">
        {(['blink', 'difference', 'lightcurve', 'phaseFold', 'spectrum'] as const).map((id) => <div className="capability-card" key={id}><strong>{({ blink: 'Blink', difference: 'Difference', lightcurve: 'Light Curve', phaseFold: 'Phase fold', spectrum: 'Spectrum' } as const)[id]}</strong><span className={`capability-state ${registryCapabilities[id].state}`}>{registryCapabilities[id].state}</span><p>{registryCapabilities[id].reason}</p></div>)}
      </div>
      <p className="research-note">{selectedRegistry.wavelengthTier === 'wcs-wave'
        ? `Wavelength evaluated at the target pixel (WCS-WAVE): ${selectedRegistry.wavelengthAtTargetUm} µm for at least one exposure.`
        : registry.wavelengthPolicy.planeBounds}</p>
      <p className="research-note">Registry capabilities are metadata-derived acceptance expectations, not claims about this sky position; scientific comparison tools stay disabled in browse mode.</p>
    </section>}
    <div className={`research-status ${error ? 'error' : ''}`} role="status">{status}</div>
    <div className="research-tools"><div className="research-tabs">
      <button type="button" disabled title="Requires registered multi-epoch images." >Blink Comparator</button>
      <button type="button" disabled title="Requires registered multi-epoch images." >Difference</button>
      <button type="button" className={view === 'bands' ? 'on' : ''} onClick={() => setView('bands')}>Bands</button>
      <button type="button" disabled={analysisCapabilities.lightcurve.state !== 'available'} title={analysisCapabilities.lightcurve.reason} onClick={() => setAnalysisTool('lightcurve')}>Light Curve</button>
      <button type="button" className={view === 'raw' ? 'on' : ''} onClick={() => setView('raw')}>Raw series</button>
      <button type="button" disabled={analysisCapabilities.phaseFold.state !== 'available'} title={analysisCapabilities.phaseFold.reason} onClick={() => setAnalysisTool('phaseFold')}>Phase fold</button>
    </div>
      <div className="capability-grid" aria-label="Metadata-derived analysis capabilities">
        {([
          ['blink', 'Blink Comparator', 'Blink'],
          ['difference', 'Difference', 'Difference'],
          ['lightcurve', 'Light Curve', 'Light Curve'],
          ['phaseFold', 'Phase fold', 'Phase fold'],
          ['spectrum', 'Spectrum', 'Spectrum'],
        ] as const).map(([id, label, button]) => <div className="capability-card" key={id}><strong>{label}</strong>{capabilityLabel(id)}<p>{analysisCapabilities[id].reason}</p>{analysisCapabilities[id].state === 'available' && ['lightcurve', 'phaseFold'].includes(id) ? <button type="button" onClick={() => setAnalysisTool(id as 'lightcurve' | 'phaseFold')}>{button}</button> : <button type="button" disabled title={analysisCapabilities[id].reason}>{button}</button>}</div>)}
      </div>
      <span className="tool-unavailable">Browse images remain display-only. Photometry tools need an imported, validated IRSA result. Pixel comparisons remain disabled pending image-level validation.</span>
    </div>
    {analysisTool && activeIRSAResult && <section className="research-results" aria-label={`${analysisTool} analysis`}>
      <div className="panel-title mono">VALIDATED IRSA DATA · {analysisTool.toUpperCase()}</div>
      {analysisTool === 'lightcurve' && <>
        <label>Same detector<select value={effectiveBand} onChange={(event) => setAnalysisBand(event.target.value)}>{availableBands.map((band) => <option key={band} value={band}>{band}</option>)}</select></label>
        <label>Calibration release<select value={effectiveRelease ?? ''} onChange={(event) => setAnalysisRelease(event.target.value as 'qr2' | 'qr3' | '')}>{availableReleases.map((release) => <option key={release} value={release}>{release.toUpperCase()}</option>)}</select></label>
        <label>Effective wavelength and bandwidth<select value={effectivePassband ? passbandKey(effectivePassband.wavelength, effectivePassband.bandwidth) : ''} onChange={(event) => setAnalysisPassband(event.target.value)}>{passbandGroups.map((group) => <option key={passbandKey(group.wavelength, group.bandwidth)} value={passbandKey(group.wavelength, group.bandwidth)}>{group.wavelength.toFixed(4)} µm ± {group.bandwidth.toFixed(4)} µm</option>)}</select></label>
        {lightCurve?.available ? <><p>{lightCurve.value.points.length} approved-flag points · {(lightCurve.value.baselineMs / 86400000).toFixed(5)} day baseline · {lightCurve.value.release.toUpperCase()} calibration only. Only informational SOURCE/FULLSAMPLE flag combinations are admitted. Points are grouped only when detector, release, central wavelength, and effective bandwidth agree to 0.0001 µm. Error bars show IRSA per-point flux_err; shared calibration covariance is not included. The imported flux assumes the position and morphology supplied to IRSA; check source motion, blends, cutouts, and morphology before interpreting variability. Its fit_ql values near 1 generally indicate better fits; inspect them point by point.</p><MeasurementPlot label="SPHEREx same-band light curve with reported flux uncertainties" points={lightCurve.value.points.map((point) => ({ x: (point.time - lightCurve.value.points[0].time) / 86400000, y: point.flux, error: point.uncertainty }))} xLabel="Time since first measurement (days)" yLabel="Flux (µJy)" /><p>IRSA reports the background estimate used for each fit. Review this same-band time series for changes that may affect interpretation of apparent variability. Background is surface brightness, not source flux; IRSA does not report an uncertainty for it.</p><MeasurementPlot label="IRSA fitted background surface brightness across the selected source measurements" points={lightCurve.value.points.map((point) => ({ x: (point.time - lightCurve.value.points[0].time) / 86400000, y: point.backgroundFluxMJySr }))} xLabel="Time since first measurement (days)" yLabel="Background (MJy/sr)" /><div className="research-table-wrap"><table className="research-table"><thead><tr><th>UTC</th><th>Flux (µJy)</th><th>Uncertainty (µJy)</th><th>Background (MJy/sr)</th><th>Wavelength (µm)</th><th>RA</th><th>Dec</th><th>LVF exposure</th><th>Flags</th><th>Fit quality</th></tr></thead><tbody>{lightCurve.value.points.map((point, index) => { const row = activeIRSAResult.observations.find((observation) => observation.measurement === point); return <tr key={`${point.time}-${index}`}><td>{new Date(point.time).toISOString()}</td><td>{point.flux}</td><td>{point.uncertainty}</td><td>{point.backgroundFluxMJySr}</td><td>{point.wavelength.toFixed(4)}</td><td>{row?.position?.ra}</td><td>{row?.position?.dec}</td><td>{point.provenance.exposureId}</td><td>{point.flags}</td><td>{point.fitQuality}</td></tr> })}</tbody></table></div></> : <p>{lightCurve && !lightCurve.available ? lightCurve.reason : 'No valid same-detector measurements.'}</p>}
      </>}
      {analysisTool === 'phaseFold' && <>
        <p>Phase zero is the first valid observation in the selected detector and release.</p>
        {periodResult?.available ? <><p>Periodic signal candidate · {periodResult.value.cycles.toFixed(2)} cycles covered · raw weighted χ² reduction {periodResult.value.foldedModelImprovement.toFixed(3)} versus a constant-flux model. This descriptive value does not account for added bin parameters or period trials and is not a false-alarm probability; it also omits shared calibration covariance.</p><MeasurementPlot label="SPHEREx trial-period phase fold with weighted flux uncertainties" points={periodResult.value.bins.map((bin) => ({ x: bin.phase, y: bin.flux, error: bin.uncertainty }))} xLabel="Phase (cycle)" yLabel="Flux (µJy)" /><div className="research-table-wrap"><table className="research-table"><thead><tr><th>Phase</th><th>Weighted flux (µJy)</th><th>Uncertainty (µJy)</th><th>Points</th></tr></thead><tbody>{periodResult.value.bins.map((bin) => <tr key={bin.phase}><td>{bin.phase.toFixed(3)}</td><td>{bin.flux.toFixed(4)}</td><td>{bin.uncertainty.toFixed(4)}</td><td>{bin.count}</td></tr>)}</tbody></table></div></> : <p>{periodResult && !periodResult.available ? periodResult.reason : 'Enter a trial period. At least six same-detector measurements spanning two cycles are required.'}</p>}
      </>}
    </section>}
    {selectedFrames.length > 0 && <section className="research-results"><div className="panel-title mono">{view === 'bands' ? 'BAND INSPECTOR' : 'RAW OBSERVATION TIMELINE'} · {selectedFrames.length} FILES</div>
      {view === 'bands' && <div className="coverage-strip">{BANDS.filter((b) => bands.includes(b)).map((b) => { const count = selectedFrames.filter((f) => f.band === b).length; return <div key={b}><b>{b}</b><span>{WAVE[b]}</span><strong>{count} {count === 1 ? 'image' : 'images'}</strong></div> })}</div>}
      {view === 'raw' && <div className="timeline-panel"><p>Each point is an archive image observation, not source brightness. Select a point or its row to inspect the file.</p>{timePoints.length ? <svg className="research-timeline" viewBox={`0 0 760 ${Math.max(100, BANDS.length * 28 + 30)}`} role="img" aria-label="Observation dates grouped by detector band">
        {BANDS.filter((b) => bands.includes(b)).map((band) => { const lane = BANDS.indexOf(band); return <g key={band}><text x="8" y={32 + lane * 28}>{band}</text><line x1="72" y1={28 + lane * 28} x2="744" y2={28 + lane * 28} /><title>{band} observation dates</title></g> })}
        {timePoints.map(({ frame, time }) => { const lane = BANDS.indexOf(frame.band as typeof BANDS[number]); const x = 72 + (timeMax === timeMin ? 0.5 : (time - timeMin) / (timeMax - timeMin)) * 672; return <circle key={frameKey(frame)} cx={x} cy={28 + lane * 28} r={frameKey(frame) === frameKey(activeFrame!) ? 6 : 4} className={frameKey(frame) === frameKey(activeFrame!) ? 'selected' : ''} onClick={() => setActiveKey(frameKey(frame))} /> })}
        <text x="72" y={Math.max(95, BANDS.length * 28 + 20)}>{new Date(timeMin).toISOString().slice(0, 10)}</text><text x="650" y={Math.max(95, BANDS.length * 28 + 20)}>{new Date(timeMax).toISOString().slice(0, 10)}</text>
      </svg> : <p>No usable observation dates were returned for this result set.</p>}</div>}
      <div className="research-workspace">
        <div className="research-table-wrap"><table className="research-table"><thead><tr><th>Observation date</th><th>Detector</th><th>Release</th><th>Observation ID</th></tr></thead><tbody>{selectedFrames.map((f) => <tr key={frameKey(f)} className={activeFrame && frameKey(f) === frameKey(activeFrame) ? 'active' : ''}>
          <td>{f.date}</td><td>{f.band}<small>{WAVE[f.band]}</small></td><td>{f.release.toUpperCase().replace('SPHEREX_', '')}</td><td><button className="research-row-select" onClick={() => setActiveKey(frameKey(f))} aria-pressed={!!activeFrame && frameKey(f) === frameKey(activeFrame)}>{f.obs}</button></td>
        </tr>)}</tbody></table></div>
        {activeFrame && <aside className="selected-observation"><div className="panel-title mono">SELECTED OBSERVATION</div><h3>{activeFrame.band} · {activeFrame.release.toUpperCase().replace('SPHEREX_', '')}</h3><p>{activeFrame.date}</p><p className="mono">{activeFrame.obs}</p><BrowseImage frame={activeFrame} onStart={() => setReadyFrames((previous) => { const next = new Set(previous); next.delete(currentKey); return next })} onReady={() => setReadyFrames((previous) => new Set(previous).add(currentKey))} /><div className="research-playback"><button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause playback' : 'Play series'}</button><span>{activeIndex + 1} / {selectedFrames.length}{playing && !readyFrames.has(currentKey) ? ' · loading' : ''}</span></div><a href={activeFrame.cutout} target="_blank" rel="noreferrer">Open cutout FITS ↗</a><a href={activeFrame.url} target="_blank" rel="noreferrer">Open full MEF ↗</a><a href={explorerUrl.toString()} target="_blank" rel="noreferrer">View this field in SPHEREx Explorer ↗</a></aside>}
      </div>
      <p className="research-note">Detector images have wavelength that varies across the focal plane. FITS cutouts retain image, quality flags, variance, zodiacal model, PSF and wavelength metadata. The SPHEREx Explorer provides an interactive image view.</p>
    </section>}
    <SquadPanel field={{ ra: Number(ra), dec: Number(dec), fov: Number(fov), bands, frames: selectedFrames }} onOpenJob={loadField} />
    <p className="research-footnote">This screen searches IRSA’s public QR3 and QR2 wide-survey collections. Import the official IRSA Spectrophotometry VOTable for quality-gated source measurements; an archive frame list alone is not a calibrated light curve. Image comparison and time-coherent spectra remain disabled pending their validation paths.</p>
  </div>
}
