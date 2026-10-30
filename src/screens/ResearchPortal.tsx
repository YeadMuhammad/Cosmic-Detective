import { useEffect, useMemo, useState } from 'react'
import { Btn } from '../components/ui'
import { navigate } from '../lib/util'
import { LEAD_RANK, rankFor } from '../data/fixtures'
import { useGame } from '../lib/store'
import { SquadPanel } from '../components/SquadPanel'
import type { FieldData } from '../lib/squad'

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

export function ResearchPortal() {
  const { s: game } = useGame()
  const canChoose = rankFor(game.tiles).n >= LEAD_RANK // only Rank 6 picks coordinates
  const [ra, setRa] = useState(DEMO_FIELDS[0].ra), [dec, setDec] = useState(DEMO_FIELDS[0].dec), [fov, setFov] = useState('6'), [seed, setSeed] = useState('42')
  const [bands, setBands] = useState<string[]>([...BANDS]), [frames, setFrames] = useState<Frame[]>([])
  const [activeKey, setActiveKey] = useState('')
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('Search the live IRSA SPHEREx archive for coverage at a sky position.'), [error, setError] = useState(false)
  const [view, setView] = useState<'bands' | 'raw'>('bands')
  const selectedFrames = useMemo(() => frames.filter((f) => bands.includes(f.band)), [frames, bands])
  const activeFrame = selectedFrames.find((f) => frameKey(f) === activeKey) ?? selectedFrames[0] ?? null
  const timePoints = selectedFrames.map((frame) => ({ frame, time: frame.time })).filter((point) => Number.isFinite(point.time))
  const timeMin = timePoints.length ? Math.min(...timePoints.map((point) => point.time)) : 0
  const timeMax = timePoints.length ? Math.max(...timePoints.map((point) => point.time)) : 1
  const explorerUrl = new URL('https://irsa.ipac.caltech.edu/applications/spherex/')
  explorerUrl.searchParams.set('api', 'spectral-images'); explorerUrl.searchParams.set('ra', ra); explorerUrl.searchParams.set('dec', dec); explorerUrl.searchParams.set('sr', `${Number(fov) / 120}d`)
  const toggleBand = (band: string) => setBands((xs) => xs.includes(band) ? xs.filter((x) => x !== band) : [...xs, band])
  const randomize = () => {
    if (!canChoose) { setRa((Math.random() * 360).toFixed(6)); setDec(((Math.asin(2 * Math.random() - 1) * 180) / Math.PI).toFixed(6)); return }
    const s = Math.max(1, Math.min(99, Math.floor(Number(seed) || 1))); setSeed(String(s))
    let x = s; const next = () => { x = (x * 9301 + 49297) % 233280; return x / 233280 }
    setRa((next() * 360).toFixed(6)); setDec((next() * 180 - 90).toFixed(6))
  }
  useEffect(() => { if (!canChoose) randomize() }, []) // lower ranks start on a random field
  const loadField = (f: FieldData) => {
    setRa(String(f.ra)); setDec(String(f.dec)); setFov(String(f.fov)); setBands(f.bands.length ? f.bands : [...BANDS])
    const fs = f.frames as Frame[]
    setFrames(fs); setActiveKey(fs[0] ? frameKey(fs[0]) : ''); setError(false)
    setStatus(`Assignment loaded: ${fs.length} observation${fs.length === 1 ? '' : 's'} at RA ${f.ra}, Dec ${f.dec}.`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const search = async (e: React.FormEvent) => {
    e.preventDefault(); setError(false); setFrames([])
    const r = Number(ra), d = Number(dec), size = Number(fov)
    if (!Number.isFinite(r) || r < 0 || r > 360 || !Number.isFinite(d) || d < -90 || d > 90 || !Number.isFinite(size) || size <= 0 || size > 30) {
      setError(true); setStatus('Enter RA 0–360°, Dec −90–90°, and a field size above 0 and at most 30 arcmin.'); return
    }
    if (!bands.length) { setError(true); setStatus('Select at least one detector band.'); return }
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
  return <div className="screen case-screen research-screen" style={{ ['--accent' as any]: '#ffd84a' }}>
    <div className="case-bar"><div className="case-id"><span className="mono kicker">CH 5 · LIVE ARCHIVE</span><h1 className="display">Open Sky Research Portal</h1></div><div className="case-actions"><Btn variant="ghost" onClick={() => navigate('/map')}>Case board</Btn></div></div>
    <p className="lede">Query calibrated SPHEREx QR3 and QR2 spectral images by ICRS position. Coverage changes as new archive releases arrive.</p>
    {!canChoose && <p className="soft">Choosing your own coordinates unlocks at Rank {LEAD_RANK}. Until then your field is random, or set by your squad leader.</p>}
    <form className="research-form" onSubmit={search}>
      <label>RA (deg, ICRS)<input type="number" min="0" max="360" step="any" required disabled={!canChoose} value={ra} onChange={(e) => setRa(e.target.value)} /></label>
      <label>Dec (deg, ICRS)<input type="number" min="-90" max="90" step="any" required disabled={!canChoose} value={dec} onChange={(e) => setDec(e.target.value)} /></label>
      <label>Field size (arcmin)<input type="number" min="0.5" max="30" step="any" value={fov} onChange={(e) => setFov(e.target.value)} /></label>
      <label>Random seed (1–99)<span className="seed-row"><input type="number" min="1" max="99" disabled={!canChoose} value={seed} onChange={(e) => setSeed(e.target.value)} /><button type="button" className="research-link" onClick={randomize}>Random position</button></span></label>
      <label>Example field<select value="" disabled={!canChoose} onChange={(e) => { const demo = DEMO_FIELDS[Number(e.target.value)]; if (demo) { setRa(demo.ra); setDec(demo.dec); setFov('6') } }}><option value="">Choose a sample position</option>{DEMO_FIELDS.map((demo, i) => <option key={demo.label} value={i}>{demo.label}</option>)}</select></label>
      <fieldset className="band-checks"><legend>Detector bands</legend>{BANDS.map((band) => <label key={band}><input type="checkbox" checked={bands.includes(band)} onChange={() => toggleBand(band)} />{band} <small>{WAVE[band]}</small></label>)}</fieldset>
      <Btn disabled={busy}>{busy ? 'Searching IRSA…' : 'Fetch live SPHEREx data'}</Btn>
    </form>
    <div className={`research-status ${error ? 'error' : ''}`} role="status">{status}</div>
    <div className="research-tools"><div className="research-tabs">
      <button type="button" disabled title="Requires registered multi-epoch images." >Blink Comparator</button>
      <button type="button" disabled title="Requires registered multi-epoch images." >Difference</button>
      <button type="button" className={view === 'bands' ? 'on' : ''} onClick={() => setView('bands')}>Bands</button>
      <button type="button" disabled title="Requires source photometry extracted from multiple observations." >Light Curve</button>
      <button type="button" className={view === 'raw' ? 'on' : ''} onClick={() => setView('raw')}>Raw series</button>
      <button type="button" disabled title="Requires a measured time series and candidate period." >Phase fold</button>
    </div>
      <span className="tool-unavailable">Bands and Raw series open in-page analysis views. Blink, Difference, Light Curve, and Phase fold require aligned image pixels or extracted source photometry.</span>
    </div>
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
        {activeFrame && <aside className="selected-observation"><div className="panel-title mono">SELECTED OBSERVATION</div><h3>{activeFrame.band} · {activeFrame.release.toUpperCase().replace('SPHEREX_', '')}</h3><p>{activeFrame.date}</p><p className="mono">{activeFrame.obs}</p><a href={activeFrame.cutout} target="_blank" rel="noreferrer">Open cutout FITS ↗</a><a href={activeFrame.url} target="_blank" rel="noreferrer">Open full MEF ↗</a><a href={explorerUrl.toString()} target="_blank" rel="noreferrer">View this field in SPHEREx Explorer ↗</a></aside>}
      </div>
      <p className="research-note">Detector images have wavelength that varies across the focal plane. FITS cutouts retain image, quality flags, variance, zodiacal model, PSF and wavelength metadata. The SPHEREx Explorer provides an interactive image view.</p>
    </section>}
    <SquadPanel field={{ ra: Number(ra), dec: Number(dec), fov: Number(fov), bands, frames: selectedFrames }} onOpenJob={loadField} />
    <p className="research-footnote">This screen searches IRSA’s public QR3 and QR2 wide-survey collections. For scientific photometry, use the released variance, pixel flags, PSF and spectral WCS products; a frame list alone is not a calibrated light curve.</p>
  </div>
}
