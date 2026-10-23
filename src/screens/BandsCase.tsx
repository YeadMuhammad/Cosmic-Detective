import { useEffect, useMemo, useRef, useState } from 'react'
import { BARNARD_BANDS, BARNARD_TRACK, CHAPTERS, getLevel, GUIDE, LIVE_BAND_SECTORS, TILES } from '../data/fixtures'
import { useGame, type CaseSummary } from '../lib/store'
import { useTranslation } from 'react-i18next'
import { cdn, decStr, navigate, raStr } from '../lib/util'
import { sfx } from '../lib/sfx'
import { compose, loadGray, peakMap, SIZE, snap, snr, stretchOf, type Stretch } from '../lib/photometry'
import { Btn } from '../components/ui'
import { Briefing, CaseBar } from '../components/CaseShell'
import { Pipeline, useRunner, type Check, type Result } from '../components/Pipeline'
import { levelState } from './MapScreen'

const DET = 5 // detection threshold, signal-to-noise
const KEYS = BARNARD_BANDS.map((b) => b.key)
const SHORT: Record<string, string> = { dss1b: 'B', dss2r: 'R', '2massj': 'J', '2massk': 'Ks', w1: 'W1', w2: 'W2' }
const um = (k: string) => parseFloat(BARNARD_BANDS.find((b) => b.key === k)!.wl)
const label = (k: string) => BARNARD_BANDS.find((b) => b.key === k)!.label
const PRESETS: { id: string; name: string; rgb: (string | null)[] }[] = [
  { id: 'span', name: 'Optical → Mid-IR', rgb: ['w2', '2massk', 'dss1b'] },
  { id: 'optical', name: 'Optical', rgb: ['dss2r', 'dss2r', 'dss1b'] },
  { id: 'nir', name: 'Near-IR', rgb: ['2massk', '2massj', 'dss2r'] },
  { id: 'mir', name: 'Mid-IR', rgb: ['w2', 'w1', '2massk'] },
]
const arcsecPx = (TILES.barnard.size * 3600) / SIZE
const TARGET = 3 // index in BARNARD_TRACK of the mandatory source (the WISE position)
type Meas = { x: number; y: number; snr: Record<string, number> }
interface Flag { key: string; track: number | null; res: Result }

function verifyBands(m: Meas, repeat: boolean): { res: Result; track: number | null } {
  const det = KEYS.filter((k) => m.snr[k] >= DET)
  const fmt = (ks: string[]) => (ks.length ? ks.map((k) => SHORT[k]).join(', ') : 'none')
  const track = BARNARD_TRACK.findIndex((p) => Math.hypot(p.pos[0] - m.x, p.pos[1] - m.y) <= 12)
  const coverage: Check = { name: 'Band coverage check', status: det.length ? 'pass' : 'fail', note: `Detected (S/N ≥ ${DET}) in: ${fmt(det)}. Not detected in: ${fmt(KEYS.filter((k) => !det.includes(k)))}.` }

  if (track >= 0 && BARNARD_TRACK[track].bands.some((b) => det.includes(b))) {
    const p = BARNARD_TRACK[track]
    const own = p.bands.every((b) => det.includes(b))
    const others = KEYS.filter((k) => !p.bands.includes(k))
    const clean = others.every((k) => m.snr[k] < DET)
    const first = BARNARD_TRACK[0], last = BARNARD_TRACK[3]
    const arc = Math.hypot(last.pos[0] - first.pos[0], last.pos[1] - first.pos[1]) * arcsecPx
    const rate = arc / (last.year - first.year)
    const tile = TILES.barnard.catalog!
    const checks: Check[] = [
      coverage,
      { name: 'Counterpart check', status: own && clean ? 'pass' : 'info', note: clean ? `No counterpart at this pixel in the other ${others.length} bands. The ${p.label} see it here and nowhere else.` : 'Faint signal in neighbouring bands; blended with another source.' },
      { name: 'Position across epochs', status: 'pass', note: `A point source with the same colour appears at ${BARNARD_TRACK.length} different positions across the surveys, ${arc.toFixed(0)}″ end to end over ≈${last.year - first.year} years (≈${rate.toFixed(0)}″ per year). It is one object that moved.` },
      { name: 'Catalog cross-match', status: 'info', note: `Matches ${tile.name} (${tile.alias}). Proper motion ${tile.pm}.` },
    ]
    return { track, res: { verdict: 'known', xp: track === TARGET || repeat ? 0 : 20, correct: true, checks } }
  }
  if (det.length < 2) return { track: null, res: { verdict: 'rejected-stationary', xp: repeat ? 0 : 5, correct: false, checks: [{ ...coverage, status: 'fail', note: `Only ${fmt(det)} above the S/N ${DET} threshold. Nothing distinct enough to call a source.` }] } }
  return {
    track: null,
    res: {
      verdict: 'rejected-stationary', xp: repeat ? 0 : 5, correct: false,
      checks: [coverage, { name: 'Spectral shape check', status: 'fail', note: `Present at one position in ${det.length} of 6 bands, including the optical plates. An ordinary stationary star: nothing hides below the red here.` }],
    },
  }
}

export function BandsCase({ n }: { n: number }) {
  const { t } = useTranslation()
  const { s, set } = useGame()
  const level = getLevel(n)!
  const ch = CHAPTERS[level.chapter - 1]
  const ok = levelState(n, s.completed, s.tiles) !== 'locked' && levelState(n, s.completed, s.tiles) !== 'sealed'
  const [phase, setPhase] = useState<'briefing' | 'scan'>('briefing')
  const [data, setData] = useState<{ gray: Uint8ClampedArray[]; st: Stretch[]; peaks: Float32Array } | null>(null)
  const [failed, setFailed] = useState(false)
  const [rgb, setRgb] = useState<(string | null)[]>(PRESETS[0].rgb)
  const [boost, setBoost] = useState(1.6)
  const [marker, setMarker] = useState<Meas | null>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [logged, setLogged] = useState<string[]>([])
  const [flags, setFlags] = useState<Flag[]>([])
  const [shown, setShown] = useState<{ res: Result; track: number | null } | null>(null)
  const [note, setNote] = useState('')
  const [time, setTime] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    Promise.all(KEYS.map((k) => loadGray(BARNARD_BANDS.find((b) => b.key === k)!.file)))
      .then((gray) => { if (live) { const st = gray.map(stretchOf); setData({ gray, st, peaks: peakMap(gray) }) } })
      .catch(() => live && setFailed(true))
    return () => { live = false }
  }, [])
  useEffect(() => { if (phase !== 'scan') return; const id = setInterval(() => setTime((t) => t + 1), 1000); return () => clearInterval(id) }, [phase])

  useEffect(() => {
    if (!data || !canvas.current) return
    const g = canvas.current.getContext('2d')!
    const img = g.createImageData(SIZE, SIZE)
    const idx = rgb.map((k) => (k ? KEYS.indexOf(k) : -1))
    compose(img, idx.map((i) => (i >= 0 ? data.gray[i] : null)), idx.map((i) => (i >= 0 ? data.st[i] : null)), boost)
    g.putImageData(img, 0, 0)
  }, [data, rgb, boost])

  const runner = useRunner((res, key) => {
    const track = Number(key.split('|')[1]) >= 0 ? Number(key.split('|')[1]) : null
    setFlags((f) => [...f, { key: key.split('|')[0], track, res }])
    if (res.verdict === 'known') sfx.success()
  })

  const solved = flags.some((f) => f.track === TARGET && f.res.verdict === 'known')
  const xp = flags.reduce((a, f) => a + f.res.xp, 0) + logged.length * 5 + (solved ? 40 : 0)
  const summary = useMemo<CaseSummary>(() => ({
    level: n, title: level.title, solved, collected: false, xp,
    tiles: 1 + logged.length, correct: flags.filter((f) => f.res.correct).length, judged: flags.length,
    known: new Set(flags.filter((f) => f.res.verdict === 'known').map((f) => f.track)).size,
    artifacts: 0, clears: 0, results: [{ id: 'barnard', verdict: solved ? 'known' : 'unreviewed' }],
  }), [n, level.title, solved, xp, logged.length, flags])
  useEffect(() => { if (flags.length || logged.length) set((p) => ({ ...p, last: summary })) }, [summary, flags.length, logged.length, set])

  const pick = (e: React.MouseEvent) => {
    const r = box.current!.getBoundingClientRect()
    return [Math.min(SIZE - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * SIZE))), Math.min(SIZE - 1, Math.max(0, Math.round(((e.clientY - r.top) / r.height) * SIZE)))] as [number, number]
  }
  const place = (e: React.MouseEvent) => {
    if (!data || runner.running) return
    const [px, py] = pick(e)
    const [x, y] = snap(data.peaks, px, py)
    const m: Meas = { x, y, snr: Object.fromEntries(KEYS.map((k, i) => [k, snr(data.gray[i], x, y)])) }
    sfx.click(); setMarker(m); setShown(null); setNote('')
  }
  const keyOf = (m: Meas) => `${Math.round(m.x / 10)},${Math.round(m.y / 10)}`
  const flag = () => {
    if (!marker || runner.running) return
    const k = keyOf(marker)
    const repeat = flags.some((f) => f.key === k)
    const { res, track } = verifyBands(marker, repeat || (track0(marker) !== null && flags.some((f) => f.track === track0(marker) && f.res.verdict === 'known')))
    sfx.stamp(); setShown({ res, track })
    runner.run(`${k}|${track ?? -1}`, res)
  }
  const track0 = (m: Meas) => { const i = BARNARD_TRACK.findIndex((p) => Math.hypot(p.pos[0] - m.x, p.pos[1] - m.y) <= 12); return i >= 0 ? i : null }
  const log = () => {
    if (!marker) return
    const k = keyOf(marker)
    if (logged.includes(k)) { setNote('Already logged. Pick another source.'); sfx.reject(); return }
    if (logged.length >= 5) { setNote('Log full for this case (5 sources).'); sfx.reject(); return }
    setLogged((l) => [...l, k]); setNote(`Logged. +5 XP (${logged.length + 1}/5)`); sfx.pass()
  }

  if (!ok) {
    return (
      <div className="screen empty-state">
        <h1 className="display">{t('case.sealed_title')}</h1>
        <p>{t('case.sealed_body')}</p>
        <Btn onClick={() => navigate('/map')}>{t('case.back_to_board')}</Btn>
      </div>
    )
  }

  const tile = TILES.barnard
  const sky = (x: number, y: number) => ({ ra: tile.ra + (0.5 - x / SIZE) * tile.size / Math.cos((tile.dec * Math.PI) / 180), dec: tile.dec + (0.5 - y / SIZE) * tile.size })
  const c = sky(cursor?.[0] ?? SIZE / 2, cursor?.[1] ?? SIZE / 2)
  const mm = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`
  const active = runner.running ? runner.running.res : shown?.res ?? null
  const activeTrack = runner.running ? Number(runner.running.key.split('|')[1]) : shown?.track ?? -1
  const tag = rgb.every((k) => !k) ? 'All channels off' : rgb.every((k) => k === rgb[0]) ? `${label(rgb[0]!)} · single band` : `R ${rgb[0] ? SHORT[rgb[0]] : '–'} · G ${rgb[1] ? SHORT[rgb[1]] : '–'} · B ${rgb[2] ? SHORT[rgb[2]] : '–'}`

  return (
    <div className="screen case-screen" style={{ ['--accent' as any]: ch.accent }}>
      <CaseBar n={n} chapter={level.chapter} title={level.title} solved={solved}
        stats={[{ label: 'SOURCES LOGGED', value: <>{logged.length}<small>/5</small></> }, { label: 'CASE XP', value: `+${xp}`, xp: true }, { label: 'ELAPSED', value: mm }]}
        onFile={() => { set((p) => ({ ...p, last: summary })); navigate(`/debrief/${n}`) }} />

      <div className="case-grid">
        <aside className="tile-grid band-panel" aria-label="Sector map and bands">
          <div className="panel-title mono">{t('band.sector_map')}</div>
          <SectorMap note={setNote} />
          <div className="panel-title mono" style={{ marginTop: 18 }}>SPECTRAL BANDS</div>
          <div className="band-list">
            {BARNARD_BANDS.map((b) => (
              <button key={b.key} className={`band-row ${rgb.every((k) => k === b.key) ? 'on' : ''}`} onClick={() => { sfx.click(); setRgb([b.key, b.key, b.key]) }} style={{ ['--tint' as any]: b.tint }}>
                <i />
                <span><b>{b.label}</b><small className="mono">{b.wl} · {b.era}</small></span>
                {marker && <em className={`mono ${marker.snr[b.key] >= DET ? 'det' : ''}`}>{marker.snr[b.key] >= DET ? '●' : '○'}</em>}
              </button>
            ))}
          </div>
          <div className="panel-title mono" style={{ marginTop: 18 }}>CHANNEL MIXER</div>
          {(['R', 'G', 'B'] as const).map((ch2, i) => (
            <label key={ch2} className="mixer mono">
              <span className={`mix-${ch2}`}>{ch2}</span>
              <select value={rgb[i] ?? ''} onChange={(e) => { sfx.click(); setRgb((r) => r.map((v, j) => (j === i ? e.target.value || null : v))) }}>
                <option value="">off</option>
                {BARNARD_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
            </label>
          ))}
          <label className="mixer mono"><span>BOOST</span><input type="range" min={1} max={3} step={0.1} value={boost} onChange={(e) => setBoost(+e.target.value)} /></label>
        </aside>

        <section className="inspect">
          <div className="toolbar">
            <div className="seg">
              {PRESETS.map((p) => <button key={p.id} className={rgb.join() === p.rgb.join() ? 'on' : ''} onClick={() => { sfx.click(); setRgb(p.rgb) }}>{p.name}</button>)}
            </div>
            <span className="mono soft" style={{ marginLeft: 'auto' }}>Colour = wavelength. A source that is red here shines only in the longest bands.</span>
          </div>

          <div className="viewer">
            <div ref={box} className="viewer-img markable" onClick={place}
              onMouseMove={(e) => setCursor(pick(e))} onMouseLeave={() => setCursor(null)}>
              <canvas ref={canvas} width={SIZE} height={SIZE} className="band-canvas" />
              {!data && <div className="band-loading mono">{failed ? 'Could not load the band images.' : 'CALIBRATING 6 BANDS…'}</div>}
              <div className="reticle" /><div className="crt" />
              {solved && (
                <svg className="vector" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polyline points={BARNARD_TRACK.map((p) => `${(p.pos[0] / SIZE) * 100},${(p.pos[1] / SIZE) * 100}`).join(' ')} fill="none" stroke="var(--known)" strokeWidth=".7" strokeDasharray="2 1.4" vectorEffect="non-scaling-stroke" />
                  {BARNARD_TRACK.map((p) => <circle key={p.year} cx={(p.pos[0] / SIZE) * 100} cy={(p.pos[1] / SIZE) * 100} r="2.6" fill="none" stroke="var(--known)" strokeWidth=".5" />)}
                </svg>
              )}
              {solved && BARNARD_TRACK.map((p) => <span key={p.year} className="track-tag mono" style={{ left: `${(p.pos[0] / SIZE) * 100 + 3.5}%`, top: `${(p.pos[1] / SIZE) * 100}%` }}>{p.year}</span>)}
              {marker && <span className="marker" style={{ left: `${(marker.x / SIZE) * 100}%`, top: `${(marker.y / SIZE) * 100}%` }} />}
              <div className="epoch-tag b">COMPOSITE · {tag}</div>
            </div>
            <div className="viewer-foot mono">
              <span>RA {raStr(c.ra)}</span><span>DEC {decStr(c.dec)}</span>
              <span>FOV {(tile.size * 60).toFixed(0)}′ · {arcsecPx.toFixed(2)}″/px</span>
            </div>
          </div>

          <div className="action-bar">
            <div className="mono action-hint">{note || (marker ? `Source locked at pixel ${marker.x}, ${marker.y}. Log it, or flag it as the anomaly.` : 'Click a source. The marker snaps to the nearest peak and measures it in all six bands.')}</div>
            <Btn variant="ghost" disabled={!marker || !!runner.running} onClick={log}>Log source</Btn>
            <Btn variant="danger" disabled={!marker || !!runner.running} onClick={flag} className="flag-btn">{t('band.flag_anomaly')}</Btn>
          </div>
        </section>

        <aside className="side">
          {active ? (
            <Pipeline code={TILES.barnard.code} res={active} running={runner.running} target={activeTrack === TARGET}
              catalog={active.verdict === 'known' ? { name: TILES.barnard.catalog!.name, alias: TILES.barnard.catalog!.alias, note: TILES.barnard.catalog!.note, rows: [`μ ${TILES.barnard.catalog!.pm}`, `d ${TILES.barnard.catalog!.distance}`] } : null}
              extra={active.verdict.startsWith('rejected') ? 'A dismissed lead is still progress. It is one less false signal for the professionals.' : activeTrack === TARGET ? 'It has no optical twin because it is not where it used to be. Same star, 57 years later. Keep this lesson: blink across epochs before you call something new.' : activeTrack >= 0 ? 'Same star again, caught at an earlier epoch.' : undefined} />
          ) : (
            <div className="briefing-mini">
              <div className="panel-title mono">{t('band.case_notes')}</div>
              <p>{level.briefing}</p>
              <div className="guide-quote"><img src={cdn(GUIDE.img, 96)} alt="" /><span>“A cold thing hides in the red. Read the spectrum, not the picture.”</span></div>
            </div>
          )}

          <div className="profile">
            <div className="panel-title mono">SPECTRAL PROFILE{marker ? ` · PX ${marker.x}, ${marker.y}` : ''}</div>
            <Spectrum m={marker} />
            <p className="soft fine">Signal-to-noise measured in a 4 px aperture on the real image pixels of each band (display-scaled JPEG, so relative, not calibrated photometry). Filled dots are detections.</p>
          </div>

          <dl className="meta">
            <div className="panel-title mono">{t('band.sector_metadata')}</div>
            <div><dt>Sector</dt><dd className="mono">{tile.code}</dd></div>
            <div><dt>Centre RA</dt><dd className="mono">{raStr(tile.ra)}</dd></div>
            <div><dt>Centre Dec</dt><dd className="mono">{decStr(tile.dec)}</dd></div>
            <div><dt>Bands</dt><dd>DSS1 B · DSS2 R · 2MASS J, Ks · WISE W1, W2</dd></div>
            <div><dt>Span</dt><dd className="mono">0.45 – 4.6 µm</dd></div>
            <div><dt>Source</dt><dd>NASA SkyView · DSS, 2MASS, WISE · registered to one grid</dd></div>
          </dl>
        </aside>
      </div>

      {phase === 'briefing' && (
        <Briefing n={n} chapter={level.chapter} ch={ch} title={level.title} text={level.briefing}
          lesson={{ name: 'Sector Map & Multi-Band Compositor', text: 'Warm things glow at long wavelengths. Assign any three bands to red, green and blue and the colour of a source tells you its temperature. Sources that vanish in blue and blaze in the infrared are cold. Click one to read its spectral profile.' }}
          grid={[['SECTOR', `${LIVE_BAND_SECTORS.length} live`], ['TOOLS', 'Blink · Difference · Bands'], ['SCORING', 'Measured S/N per band'], ['DATA', 'Real DSS · 2MASS · WISE']]}
          onBegin={() => setPhase('scan')} />
      )}
    </div>
  )
}

/** Equirectangular map of every sector in the game. Only sectors with registered bands are live. */
function SectorMap({ note }: { note: (s: string) => void }) {
  const W = 276, H = 150, ra0 = 360, ra1 = 0, d0 = 60, d1 = -5
  const X = (ra: number) => ((ra0 - ra) / (ra0 - ra1)) * W
  const Y = (d: number) => ((d0 - d) / (d0 - d1)) * H
  return (
    <svg className="sector-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sector map">
      {[0, 60, 120, 180, 240, 300, 360].map((r) => <line key={r} x1={X(r)} x2={X(r)} y1={0} y2={H} />)}
      {[0, 20, 40, 60].map((d) => <line key={d} x1={0} x2={W} y1={Y(d)} y2={Y(d)} />)}
      <path d={`M0 ${Y(0)} H${W}`} className="eq" />
      {Object.values(TILES).map((tl) => {
        const live = LIVE_BAND_SECTORS.includes(tl.id)
        return (
          <g key={tl.id} onClick={() => { if (live) note('Sector OPH-0417 is live: six bands registered.'); else { sfx.reject(); note(`${tl.code}: multi-band cutouts not registered yet.`) } }} className={live ? 'live' : ''}>
            <circle cx={X(tl.ra)} cy={Y(tl.dec)} r={live ? 4.5 : 3} />
            {live && <circle cx={X(tl.ra)} cy={Y(tl.dec)} r="9" className="ring" />}
            {live && <text x={X(tl.ra) + 11} y={Y(tl.dec) + 3}>{tl.code}</text>}
          </g>
        )
      })}
      <text x="4" y={H - 4} className="ax">RA 24h ← → 0h</text>
    </svg>
  )
}

function Spectrum({ m }: { m: Meas | null }) {
  const W = 300, H = 170, L = 30, R = 12, T = 12, B = 44
  const lx = (k: string) => L + ((Math.log10(um(k)) - Math.log10(0.38)) / (Math.log10(5.2) - Math.log10(0.38))) * (W - L - R)
  const ly = (v: number) => H - B - Math.min(1, Math.log10(1 + Math.max(0, v)) / Math.log10(301)) * (H - B - T)
  const tick = [1, 10, 100]
  const pts = m ? KEYS.filter((k) => m.snr[k] >= DET).map((k) => `${lx(k)},${ly(m.snr[k])}`) : []
  return (
    <svg className="spectrum" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Signal-to-noise per band">
      {tick.map((v) => <g key={v}><line x1={L} x2={W - R} y1={ly(v)} y2={ly(v)} className="grid" /><text x={L - 4} y={ly(v) + 3} textAnchor="end">{v}</text></g>)}
      <line x1={L} x2={W - R} y1={ly(DET)} y2={ly(DET)} className="thr" /><text x={W - R} y={ly(DET) - 3} textAnchor="end" className="thr-t">detection S/N 5</text>
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="axis" />
      {pts.length > 1 && <polyline points={pts.join(' ')} className="curve" />}
      {KEYS.map((k) => {
        const b = BARNARD_BANDS.find((q) => q.key === k)!
        const v = m?.snr[k] ?? 0, d = m && v >= DET
        return (
          <g key={k} style={{ ['--tint' as any]: b.tint }}>
            {m && <line x1={lx(k)} x2={lx(k)} y1={H - B} y2={ly(v)} className="stem" />}
            <circle cx={lx(k)} cy={m ? ly(v) : H - B} r={m ? 5 : 3} className={d ? 'dot det' : 'dot'} />
            <text x={lx(k)} y={H - B + 14} textAnchor="middle" className="bl">{SHORT[k]}</text>
            <text x={lx(k)} y={H - B + 26} textAnchor="middle" className="wl">{um(k)}µm</text>
          </g>
        )
      })}
      {!m && <text x={W / 2} y={70} textAnchor="middle" className="empty">Click a source to read it</text>}
    </svg>
  )
}
