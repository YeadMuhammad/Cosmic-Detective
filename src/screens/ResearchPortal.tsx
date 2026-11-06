import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Btn } from '../components/ui'
import { navigate } from '../lib/util'
import { SquadPanel } from '../components/SquadPanel'
import type { FieldData } from '../lib/squad'
import { readFitsImage, renderFitsImage } from '../lib/fits'
import { capabilitiesFor, type Capabilities } from '../lib/spherex'
import { parseIRSASpectrophotometry, type ImportedIRSAResult } from '../lib/spherex-irsa'
import { buildLightCurve, lightCurveGroups, phaseFold } from '../lib/spherex-series'
import { loadSpherexRegistry, type SpherexRegistry } from '../lib/registry'
import snapshot from '../../data/spherex/manifest.json'
import type { SnapshotTile } from '../lib/spherex'
import { requestProcessing } from '../lib/processing'

const BANDS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as const
const WAVE: Record<string, string> = { D1: '0.75–1.09 µm', D2: '1.10–1.62 µm', D3: '1.63–2.41 µm', D4: '2.42–3.82 µm', D5: '3.83–4.41 µm', D6: '4.42–5.00 µm' }
type Frame = { id: string; band: string; date: string; time: number; url: string; cutout: string; obs: string; release: string; collection: string; processingRelease: string }
type AnomalyReport = {
  id: string
  format: 'Cosmic Detective SPHEREx anomaly report'
  status: 'candidate-unverified'
  reportedAt: string
  classification: string
  notes: string
  target: { raDeg: number; decDeg: number; fieldSizeDeg: number }
  registeredBlink: {
    first: Record<string, unknown>
    second: Record<string, unknown>
    marker: { xFraction: number; yFraction: number; pixelX: number; pixelY: number; markedOn: 'A' | 'B' }
    passband: BlinkArtifact['targetPassband']
    allowedMismatchFraction: number
    grid: { width: number; height: number; pixelScaleArcsec: number }
  }
}
const ANOMALY_REPORTS_KEY = 'cosmic-detective:spherex-anomaly-reports:v1'
function loadAnomalyReports(): AnomalyReport[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(ANOMALY_REPORTS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item) => item?.format === 'Cosmic Detective SPHEREx anomaly report'
      && typeof item.id === 'string' && typeof item.reportedAt === 'string'
      && typeof item.classification === 'string' && typeof item.target?.raDeg === 'number'
      && typeof item.target?.decDeg === 'number') : []
  } catch { return [] }
}
function downloadAnomalyReport(report: AnomalyReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `spherex-anomaly-${report.id}.json`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const COLLECTIONS = ['spherex_qr3', 'spherex_qr2'] as const
const DEMO_FIELDS = [
  { label: 'IRSA sample field', ra: '156.09328159', dec: '-41.64466331' },
  { label: 'Sample field · nearby east', ra: '156.0980', dec: '-41.64466331' },
  { label: 'Sample field · nearby north', ra: '156.09328159', dec: '-41.6400' },
]
const frameKey = (f: Frame) => `${f.obs}-${f.band}-${f.release}`
const cutoutProxyUrl = (frame: Frame) => `${import.meta.env.DEV ? '/spherex-cutout' : '/.netlify/functions/spherex-cutout'}?url=${encodeURIComponent(frame.cutout)}`
const cutoutFilename = (frame: Frame) => `${`${frame.obs}-${frame.band}-${frame.release}`.replace(/[^a-zA-Z0-9._-]+/g, '_')}-cutout.fits`
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
  const table = [...doc.getElementsByTagName('*')].find((el) => el.localName === 'TABLE'
    && [...el.getElementsByTagName('*')].some((child) => child.localName === 'TABLEDATA'))
  if (!table) throw new Error('IRSA returned a VOTable without a TABLEDATA result. Try again or open the SPHEREx Data Explorer.')
  const fields = [...table.children].filter((el) => el.localName === 'FIELD')
    .map((f) => (f.getAttribute('name') || f.getAttribute('ID') || '').toLowerCase())
  const tableData = [...table.getElementsByTagName('*')].find((el) => el.localName === 'TABLEDATA')!
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

function cachedFrames(ra: number, dec: number, fov: number, bands: string[]): Frame[] {
  const radius = fov / 60
  const radians = Math.PI / 180
  const angularDistance = (targetRa: number, targetDec: number, tileRa: number, tileDec: number) => {
    const deltaDec = (tileDec - targetDec) * radians
    const deltaRa = ((((tileRa - targetRa) + 540) % 360) - 180) * radians
    const targetDeclination = targetDec * radians, tileDeclination = tileDec * radians
    const haversine = Math.sin(deltaDec / 2) ** 2
      + Math.cos(targetDeclination) * Math.cos(tileDeclination) * Math.sin(deltaRa / 2) ** 2
    return 2 * Math.asin(Math.min(1, Math.sqrt(haversine))) / radians
  }
  const tile = Object.values(snapshotTiles)
    .filter((candidate) => (['a', 'b'] as const).some((epoch) => {
      const item = candidate.epochs?.[epoch]
      return item?.cutoutUrl && item.sourceUrl && item.band && bands.includes(item.band)
    }))
    .map((candidate) => ({ candidate, distance: angularDistance(ra, dec, candidate.ra, candidate.dec) }))
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
    return { id: item.obsId ?? `${epoch}-${tile.ra}-${tile.dec}`, band: item.band ?? 'unknown', date: item.date ?? 'Date unavailable', time, url: item.sourceUrl, cutout: cutout.toString(), obs: item.obsId ?? 'Cached observation', release: 'cached-live', collection: '', processingRelease: '' }
  }).filter((frame): frame is Frame => !!frame)
}

type BlinkArtifact = {
  firstPng: string; secondPng: string; width: number; height: number; pixelScaleArcsec: number
  sharedStretch: { lowMJySr: number; highMJySr: number; percentiles: number[] }
  targetPassband: { firstWavelengthUm: number; secondWavelengthUm: number; firstBandwidthUm: number; secondBandwidthUm: number; wavelengthDeltaUm: number; relativeWavelengthDifference: number; relativeBandwidthDifference: number; allowedMismatchFraction: number }
  matchedReference?: { obsId?: string; date?: string | null }
  candidateAttempts?: number
  semantics: string
}

type ProcessingJob = Awaited<ReturnType<typeof requestProcessing>>

async function awaitProcessingArtifact(initial: ProcessingJob, setMessage: (message: string) => void) {
  let job = initial
  const pollingStartedAt = Date.now()
  const deadline = pollingStartedAt + 5 * 60 * 1000
  let resultLookupDone = false
  let elapsedBaseMs = 0
  let elapsedAnchor = performance.now()
  let currentReason = job.reason || 'Processing on the SPHEREx worker…'
  const syncElapsedFromServer = (record: ProcessingJob) => {
    const created = Date.parse(record.createdAt ?? '')
    const serverNow = Date.parse(record.serverNow ?? '')
    if (Number.isFinite(created) && Number.isFinite(serverNow)) {
      elapsedBaseMs = Math.max(0, serverNow - created)
      elapsedAnchor = performance.now()
    }
  }
  syncElapsedFromServer(job)
  const formatElapsed = (milliseconds: number) => {
    const totalSeconds = Math.floor(milliseconds / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
  }
  const renderProgress = () => setMessage(`${currentReason} (${formatElapsed(elapsedBaseMs + performance.now() - elapsedAnchor)} elapsed)`)
  const timer = window.setInterval(renderProgress, 1000)
  try {
    while (true) {
      if (job.state === 'unavailable') throw new Error(job.reason)
      if (job.state === 'available' && job.resultUrl) break
      if (job.state === 'available' && resultLookupDone) throw new Error(job.reason || 'Completed job did not provide a result link.')
      if (!job.jobId) throw new Error(job.reason || 'Worker returned no job ID.')
      if (Date.now() >= deadline) throw new Error('Stopped polling after 5 minutes. The processing job remains on the server.')
      if (job.state === 'computing') {
        currentReason = job.reason || 'Processing on the SPHEREx worker…'
        renderProgress()
        await new Promise((resolve) => window.setTimeout(resolve, 5000))
      } else if (job.state === 'available') resultLookupDone = true
      let response: Response
      try {
        response = await fetch(`/.netlify/functions/spherex-job?jobId=${encodeURIComponent(job.jobId)}`, { signal: AbortSignal.timeout(20000) })
      } catch {
        throw new Error('The worker status check timed out or could not reach Netlify.')
      }
      if (!response.ok) throw new Error(`Worker status request failed (${response.status}).`)
      const nextJob = await response.json().catch(() => null) as ProcessingJob | null
      if (!nextJob || !['available', 'computing', 'unavailable'].includes(nextJob.state)) throw new Error('The processing function returned an invalid job status.')
      if (nextJob.state === 'computing') {
        currentReason = nextJob.reason || 'Processing on the SPHEREx worker…'
        syncElapsedFromServer(nextJob)
      }
      job = nextJob
    }
    if (job.state !== 'available' || !job.resultUrl) throw new Error(job.reason || 'Processing did not produce an artifact.')
    const resultResponse = await fetch(job.resultUrl)
    if (!resultResponse.ok) throw new Error(`Processed product download failed (${resultResponse.status}).`)
    return await resultResponse.json() as Record<string, unknown>
  } finally {
    window.clearInterval(timer)
  }
}

function BlinkComparator({ frames, ra, dec, sizeDeg, cached, reports, onReport }: { frames: Frame[]; ra: number; dec: number; sizeDeg: number; cached: boolean; reports: AnomalyReport[]; onReport: (reports: AnomalyReport[]) => boolean }) {
  const [firstId, setFirstId] = useState('')
  const [secondId, setSecondId] = useState('')
  const [artifact, setArtifact] = useState<BlinkArtifact | null>(null)
  const [busy, setBusy] = useState(false)
  const [mismatchTolerance, setMismatchTolerance] = useState(0)
  const [marker, setMarker] = useState<{ x: number; y: number; epoch: 'A' | 'B' } | null>(null)
  const [classification, setClassification] = useState('possible-moving-source')
  const [notes, setNotes] = useState('')
  const [message, setMessage] = useState('Choose two matching exposures, then register them on the worker.')
  const [showFirst, setShowFirst] = useState(true)
  const first = frames.find((frame) => frameKey(frame) === firstId) ?? frames[0]
  const references = first ? frames.filter((frame) => frameKey(frame) !== frameKey(first)
    && frame.band === first.band && frame.collection === first.collection
    && frame.processingRelease === first.processingRelease && Number.isFinite(frame.time))
    .sort((a, b) => Math.abs(a.time - first.time) - Math.abs(b.time - first.time)) : []
  const second = references.find((frame) => frameKey(frame) === secondId) ?? references[0]
  const markImage = (event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    setMarker({ x: Math.min(0.999999, Math.max(0, (event.clientX - bounds.left) / bounds.width)), y: Math.min(0.999999, Math.max(0, (event.clientY - bounds.top) / bounds.height)), epoch: showFirst ? 'A' : 'B' })
  }
  const reportAnomaly = () => {
    if (!artifact || !marker || !first || !second) return
    const report: AnomalyReport = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`,
      format: 'Cosmic Detective SPHEREx anomaly report', status: 'candidate-unverified',
      reportedAt: new Date().toISOString(), classification, notes: notes.trim(),
      target: { raDeg: ra, decDeg: dec, fieldSizeDeg: sizeDeg },
      registeredBlink: {
        first: { observationId: first.obs, date: first.date, detector: first.band, collection: first.collection, processingRelease: first.processingRelease, cutoutUrl: first.cutout },
        second: { observationId: second.obs, date: second.date, detector: second.band, collection: second.collection, processingRelease: second.processingRelease, cutoutUrl: second.cutout },
        marker: { xFraction: marker.x, yFraction: marker.y, pixelX: Math.round(marker.x * (artifact.width - 1)), pixelY: Math.round(marker.y * (artifact.height - 1)), markedOn: marker.epoch },
        passband: artifact.targetPassband, allowedMismatchFraction: artifact.targetPassband.allowedMismatchFraction,
        grid: { width: artifact.width, height: artifact.height, pixelScaleArcsec: artifact.pixelScaleArcsec },
      },
    }
    const next = [report, ...reports].slice(0, 100)
    const saved = onReport(next)
    downloadAnomalyReport(report)
    setMessage(saved
      ? 'Candidate anomaly saved in this browser and downloaded as JSON. It has not been scientifically verified.'
      : 'Candidate anomaly was downloaded as JSON, but browser storage was unavailable. It has not been scientifically verified.')
  }
  useEffect(() => {
    if (!artifact) return
    const timer = window.setInterval(() => setShowFirst((value) => !value), 700)
    return () => window.clearInterval(timer)
  }, [artifact])
  const run = async () => {
    if (!first || !second || cached) return
    setBusy(true); setArtifact(null); setMarker(null)
    try {
      setMessage('Submitting matched cutouts to the SPHEREx registration worker…')
      const initial = await requestProcessing('blink-pair', {
        collection: first.collection,
        obsId: first.id,
        detector: first.band,
        release: first.processingRelease,
        ra, dec, sizeDeg,
        cutoutUrl: first.cutout,
        params: {
          referenceCutoutUrl: second.cutout,
          referenceObsId: second.id,
          referenceDetector: second.band,
          referenceRelease: second.processingRelease,
          referenceCollection: second.collection,
          referenceCandidates: JSON.stringify([...references.filter((frame) => frameKey(frame) === frameKey(second)), ...references.filter((frame) => frameKey(frame) !== frameKey(second))].slice(0, 8).map((frame) => ({
            cutoutUrl: frame.cutout, obsId: frame.id, date: frame.date,
          }))),
          pixelScaleArcsec: '6.2',
          maxPassbandMismatchFraction: mismatchTolerance.toFixed(2),
        },
      })
      if (initial.state === 'unavailable') throw new Error(initial.reason)
      const result = await awaitProcessingArtifact(initial, setMessage) as unknown as BlinkArtifact
      if (!result.firstPng?.startsWith('data:image/png;base64,') || !result.secondPng?.startsWith('data:image/png;base64,')) throw new Error('Worker returned an invalid registered-image product.')
      const matched = frames.find((frame) => frame.id === result.matchedReference?.obsId)
      if (matched) setSecondId(frameKey(matched))
      setArtifact(result); setMessage(mismatchTolerance > 0
        ? 'WCS registration complete with relaxed passband tolerance. Spectral differences can change apparent brightness; visual blinking only.'
        : 'WCS registration complete with strict passband matching. Visual blinking only; this is not a detection or flux-difference result.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Image registration failed.')
    } finally { setBusy(false) }
  }
  if (cached) return <section className="research-results"><p>Cached demonstration cutouts do not include validated target-pixel wavelength metadata. Search the live archive to run a scientifically matched blink.</p></section>
  return <section className="research-results" aria-label="Registered SPHEREx blink comparator" aria-busy={busy}>
    <div className="panel-title mono">REGISTERED BLINK · VISUAL COMPARISON</div>
    <p>Frames are eligible only when detector, QR collection, and processing release match. The worker checks target-pixel WCS-WAVE and tries up to 8 nearest-in-time repeats until it finds a passband match, then reprojects both IMAGE planes to one target-centered sky grid with one shared stretch. Image flags are not overlaid and blinking alone is not evidence of a discovery.</p>
    <div className="research-blink-controls">
      <label>First exposure<select value={first ? frameKey(first) : ''} onChange={(event) => { setFirstId(event.target.value); setSecondId(''); setArtifact(null); setMarker(null) }}>{frames.filter((frame) => frame.collection && frame.processingRelease).map((frame) => <option key={frameKey(frame)} value={frameKey(frame)}>{frame.band} · {frame.date} · {frame.obs}</option>)}</select></label>
      <label>Second exposure<select value={second ? frameKey(second) : ''} onChange={(event) => { setSecondId(event.target.value); setArtifact(null); setMarker(null) }} disabled={!references.length}>{references.map((frame) => <option key={frameKey(frame)} value={frameKey(frame)}>{frame.date} · {frame.obs}</option>)}</select></label>
      <label>Passband mismatch limit: {mismatchTolerance.toFixed(2)}<input type="range" min="0" max="1" step="0.01" value={mismatchTolerance} onChange={(event) => { setMismatchTolerance(Number(event.target.value)); setArtifact(null); setMarker(null) }} aria-label="Maximum relative wavelength and bandwidth mismatch" /></label>
      <button type="button" onClick={() => void run()} disabled={busy || !first || !second}>{busy ? 'Registering…' : 'Register and blink'}</button>
    </div>
    <p className="research-note">The limit applies to relative central-wavelength and bandwidth differences. At 0.00, both must match; higher settings admit increasingly different passbands, which can change apparent brightness and are only suitable for qualitative visual exploration.</p>
    <p className="research-status blink-job-status" role="status" aria-live="polite">{busy && <span className="blink-processing-indicator" aria-hidden="true" />}<span>{message}</span></p>
    {artifact && <><div className="research-image research-blink-image markable" role="button" tabIndex={0} aria-label="Click the registered image to mark a candidate anomaly" onClick={markImage} onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setMarker({ x: 0.5, y: 0.5, epoch: showFirst ? 'A' : 'B' }) } }}><img src={showFirst ? artifact.firstPng : artifact.secondPng} alt={`Registered ${showFirst ? first?.date : second?.date} SPHEREx image; click to mark a candidate anomaly`} />{marker && <span className="marker" style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }} />}<span>{showFirst ? first?.date : second?.date} · {showFirst ? 'A' : 'B'}{marker ? ` · MARKED ON ${marker.epoch}` : ''}</span></div>
      <p className="research-note">Matched from {artifact.candidateAttempts ?? 1} candidate{artifact.candidateAttempts === 1 ? '' : 's'}. Relative wavelength mismatch: {(artifact.targetPassband.relativeWavelengthDifference * 100).toFixed(2)}%; relative bandwidth mismatch: {(artifact.targetPassband.relativeBandwidthDifference * 100).toFixed(2)}% (limit {(artifact.targetPassband.allowedMismatchFraction * 100).toFixed(2)}%). Shared stretch: {artifact.sharedStretch.lowMJySr.toPrecision(5)}–{artifact.sharedStretch.highMJySr.toPrecision(5)} MJy/sr · Target wavelength: {artifact.targetPassband.firstWavelengthUm.toFixed(4)} / {artifact.targetPassband.secondWavelengthUm.toFixed(4)} µm · Bandwidths: {artifact.targetPassband.firstBandwidthUm.toFixed(4)} / {artifact.targetPassband.secondBandwidthUm.toFixed(4)} µm · {artifact.width}×{artifact.height} grid at {artifact.pixelScaleArcsec} arcsec/pixel. {artifact.semantics}</p></>}
    {artifact && <div className="research-anomaly-report"><div className="panel-title mono">FLAG A CANDIDATE ANOMALY</div><p>Like Training Grounds, click the image to place or move the red crosshair. This report records your visual clue for later review; it does not verify a transient or discovery.</p><div className="research-blink-controls"><label>Clue type<select value={classification} onChange={(event) => setClassification(event.target.value)}><option value="possible-moving-source">Possible moving source</option><option value="possible-brightness-change">Possible brightness change</option><option value="possible-image-artifact">Possible image artifact</option><option value="other-clue">Other clue</option></select></label><label>Investigator note<textarea value={notes} maxLength={2000} rows={3} onChange={(event) => setNotes(event.target.value)} placeholder="What looked unusual? Keep interpretation tentative." /></label><button className="flag-btn" type="button" onClick={reportAnomaly} disabled={!marker}>Report anomaly</button></div><p className="research-note">{marker ? `Marker: ${marker.x.toFixed(3)}, ${marker.y.toFixed(3)} of the registered image; epoch ${marker.epoch}.` : 'No marker placed yet. Click the blinking image to mark the clue.'} Reports are saved in this browser only and downloaded as JSON.</p></div>}
    {reports.length > 0 && <section className="research-anomaly-report"><div className="panel-title mono">LOCAL ANOMALY REPORTS · {reports.length}</div><p>Stored only in this browser. They are candidate annotations, not verified findings.</p><ul className="research-anomaly-list">{reports.slice(0, 5).map((report) => <li key={report.id}><span>{new Date(report.reportedAt).toLocaleString()} · {report.classification.replaceAll('-', ' ')} · RA {report.target.raDeg.toFixed(5)} Dec {report.target.decDeg.toFixed(5)}</span><button type="button" onClick={() => downloadAnomalyReport(report)}>Download JSON</button></li>)}</ul></section>}
  </section>
}

type ChannelColor = 'R' | 'G' | 'B'
type CompositeArtifact = {
  png: string; width: number; height: number; pixelScaleArcsec: number
  channels: { color: ChannelColor; detector: string; obsId: string; date: string; wavelengthUm: number; bandwidthUm: number }[]
  displayStretch: Record<ChannelColor, [number, number]>
  semantics: string
}
type CompositeReport = Omit<CompositeArtifact, 'png'> & { query: { raDeg: number; decDeg: number; sizeDeg: number } }

function BandMixer({ frames, ra, dec, sizeDeg, cached, onArtifact }: { frames: Frame[]; ra: number; dec: number; sizeDeg: number; cached: boolean; onArtifact: (artifact: CompositeReport | null) => void }) {
  const [cohort, setCohort] = useState('')
  const [selection, setSelection] = useState<Record<ChannelColor, string>>({ R: '', G: '', B: '' })
  const [artifact, setArtifact] = useState<CompositeArtifact | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Choose one exposure for each display channel.')
  const cohorts = [...new Set(frames.filter((frame) => frame.collection && frame.processingRelease)
    .map((frame) => `${frame.collection}|${frame.processingRelease}`))]
  useEffect(() => {
    if (!cohorts.includes(cohort)) setCohort(cohorts[0] ?? '')
  }, [cohort, cohorts.join('|')])
  const choices = frames.filter((frame) => `${frame.collection}|${frame.processingRelease}` === cohort)
  const preferred: Record<ChannelColor, number> = { R: 6, G: 4, B: 2 }
  const chosen = (color: ChannelColor) => choices.find((frame) => frameKey(frame) === selection[color])
    ?? choices.filter((frame) => frame.band.startsWith('D')).sort((a, b) => {
      const da = Math.abs(Number(a.band.slice(1)) - preferred[color])
      const db = Math.abs(Number(b.band.slice(1)) - preferred[color])
      return da - db || a.time - b.time
    })[0]
  useEffect(() => {
    setSelection((current) => {
      const next = { ...current }
      for (const color of ['R', 'G', 'B'] as const) {
        if (!choices.some((frame) => frameKey(frame) === current[color])) next[color] = chosen(color) ? frameKey(chosen(color)!) : ''
      }
      return next
    })
  }, [cohort, frames])

  const run = async () => {
    if (cached) return
    const rgb = (['R', 'G', 'B'] as const).map((color) => ({ color, frame: chosen(color) }))
    if (rgb.some(({ frame }) => !frame)) return
    const primary = rgb[0].frame!
    setBusy(true); setArtifact(null); onArtifact(null)
    try {
      setMessage('Reprojecting selected detector channels on the worker…')
      const initial = await requestProcessing('band-composite', {
        collection: primary.collection, obsId: primary.id, detector: primary.band,
        release: primary.processingRelease, ra, dec, sizeDeg, cutoutUrl: primary.cutout,
        params: {
          pixelScaleArcsec: '6.2',
          channels: JSON.stringify(rgb.map(({ color, frame }) => ({
            color, cutoutUrl: frame!.cutout, obsId: frame!.id, detector: frame!.band,
            collection: frame!.collection, release: frame!.processingRelease, date: frame!.date,
          }))),
        },
      })
      if (initial.state === 'unavailable') throw new Error(initial.reason)
      const result = await awaitProcessingArtifact(initial, setMessage) as unknown as CompositeArtifact
      if (!result.png?.startsWith('data:image/png;base64,') || result.channels?.length !== 3) throw new Error('Worker returned an invalid band composite.')
      const { png: _png, ...report } = result
      onArtifact({ ...report, query: { raDeg: ra, decDeg: dec, sizeDeg } })
      setArtifact(result)
      setMessage('Composite ready. This independently stretched false-color view is for visual exploration only.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Band composite failed.')
    } finally { setBusy(false) }
  }

  return <section className="research-results" aria-label="SPHEREx multiband channel mixer" aria-busy={busy}>
    <div className="panel-title mono">MULTIBAND COMPOSITOR · FALSE COLOR</div>
    <p>Assign real detector images to red, green, and blue. The worker reprojects them to one sky grid and stretches each band independently. SPHEREx IMAGE still contains modeled zodiacal light, and pixel flags are not masked or overlaid. Colors are not calibrated color, a source spectrum, or evidence of variability; selected exposures may have different observation times.</p>
    {cached && <p>Cached snapshots do not include a validated set of three live channel inputs. Search the live archive to build a multiband composite.</p>}
    <div className="research-blink-controls">
      <label>Collection and processing release<select value={cohort} onChange={(event) => { setCohort(event.target.value); setArtifact(null); onArtifact(null) }}>{cohorts.map((value) => <option key={value} value={value}>{value.replace('|', ' · ')}</option>)}</select></label>
      {(['R', 'G', 'B'] as const).map((color) => <label key={color}>{color} channel<select value={chosen(color) ? frameKey(chosen(color)!) : ''} onChange={(event) => { setSelection((current) => ({ ...current, [color]: event.target.value })); setArtifact(null); onArtifact(null) }}>
        {choices.filter((frame) => frame.band === chosen(color)?.band || !(['R', 'G', 'B'] as const).some((other) => other !== color && chosen(other)?.band === frame.band)).map((frame) => <option key={frameKey(frame)} value={frameKey(frame)}>{frame.band} · {frame.date} · {frame.obs}</option>)}
      </select></label>)}
      <button type="button" onClick={() => void run()} disabled={busy || cached || !chosen('R') || !chosen('G') || !chosen('B') || new Set((['R', 'G', 'B'] as const).map((color) => chosen(color)?.band)).size !== 3}>{busy ? 'Processing…' : 'Build false-color composite'}</button>
    </div>
    <p className="research-status blink-job-status" role="status" aria-live="polite">{busy && <span className="blink-processing-indicator" aria-hidden="true" />}<span>{message}</span></p>
    {artifact && <><div className="research-image research-blink-image"><img src={artifact.png} alt="False-color composite of three reprojected SPHEREx detector images" /></div>
      <p className="research-note">{artifact.channels.map((channel) => `${channel.color}: ${channel.detector}, ${channel.date}, ${channel.wavelengthUm.toFixed(4)} µm ± ${channel.bandwidthUm.toFixed(4)} µm`).join(' · ')} · {artifact.width}×{artifact.height} at {artifact.pixelScaleArcsec} arcsec/pixel. {artifact.semantics}</p>
      <a className="research-link" href={artifact.png} download={`spherex-${ra.toFixed(5)}-${dec.toFixed(5)}-false-color.png`}>Download composite PNG</a></>}
  </section>
}

function BrowseImage({ frame, onStart, onReady }: { frame: Frame; onStart: () => void; onReady: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    let active = true
    setState('loading')
    onStart()
    fetch(cutoutProxyUrl(frame)).then((response) => {
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
  const [view, setView] = useState<'bands' | 'raw' | 'blink' | 'composite'>('bands')
  const [compositeReport, setCompositeReport] = useState<CompositeReport | null>(null)
  const [anomalyReports, setAnomalyReports] = useState<AnomalyReport[]>(loadAnomalyReports)
  const saveAnomalyReports = (next: AnomalyReport[]) => {
    setAnomalyReports(next)
    try {
      window.localStorage.setItem(ANOMALY_REPORTS_KEY, JSON.stringify(next))
      return true
    } catch { return false }
  }
  const [sourceMode, setSourceMode] = useState<'live' | 'cached'>(initial.source)
  const [cachedTarget, setCachedTarget] = useState('')
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
  const [analysisExposureClass, setAnalysisExposureClass] = useState<'wide' | 'deep' | ''>('')
  const [trialPeriodDays, setTrialPeriodDays] = useState('')
  const [maxFitQuality, setMaxFitQuality] = useState('')
  useEffect(() => {
    let active = true
    loadSpherexRegistry().then((data) => { if (active) setRegistry(data) }).catch(() => { /* the portal still works without the registry asset */ })
    return () => { active = false }
  }, [])
  const selectedRegistry = registry?.targets[registryTarget] ?? null
  const selectedFrames = useMemo(() => frames.filter((f) => bands.includes(f.band)), [frames, bands])
  const compositeAvailable = selectedFrames.some((frame) => new Set(selectedFrames
    .filter((other) => other.collection === frame.collection && other.processingRelease === frame.processingRelease)
    .map((other) => other.band)).size >= 3)
  const blinkFrames = useMemo(() => selectedFrames.filter((frame) => frame.collection && frame.processingRelease
    && selectedFrames.some((other) => frameKey(other) !== frameKey(frame) && other.band === frame.band
      && other.collection === frame.collection && other.processingRelease === frame.processingRelease)), [selectedFrames])
  const activeIRSAResult = coordinateMatches(irsaResult, ra, dec) ? irsaResult : null
  const fitQualityLimit = maxFitQuality === '' ? Infinity : Number(maxFitQuality)
  const validFitQualityLimit = maxFitQuality === '' || (Number.isFinite(fitQualityLimit) && fitQualityLimit >= 0)
  const analysisObservations = useMemo(() => {
    if (!activeIRSAResult || !validFitQualityLimit) return []
    return activeIRSAResult.observations.filter((observation) => observation.measurement?.usable
      && observation.measurement.fitQuality <= fitQualityLimit)
  }, [activeIRSAResult, validFitQualityLimit, fitQualityLimit])
  const fitQualityExcludedRows = activeIRSAResult && validFitQualityLimit && Number.isFinite(fitQualityLimit)
    ? activeIRSAResult.observations.filter((observation) => observation.measurement?.usable && observation.measurement.fitQuality > fitQualityLimit)
    : []
  const capabilities = useMemo<Capabilities>(() => capabilitiesFor(analysisObservations), [analysisObservations])
  const curveGroups = lightCurveGroups(analysisObservations)
  const availableBands = [...new Set(curveGroups.map((group) => group.band))]
  const effectiveBand = availableBands.includes(analysisBand) ? analysisBand : curveGroups[0]?.band ?? ''
  const availableReleases = [...new Set(curveGroups.filter((group) => group.band === effectiveBand).map((group) => group.release))]
  const effectiveRelease = availableReleases.includes(analysisRelease as 'qr2' | 'qr3') ? analysisRelease as 'qr2' | 'qr3' : availableReleases[0]
  const passbandKey = (wavelength: number, bandwidth: number) => `${wavelength.toFixed(4)}:${bandwidth.toFixed(4)}`
  const passbandGroups = [...new Map(curveGroups.filter((group) => group.band === effectiveBand && group.release === effectiveRelease)
    .map((group) => [passbandKey(group.wavelength, group.bandwidth), group] as const)).values()]
  const effectivePassband = passbandGroups.find((group) => passbandKey(group.wavelength, group.bandwidth) === analysisPassband) ?? passbandGroups[0]
  const availableExposureClasses = effectivePassband
    ? [...new Set(curveGroups.filter((group) => group.band === effectiveBand && group.release === effectiveRelease
      && passbandKey(group.wavelength, group.bandwidth) === passbandKey(effectivePassband.wavelength, effectivePassband.bandwidth)).map((group) => group.deepField ? 'deep' as const : 'wide' as const))]
    : []
  const effectiveExposureClass = analysisExposureClass !== '' && availableExposureClasses.includes(analysisExposureClass)
    ? analysisExposureClass : availableExposureClasses[0] ?? ''
  const deepField = effectiveExposureClass === 'deep'
  const lightCurve = effectiveBand && effectiveRelease && effectivePassband && effectiveExposureClass && activeIRSAResult
    ? buildLightCurve(analysisObservations, effectiveBand, 3, effectiveRelease, effectivePassband.wavelength, effectivePassband.bandwidth, deepField)
    : null
  const periodResult = lightCurve?.available && trialPeriodDays
    ? phaseFold(lightCurve.value, Number(trialPeriodDays) * 86400000)
    : null
  const phaseReason = !lightCurve
    ? `${capabilities.lightcurve.reason} A phase fold also needs a validated light curve and a trial period.`
    : !lightCurve.available
      ? lightCurve.reason
      : periodResult && !periodResult.available
        ? periodResult.reason
        : 'Enter a trial period; at least six points spanning two cycles are required.'
  const phaseCapability = periodResult?.available
    ? { state: 'available' as const, reason: 'Validated same-channel photometry spans at least two trial-period cycles.' }
    : { state: 'unavailable' as const, reason: phaseReason }
  const analysisCapabilities = {
    ...capabilities,
    blink: blinkFrames.length >= 2
      ? { state: 'available' as const, reason: 'A live pair shares detector, QR collection, and processing release; the worker will still validate target-pixel wavelength and bandwidth before display.' }
      : { state: 'unavailable' as const, reason: 'No live pair shares detector, QR collection, and processing release.' },
    phaseFold: phaseCapability,
  }
  const activeFrame = selectedFrames.find((f) => frameKey(f) === activeKey) ?? selectedFrames[0] ?? null
  const currentKey = activeFrame ? frameKey(activeFrame) : ''
  const activeIndex = activeFrame ? selectedFrames.findIndex((f) => frameKey(f) === frameKey(activeFrame)) : -1
  const timePoints = selectedFrames.map((frame) => ({ frame, time: frame.time })).filter((point) => Number.isFinite(point.time))
  const timeMin = timePoints.length ? Math.min(...timePoints.map((point) => point.time)) : 0
  const timeMax = timePoints.length ? Math.max(...timePoints.map((point) => point.time)) : 1
  const explorerUrl = new URL('https://irsa.ipac.caltech.edu/applications/spherex/')
  explorerUrl.searchParams.set('api', 'spectral-images'); explorerUrl.searchParams.set('ra', ra); explorerUrl.searchParams.set('dec', dec); explorerUrl.searchParams.set('sr', `${Number(fov) / 120}d`)
  const toggleBand = (band: string) => { setCompositeReport(null); setBands((xs) => xs.includes(band) ? xs.filter((x) => x !== band) : [...xs, band]) }
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
    setCompositeReport(null)
    setRa(String(f.ra)); setDec(String(f.dec)); setFov(String(f.fov)); setBands(f.bands.length ? f.bands : [...BANDS])
    const fs = f.frames as Frame[]
    setFrames(fs); setActiveKey(fs[0] ? frameKey(fs[0]) : ''); setError(false)
    setStatus(`Assignment loaded: ${fs.length} observation${fs.length === 1 ? '' : 's'} at RA ${f.ra}, Dec ${f.dec}.`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const search = async (e: React.FormEvent) => {
    e.preventDefault(); setError(false); setFrames([]); setIrsaResult(null); setAnalysisTool(null); setCompositeReport(null)
    const r = Number(ra), d = Number(dec), size = Number(fov)
    if (!Number.isFinite(r) || r < 0 || r > 360 || !Number.isFinite(d) || d < -90 || d > 90 || !Number.isFinite(size) || size <= 0 || size > 30) {
      setError(true); setStatus('Enter RA 0–360°, Dec −90–90°, and a field size above 0 and at most 30 arcmin.'); return
    }
    if (!bands.length) { setError(true); setStatus('Select at least one detector band.'); return }
    updateQuery(ra, dec, fov)
    if (sourceMode === 'cached') {
      const cached = cachedFrames(r, d, size, bands)
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
        const basename = decodeURIComponent(cutout.pathname.split('/').pop() ?? '')
        const productMatch = /^level2_(.+?)(D[1-6])_spx_(l2[a-z]\d*-.+?)\.fits$/i.exec(basename)
        const collection = /spherex_(qr\d+)/i.exec(release)?.[1]?.toLowerCase() ?? ''
        return {
          id: productMatch?.[1] ?? row.obs_id ?? id,
          band, date, time, url: source, cutout: cutout.toString(), obs: row.obs_id || id,
          release: release || 'unknown', collection, processingRelease: productMatch?.[3] ?? '',
        }
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
    setAnalysisBand(''); setAnalysisRelease(''); setAnalysisPassband(''); setAnalysisExposureClass('')
    setTrialPeriodDays(''); setMaxFitQuality('')
    if (!file) return
    try {
      const parsed = parseIRSASpectrophotometry(await file.text(), { ra: Number(ra), dec: Number(dec) })
      setIrsaResult(parsed)
      const eligibleRows = parsed.rows - parsed.rejected
      setStatus(eligibleRows
        ? `Imported ${parsed.rows} IRSA spectrophotometry rows; ${eligibleRows} have nominal flags (0 or SOURCE-only 2097152) and ${parsed.rejected} remain excluded from analysis.`
        : `Imported ${parsed.rows} rows for inspection, but none have nominal IRSA flags (0 or SOURCE-only 2097152). Scientific tools remain unavailable.`)
    } catch (error) {
      setIrsaError((error as Error).message)
    }
  }
  const capabilityLabel = (id: keyof Capabilities) => {
    const capability = analysisCapabilities[id]
    return <span className={`capability-state ${capability.state}`}>{capability.state}</span>
  }
  const downloadReport = () => {
    const report = {
      format: 'Cosmic Detective SPHEREx research report',
      generatedAt: new Date().toISOString(),
      query: { raDeg: Number(ra), decDeg: Number(dec), fieldSizeArcmin: Number(fov), source: provenance },
      observations: selectedFrames.map((frame) => ({
        observationId: frame.obs, detector: frame.band, observationTime: Number.isFinite(frame.time) ? new Date(frame.time).toISOString() : null,
        collection: frame.collection, processingRelease: frame.processingRelease, imageUrl: frame.url, cutoutUrl: frame.cutout,
      })),
      anomalyReports,
      processedVisualizations: { falseColorComposite: compositeReport },
      measuredSourceData: activeIRSAResult ? {
        source: activeIRSAResult.source, rows: activeIRSAResult.rows, rejectedByFlags: activeIRSAResult.rejected,
        target: activeIRSAResult.target,
        measurements: activeIRSAResult.observations.map((observation) => observation.measurement ?? null).filter(Boolean),
      } : null,
      toolReadiness: Object.fromEntries(Object.entries(analysisCapabilities).map(([name, value]) => [name, value])),
      interpretation: 'Archive images and visual composites are not source photometry. Imported measurements retain their IRSA values, flags, and provenance; tool readiness indicates current input gates only.',
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `spherex-report-${Number(ra).toFixed(5)}-${Number(dec).toFixed(5)}.json`
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <div className="screen case-screen research-screen" style={{ ['--accent' as any]: '#ffd84a' }}>
    <div className="case-bar"><div className="case-id"><span className="mono kicker">CH 5 · LIVE ARCHIVE</span><h1 className="display">Open Sky Research Portal</h1></div><div className="case-actions"><Btn variant="ghost" onClick={() => navigate('/map')}>Case board</Btn></div></div>
    <p className="lede">Browse rendered SPHEREx QR3 and QR2 spectral images by ICRS position. This public view shows archive coverage; it does not claim that different wavelengths are a valid science comparison.</p>
    <form className="research-form" onSubmit={search}>
      <label>RA (deg, ICRS)<input type="number" min="0" max="360" step="any" required value={ra} onChange={(e) => setRa(e.target.value)} /></label>
      <label>Dec (deg, ICRS)<input type="number" min="-90" max="90" step="any" required value={dec} onChange={(e) => setDec(e.target.value)} /></label>
      <label>Field size (arcmin)<input type="number" min="0.5" max="30" step="any" value={fov} onChange={(e) => setFov(e.target.value)} /></label>
      <label>Data source<select value={sourceMode} onChange={(e) => setSourceMode(e.target.value as 'live' | 'cached')}><option value="live">Live IRSA archive</option><option value="cached">Cached snapshot ({snapshotGeneratedAt.slice(0, 10)})</option></select></label>
      {sourceMode === 'cached' && <label>Cached snapshot target<select value={cachedTarget} onChange={(event) => { const target = snapshotTiles[event.target.value]; setCachedTarget(event.target.value); if (target) { const targetRa = String(target.ra), targetDec = String(target.dec); setRa(targetRa); setDec(targetDec); setFov('6'); updateQuery(targetRa, targetDec, '6'); setBands([...new Set([target.epochs?.a?.band, target.epochs?.b?.band].filter((band): band is string => !!band))]) } }}><option value="">Choose a target with cached cutouts</option>{Object.entries(snapshotTiles).filter(([, target]) => target.epochs?.a?.cutoutUrl || target.epochs?.b?.cutoutUrl).map(([id, target]) => <option key={id} value={id}>{id} · RA {target.ra}, Dec {target.dec}</option>)}</select></label>}
      <label>Random seed (1–99)<span className="seed-row"><input type="number" min="1" max="99" value={seed} onChange={(e) => setSeed(e.target.value)} /><button type="button" className="research-link" onClick={randomize}>Random position</button></span></label>
      <label>Example field<select value="" onChange={(e) => { const demo = DEMO_FIELDS[Number(e.target.value)]; if (demo) { setRa(demo.ra); setDec(demo.dec); setFov('6'); updateQuery(demo.ra, demo.dec, '6') } }}><option value="">Choose a sample position</option>{DEMO_FIELDS.map((demo, i) => <option key={demo.label} value={i}>{demo.label}</option>)}</select></label>
      <label>Registry target<select value={registryTarget} onChange={(e) => pickRegistryTarget(e.target.value)}><option value="">Choose a registered target</option>{Object.values(registry?.targets ?? {}).map((target) => <option key={target.meta.id} value={target.meta.id}>{target.meta.label}</option>)}</select></label>
      <fieldset className="band-checks"><legend>Detector bands</legend>{BANDS.map((band) => <label key={band}><input type="checkbox" checked={bands.includes(band)} onChange={() => toggleBand(band)} />{band} <small>{WAVE[band]}</small></label>)}</fieldset>
      <Btn disabled={busy}>{busy ? 'Searching IRSA…' : sourceMode === 'cached' ? 'Load selected cached snapshot' : 'Fetch live SPHEREx data'}</Btn>
    </form>
    <section className="registry-target" aria-label="SPHEREx photometry pipeline">
      <div className="panel-title mono">IN-PORTAL PHOTOMETRY PIPELINE</div>
      <p>The finished workflow will retrieve SPHEREx image inputs and run quality-controlled source photometry from this portal. That pipeline is not enabled yet; browse images are display-only and no measurements are inferred from them. The optional VOTable reference importer below is for validating IRSA results during development, not a required game step. IRSA's current tool fits flux at a user-supplied position and morphology, so any integrated workflow must collect and validate those inputs and account for nearby sources before exposing measurements.</p>
      <details><summary>Optional reference workflow: inspect and import an IRSA VOTable</summary>
      <p>For comparison with IRSA's reference results, open the <a href="https://irsa.ipac.caltech.edu/applications/spherex/" target="_blank" rel="noreferrer">official SPHEREx tools</a>, run its Spectrophotometry Tool, and use Prepare Download from Results to save the extracted spectrum. This importer currently supports TABLEDATA serialization only; BINARY and BINARY2 exports are rejected, and compatibility still needs validation against a representative download.</p>
      <label className="research-link">Import reference VOTable (TABLEDATA only)<input type="file" accept=".vot,.xml,application/xml,text/xml" onChange={(event) => void importIRSAFile(event.target.files?.[0])} /></label>
      </details>
      {activeIRSAResult && <><label>Maximum fit_ql (optional)<input type="number" min="0" step="any" value={maxFitQuality} onChange={(event) => setMaxFitQuality(event.target.value)} /></label><p>IRSA fit_ql values near 1 generally indicate better fits, but its <a href="https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html" target="_blank" rel="noreferrer">documentation sets no universal cutoff</a>. Leave blank to include every flag-approved point, or enter a research-specific ceiling; this filter also gates light-curve and phase-fold availability.</p>{maxFitQuality !== '' && !validFitQualityLimit && <p className="research-status error" role="alert">Enter a finite, nonnegative fit_ql ceiling.</p>}</>}
      {analysisCapabilities.lightcurve.state === 'available' && <label>Trial period for phase fold (days)<input type="number" min="0" step="any" value={trialPeriodDays} onChange={(event) => setTrialPeriodDays(event.target.value)} /></label>}
      {irsaError && <p className="research-status error" role="alert">{irsaError}</p>}
      {irsaResult && <p className="research-note" role="status">{irsaResult.source} · RA {irsaResult.target.ra}, Dec {irsaResult.target.dec} · {irsaResult.rows} points · {irsaResult.rows - irsaResult.rejected} pass the approved flag gate · {irsaResult.rejected} excluded by flags. {activeIRSAResult ? 'Imported data is held in this page only.' : 'The query coordinate changed; this import is inactive until you reload a matching result.'}</p>}
      {fitQualityExcludedRows.length > 0 && <details><summary>Review {fitQualityExcludedRows.length} flag-approved rows above the selected fit_ql ceiling</summary><p>These points are omitted from the current analysis by your fit_ql filter. They remain available here for inspection. Optional ext_flg and nyquist_comp values are shown as exported; their definitions are not interpreted by this portal.</p><div className="research-table-wrap"><table className="research-table"><thead><tr><th>UTC</th><th>Fit quality</th><th>Flux (µJy)</th><th>Uncertainty (µJy)</th><th>Wavelength (µm)</th><th>Flags</th><th>ext_flg</th><th>nyquist_comp</th><th>Detector</th><th>Exposure class</th><th>LVF exposure</th></tr></thead><tbody>{fitQualityExcludedRows.map((observation, index) => { const point = observation.measurement!; return <tr key={`${point.time}-${index}`}><td>{new Date(point.time).toISOString()}</td><td>{point.fitQuality}</td><td>{point.flux}</td><td>{point.uncertainty}</td><td>{point.wavelength.toFixed(4)}</td><td>{point.flags}</td><td>{point.diagnostics?.ext_flg ?? 'n/a'}</td><td>{point.diagnostics?.nyquist_comp ?? 'n/a'}</td><td>{point.provenance.detector}</td><td>{point.provenance.deepField ? 'Deep Field' : 'Wide survey'}</td><td>{point.provenance.exposureId}</td></tr> })}</tbody></table></div></details>}
      {activeIRSAResult && activeIRSAResult.rejected > 0 && <details><summary>Review {activeIRSAResult.rejected} rows excluded by flags</summary><p>These rows do not have one of IRSA's documented nominal flag values (0 or SOURCE-only, 2097152). IRSA says most flags are warnings rather than automatic rejection criteria; this portal does not yet model those flag-specific effects. Inspect values and fit quality against <a href="https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/sp.html" target="_blank" rel="noreferrer">IRSA's flag definitions and guidance</a> before deciding whether they are suitable for a separate workflow. Optional ext_flg and nyquist_comp values are displayed without interpretation.</p><div className="research-table-wrap"><table className="research-table"><thead><tr><th>UTC</th><th>Flags</th><th>Fit quality</th><th>Flux (µJy)</th><th>Uncertainty (µJy)</th><th>Background (MJy/sr)</th><th>Wavelength (µm)</th><th>ext_flg</th><th>nyquist_comp</th><th>Detector</th><th>Exposure class</th><th>LVF exposure</th></tr></thead><tbody>{activeIRSAResult.observations.filter((observation) => observation.measurement && !observation.measurement.usable).map((observation, index) => { const point = observation.measurement!; return <tr key={`${point.time}-${index}`}><td>{new Date(point.time).toISOString()}</td><td>{point.flags}</td><td>{point.fitQuality}</td><td>{point.flux}</td><td>{point.uncertainty}</td><td>{point.backgroundFluxMJySr}</td><td>{point.wavelength.toFixed(4)}</td><td>{point.diagnostics?.ext_flg ?? 'n/a'}</td><td>{point.diagnostics?.nyquist_comp ?? 'n/a'}</td><td>{point.provenance.detector}</td><td>{point.provenance.deepField ? 'Deep Field' : 'Wide survey'}</td><td>{point.provenance.exposureId}</td></tr> })}</tbody></table></div></details>}
    </section>
    {provenance === 'cached-live' && <div className="provenance-banner" role="status">CACHED-LIVE SNAPSHOT · {snapshotGeneratedAt} · Explicitly selected; this does not automatically replace unavailable live data.</div>}
    {selectedRegistry && registry && <section className="registry-target" aria-label="Registered target metadata">
      <div className="panel-title mono">REGISTRY TARGET · {selectedRegistry.meta.label.toUpperCase()}{selectedRegistry.truncated ? ' · TRUNCATED AT THE ROW LIMIT' : ''}</div>
      <p className="mono">{selectedRegistry.meta.kind} · RA {selectedRegistry.meta.ra}° Dec {selectedRegistry.meta.dec}° · {selectedRegistry.meta.radiusDeg}° radius</p>
      <p>Archive metadata snapshot {registry.snapshotCapturedAt}: {selectedRegistry.summary.groups} observation groups, {selectedRegistry.summary.items} observations across {selectedRegistry.summary.channels.length} channels — {selectedRegistry.summary.channels.map((channel) => `${channel.channel} (${channel.observations})`).join(' · ')}</p>
      <p>Survey passes: {selectedRegistry.summary.surveyPasses.join(', ') || 'none'} · Releases: {selectedRegistry.summary.releases.slice(0, 6).join(', ')}{selectedRegistry.summary.releases.length > 6 ? ' …' : ''}</p>
      <p className="research-note">{selectedRegistry.wavelengthTier === 'wcs-wave'
        ? `Wavelength evaluated at the target pixel (WCS-WAVE): ${selectedRegistry.wavelengthAtTargetUm} µm for at least one exposure.`
        : registry.wavelengthPolicy.planeBounds}</p>
      <p className="research-note">This is a timestamped archive-coverage snapshot. Tool readiness below is calculated from the current query and its validated inputs.</p>
    </section>}
    <div className={`research-status ${error ? 'error' : ''}`} role="status">{status}</div>
    {selectedFrames.length > 0 && <div className="case-grid research-case-grid">
      <aside className="tile-grid research-observation-pane" aria-label="SPHEREx observation batch">
        <div className="panel-title mono">OBSERVATION BATCH · {selectedFrames.length}</div>
        <div className="research-observation-list">{selectedFrames.map((frame, index) => <div className={`research-observation-tile ${activeFrame && frameKey(frame) === frameKey(activeFrame) ? 'sel' : ''}`} key={frameKey(frame)} style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}>
          <button type="button" onClick={() => setActiveKey(frameKey(frame))} aria-pressed={!!activeFrame && frameKey(frame) === frameKey(activeFrame)}><strong>{frame.band}</strong><span>{frame.date}</span><small>{frame.obs}</small><small>{frame.release.toUpperCase().replace('SPHEREX_', '')}</small></button>
          <a className="fits-download" href={cutoutProxyUrl(frame)} download={cutoutFilename(frame)} title={`Download ${frame.band} FITS cutout`} aria-label={`Download ${frame.band} FITS cutout for ${frame.obs}`}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2.5v10m0 0 3.5-3.5M10 12.5 6.5 9M3 14v3h14v-3" /></svg></a>
        </div>)}</div>
      </aside>
      <section className="inspect research-inspector" aria-label="SPHEREx investigation tools">
    <div className="research-tools"><div className="research-tabs">
      <button type="button" className={!analysisTool && view === 'blink' ? 'on' : ''} disabled={blinkFrames.length < 2} title={blinkFrames.length < 2 ? 'Requires two frames from the same detector, collection, and processing release.' : 'Register two matching frames on the SPHEREx worker.'} onClick={() => { setAnalysisTool(null); setView('blink') }}>Blink Comparator</button>
      <button type="button" disabled title="Requires registered multi-epoch images." >Difference</button>
      <button type="button" className={!analysisTool && view === 'bands' ? 'on' : ''} onClick={() => { setAnalysisTool(null); setView('bands') }}>Bands</button>
      <button type="button" className={!analysisTool && view === 'composite' ? 'on' : ''} disabled={!compositeAvailable} title="Requires three detector channels in one collection and processing release." onClick={() => { setAnalysisTool(null); setView('composite') }}>Channel mixer</button>
      <button type="button" className={analysisTool === 'lightcurve' ? 'on' : ''} disabled={analysisCapabilities.lightcurve.state !== 'available'} title={analysisCapabilities.lightcurve.reason} onClick={() => { setView('bands'); setAnalysisTool('lightcurve') }}>Light Curve</button>
      <button type="button" className={!analysisTool && view === 'raw' ? 'on' : ''} onClick={() => { setAnalysisTool(null); setView('raw') }}>Raw series</button>
      <button type="button" className={analysisTool === 'phaseFold' ? 'on' : ''} disabled={analysisCapabilities.phaseFold.state !== 'available'} title={analysisCapabilities.phaseFold.reason} onClick={() => { setView('bands'); setAnalysisTool('phaseFold') }}>Phase fold</button>
    </div></div>
    {analysisTool && activeIRSAResult && analysisCapabilities[analysisTool].state === 'available' && <section className="research-results" aria-label={`${analysisTool} analysis`}>
      <div className="panel-title mono">VALIDATED IRSA DATA · {analysisTool.toUpperCase()}</div>
      {analysisTool === 'lightcurve' && <>
        <label>Same detector<select value={effectiveBand} onChange={(event) => { setAnalysisBand(event.target.value); setAnalysisExposureClass('') }}>{availableBands.map((band) => <option key={band} value={band}>{band}</option>)}</select></label>
        <label>Calibration release<select value={effectiveRelease ?? ''} onChange={(event) => { setAnalysisRelease(event.target.value as 'qr2' | 'qr3' | ''); setAnalysisExposureClass('') }}>{availableReleases.map((release) => <option key={release} value={release}>{release.toUpperCase()}</option>)}</select></label>
        <label>Effective wavelength and bandwidth<select value={effectivePassband ? passbandKey(effectivePassband.wavelength, effectivePassband.bandwidth) : ''} onChange={(event) => { setAnalysisPassband(event.target.value); setAnalysisExposureClass('') }}>{passbandGroups.map((group) => <option key={passbandKey(group.wavelength, group.bandwidth)} value={passbandKey(group.wavelength, group.bandwidth)}>{group.wavelength.toFixed(4)} µm ± {group.bandwidth.toFixed(4)} µm</option>)}</select></label>
        <label>Exposure class<select value={effectiveExposureClass} onChange={(event) => setAnalysisExposureClass(event.target.value as 'wide' | 'deep' | '')}>{availableExposureClasses.map((exposureClass) => <option key={exposureClass} value={exposureClass}>{exposureClass === 'deep' ? 'Deep Field' : 'Wide survey'}</option>)}</select></label>
        {lightCurve?.available && <p>{deepField ? 'Deep Field' : 'Wide survey'} points are analyzed separately and grouped only within the matching detector, release, wavelength, and bandwidth. The portal does not combine exposure classes without validated cross-class calibration.</p>}
        {lightCurve?.available ? <><p>{lightCurve.value.points.length} approved-flag points · fit_ql ceiling: {maxFitQuality || 'none'} · {(lightCurve.value.baselineMs / 86400000).toFixed(5)} day baseline · {lightCurve.value.release.toUpperCase()} calibration only. Only IRSA nominal values 0 or SOURCE-only (2097152) are admitted; SOURCE-only may still warrant a contamination check. Points are grouped only when detector, release, central wavelength, and effective bandwidth agree to 0.0001 µm. Error bars show IRSA per-point flux_err; shared calibration covariance is not included. The imported flux assumes the position and morphology supplied to IRSA; check source motion, blends, cutouts, and morphology before interpreting variability. Its fit_ql values near 1 generally indicate better fits; inspect them point by point. Optional ext_flg and nyquist_comp columns, when present in the export, are displayed without interpretation.</p><MeasurementPlot label="SPHEREx same-band light curve with reported flux uncertainties" points={lightCurve.value.points.map((point) => ({ x: (point.time - lightCurve.value.points[0].time) / 86400000, y: point.flux, error: point.uncertainty }))} xLabel="Time since first measurement (days)" yLabel="Flux (µJy)" /><p>IRSA reports the background estimate used for each fit. Review this same-band time series for changes that may affect interpretation of apparent variability. Background is surface brightness, not source flux; IRSA does not report an uncertainty for it.</p><MeasurementPlot label="IRSA fitted background surface brightness across the selected source measurements" points={lightCurve.value.points.map((point) => ({ x: (point.time - lightCurve.value.points[0].time) / 86400000, y: point.backgroundFluxMJySr }))} xLabel="Time since first measurement (days)" yLabel="Background (MJy/sr)" /><div className="research-table-wrap"><table className="research-table"><thead><tr><th>UTC</th><th>Flux (µJy)</th><th>Uncertainty (µJy)</th><th>Background (MJy/sr)</th><th>Wavelength (µm)</th><th>RA</th><th>Dec</th><th>LVF exposure</th><th>Flags</th><th>Fit quality</th><th>ext_flg</th><th>nyquist_comp</th></tr></thead><tbody>{lightCurve.value.points.map((point, index) => { const row = activeIRSAResult.observations.find((observation) => observation.measurement === point); return <tr key={`${point.time}-${index}`}><td>{new Date(point.time).toISOString()}</td><td>{point.flux}</td><td>{point.uncertainty}</td><td>{point.backgroundFluxMJySr}</td><td>{point.wavelength.toFixed(4)}</td><td>{row?.position?.ra}</td><td>{row?.position?.dec}</td><td>{point.provenance.exposureId}</td><td>{point.flags}</td><td>{point.fitQuality}</td><td>{point.diagnostics?.ext_flg ?? 'n/a'}</td><td>{point.diagnostics?.nyquist_comp ?? 'n/a'}</td></tr> })}</tbody></table></div></> : <p>{lightCurve && !lightCurve.available ? lightCurve.reason : 'No valid same-detector measurements.'}</p>}
      </>}
      {analysisTool === 'phaseFold' && <>
        <p>Phase zero is the first valid observation in the selected detector and release.</p>
        {periodResult?.available ? <><p>Trial-period fold · {periodResult.value.cycles.toFixed(2)} cycles covered · raw weighted χ² reduction {periodResult.value.foldedModelImprovement.toFixed(3)} versus a constant-flux model. This descriptive value does not account for added bin parameters or period trials and is not a false-alarm probability; it also omits shared calibration covariance.</p><MeasurementPlot label="SPHEREx trial-period phase fold with weighted flux uncertainties" points={periodResult.value.bins.map((bin) => ({ x: bin.phase, y: bin.flux, error: bin.uncertainty }))} xLabel="Phase (cycle)" yLabel="Flux (µJy)" /><div className="research-table-wrap"><table className="research-table"><thead><tr><th>Phase</th><th>Weighted flux (µJy)</th><th>Uncertainty (µJy)</th><th>Points</th></tr></thead><tbody>{periodResult.value.bins.map((bin) => <tr key={bin.phase}><td>{bin.phase.toFixed(3)}</td><td>{bin.flux.toFixed(4)}</td><td>{bin.uncertainty.toFixed(4)}</td><td>{bin.count}</td></tr>)}</tbody></table></div></> : <p>{periodResult && !periodResult.available ? periodResult.reason : 'Enter a trial period. At least six same-detector measurements spanning two cycles are required.'}</p>}
      </>}
    </section>}
    {!analysisTool && view === 'blink' && selectedFrames.length > 0 && <BlinkComparator frames={blinkFrames} ra={Number(ra)} dec={Number(dec)} sizeDeg={Number(fov) / 60} cached={provenance === 'cached-live'} reports={anomalyReports} onReport={saveAnomalyReports} />}
    {!analysisTool && view === 'composite' && selectedFrames.length > 0 && <BandMixer frames={selectedFrames} ra={Number(ra)} dec={Number(dec)} sizeDeg={Number(fov) / 60} cached={provenance === 'cached-live'} onArtifact={setCompositeReport} />}
    {!analysisTool && (view === 'bands' || view === 'raw') && selectedFrames.length > 0 && <section className="research-results"><div className="panel-title mono">{view === 'bands' ? 'BAND INSPECTOR' : 'RAW OBSERVATION TIMELINE'} · {selectedFrames.length} FILES</div>
      {view === 'bands' && <div className="coverage-strip">{BANDS.filter((b) => bands.includes(b)).map((b) => { const count = selectedFrames.filter((f) => f.band === b).length; return <div key={b}><b>{b}</b><span>{WAVE[b]}</span><strong>{count} {count === 1 ? 'image' : 'images'}</strong></div> })}</div>}
      {view === 'raw' && <div className="timeline-panel"><p>Each point is an archive image observation, not source brightness. Select a point or its row to inspect the file.</p>{timePoints.length ? <svg className="research-timeline" viewBox={`0 0 760 ${Math.max(100, BANDS.length * 28 + 30)}`} role="img" aria-label="Observation dates grouped by detector band">
        {BANDS.filter((b) => bands.includes(b)).map((band) => { const lane = BANDS.indexOf(band); return <g key={band}><text x="8" y={32 + lane * 28}>{band}</text><line x1="72" y1={28 + lane * 28} x2="744" y2={28 + lane * 28} /><title>{band} observation dates</title></g> })}
        {timePoints.map(({ frame, time }) => { const lane = BANDS.indexOf(frame.band as typeof BANDS[number]); const x = 72 + (timeMax === timeMin ? 0.5 : (time - timeMin) / (timeMax - timeMin)) * 672; return <circle key={frameKey(frame)} cx={x} cy={28 + lane * 28} r={frameKey(frame) === frameKey(activeFrame!) ? 6 : 4} className={frameKey(frame) === frameKey(activeFrame!) ? 'selected' : ''} onClick={() => setActiveKey(frameKey(frame))} /> })}
        <text x="72" y={Math.max(95, BANDS.length * 28 + 20)}>{new Date(timeMin).toISOString().slice(0, 10)}</text><text x="650" y={Math.max(95, BANDS.length * 28 + 20)}>{new Date(timeMax).toISOString().slice(0, 10)}</text>
      </svg> : <p>No usable observation dates were returned for this result set.</p>}</div>}
      {activeFrame && <section className="research-results selected-observation">
        <div className="panel-title mono">SELECTED OBSERVATION</div>
        <h3>{activeFrame.band} / {activeFrame.release.toUpperCase().replace('SPHEREX_', '')}</h3>
        <p>{activeFrame.date}</p><p className="mono">{activeFrame.obs}</p>
        <BrowseImage frame={activeFrame} onStart={() => setReadyFrames((previous) => { const next = new Set(previous); next.delete(currentKey); return next })} onReady={() => setReadyFrames((previous) => new Set(previous).add(currentKey))} />
        <div className="research-playback"><button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause playback' : 'Play series'}</button><span>{activeIndex + 1} / {selectedFrames.length}{playing && !readyFrames.has(currentKey) ? ' - loading' : ''}</span></div>
        <a href={activeFrame.cutout} target="_blank" rel="noreferrer">Open cutout FITS</a><a href={activeFrame.url} target="_blank" rel="noreferrer">Open full MEF</a><a href={explorerUrl.toString()} target="_blank" rel="noreferrer">View this field in SPHEREx Explorer</a>
      </section>}
      <p className="research-note">The canvas uses a linear display stretch between the 2nd and 99.5th finite-pixel percentiles; this affects brightness only, not the FITS samples. Detector wavelength varies across the focal plane.</p>
    </section>}
      </section>
      <aside className="side research-case-side" aria-label="Tool readiness and case context">
        <section className="research-side-card"><div className="panel-title mono">INVESTIGATION TOOLS</div><Btn variant="ghost" disabled={!selectedFrames.length} onClick={downloadReport}>Download report</Btn>
          <div className="capability-grid" aria-label="Metadata-derived analysis capabilities">{([
            ['blink', 'Blink Comparator', 'Blink'], ['difference', 'Difference', 'Difference'], ['lightcurve', 'Light Curve', 'Light Curve'], ['phaseFold', 'Phase fold', 'Phase fold'], ['spectrum', 'Spectrum', 'Spectrum'],
          ] as const).map(([id, label, button]) => <div className="capability-card" key={id}><strong>{label}</strong>{capabilityLabel(id)}<p>{analysisCapabilities[id].reason}</p>{id === 'blink' && analysisCapabilities.blink.state === 'available' ? <button type="button" onClick={() => { setAnalysisTool(null); setView('blink') }}>{button}</button> : analysisCapabilities[id].state === 'available' && ['lightcurve', 'phaseFold'].includes(id) ? <button type="button" onClick={() => { setView('bands'); setAnalysisTool(id as 'lightcurve' | 'phaseFold') }}>{button}</button> : <button type="button" disabled title={analysisCapabilities[id].reason}>{button}</button>}</div>)}</div>
          <p className="tool-unavailable">Difference remains disabled pending validated PSF, background, quality-mask, and noise handling. Light Curve, Phase fold, and Spectrum require measured source data.</p>
        </section>
        {activeFrame && <section className="research-side-card"><div className="panel-title mono">FIELD CONTEXT</div><p>RA {Number(ra).toFixed(5)} / Dec {Number(dec).toFixed(5)}</p><p>{selectedFrames.length} selected observation files - {provenance === 'cached-live' ? 'cached snapshot' : 'live archive'}</p><p>{anomalyReports.length} local candidate report{anomalyReports.length === 1 ? '' : 's'}</p><p className="mono">{activeFrame.band} / {activeFrame.collection.toUpperCase()} / {activeFrame.processingRelease}</p><p>{activeFrame.date}</p><a href={activeFrame.cutout} target="_blank" rel="noreferrer">Open selected FITS cutout</a></section>}
      </aside>
    </div>}
    <SquadPanel field={{ ra: Number(ra), dec: Number(dec), fov: Number(fov), bands, frames: selectedFrames }} onOpenJob={loadField} />
    <p className="research-footnote">This screen searches IRSA’s public QR3 and QR2 wide-survey collections. Registered blink is visual-only and requires the processing worker; a difference image and time-coherent spectrum remain disabled until their science validation paths are complete. An archive frame list alone is not a calibrated light curve.</p>
  </div>
}
