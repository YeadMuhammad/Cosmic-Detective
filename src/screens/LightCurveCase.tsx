import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CHAPTERS, getLevel, GUIDE } from '../data/fixtures'
import { CURVES, classOf, drift, excursions, fold, loadSeries, singleFrameHits, type CurveMeta, type Series, type SignalClass } from '../data/lightcurves'
import { useGame, type CaseSummary } from '../lib/store'
import { cdn, navigate } from '../lib/util'
import { sfx } from '../lib/sfx'
import { Btn, Chip } from '../components/ui'
import { Briefing, CaseBar } from '../components/CaseShell'
import { Pipeline, useRunner, type Check, type Result } from '../components/Pipeline'
import { levelState } from './MapScreen'

const ZMIN = 8 // folded-profile significance needed to call a signal
const RMIN = 0.5 // even/odd cycle agreement needed to call it repeating
const CLASSES: { id: SignalClass; name: string; hint: string }[] = [
  { id: 'periodic', name: 'Repeating signal', hint: 'Dips or pulses that return on a schedule' },
  { id: 'flare', name: 'Outburst', hint: 'Sudden brightening that fades' },
  { id: 'glitch', name: 'Instrument glitch', hint: 'Ramps, steps or single-frame spikes' },
  { id: 'none', name: 'Nothing here', hint: 'Flat within the noise' },
]
const nf = (v: number, d = 1) => v.toFixed(d)

function verifyCurve(m: CurveMeta, s: Series, cls: SignalClass, P: number, chapter: number, weight: number, isTarget: boolean): Result {
  const truth = classOf(m.kind)
  const consensus = (agree: number): Check => ({ name: 'Weighted consensus', status: agree > 0.7 ? 'pass' : 'info', note: `${9 + (m.code.charCodeAt(4) % 9)} analysts reviewed · agreement ${agree.toFixed(2)} · your weight ×${weight.toFixed(1)}` })
  const withCons = (c: Check[], a: number) => (chapter >= 2 ? [...c, consensus(a)] : c)
  const cat: Check | null = m.catalog ? { name: 'Catalog cross-match', status: 'info', note: `Matches ${m.catalog.name} (${m.catalog.alias}).` } : null

  if (cls === 'periodic') {
    const f = fold(s, P)
    const ok = truth === 'periodic' && m.period != null && (Math.abs(P - m.period) / m.period < 0.02 || (m.kind === 'eclipse' && Math.abs(P - 2 * m.period) / (2 * m.period) < 0.02))
    const detect: Check = { name: 'Signal detection check', status: f.z >= ZMIN ? 'pass' : 'fail', note: f.z >= ZMIN ? `Folded at ${P.toFixed(3)} d the profile departs from flat at ${nf(f.z)}σ equivalent (threshold ${ZMIN}).` : `Folded at ${P.toFixed(3)} d the profile is ${nf(f.z)}σ from flat. No coherent signal at this period.` }
    const cons: Check = { name: 'Cycle-to-cycle check', status: f.r >= RMIN ? 'pass' : 'fail', note: `Odd and even cycles ${f.r >= RMIN ? 'agree' : 'disagree'} (r = ${nf(f.r, 2)}). ${f.r >= RMIN ? 'The pattern repeats.' : 'The pattern does not repeat from one cycle to the next.'}` }
    if (ok && f.z >= ZMIN && f.r >= RMIN) return { verdict: 'known', xp: isTarget ? 0 : 60, correct: true, checks: withCons([detect, cons, cat!], 0.91) }
    if (truth === 'periodic') return { verdict: 'rejected-stationary', xp: 5, correct: false, checks: [detect.status === 'fail' ? detect : { ...detect, status: 'fail', note: `Signal present, but ${P.toFixed(3)} d is not its period. Features do not line up when folded.` }] }
    if (truth === 'glitch') return { verdict: 'rejected-halo', xp: 10, correct: false, checks: [detect, { ...cons, status: 'fail' }, { name: 'Systematics check', status: 'fail', note: m.rejectNote ?? 'Instrumental.' }] }
    return { verdict: 'rejected-stationary', xp: 5, correct: false, checks: [{ ...detect, status: 'fail' }, ...(truth === 'flare' ? [{ ...cons, status: 'fail' as const }] : []), { name: 'Source check', status: 'fail', note: m.rejectNote ?? 'Nothing repeats here.' }] }
  }
  if (cls === 'flare') {
    const ex = excursions(s), real = ex.hits.filter((h) => h.n >= 2), sustained = real.length
    const ev: Check = { name: 'Outburst check', status: sustained > 0 ? 'pass' : 'fail', note: sustained > 0 ? `${sustained} sustained excursion${sustained > 1 ? 's' : ''} above 5σ, the largest +${nf((Math.max(...real.map((h) => h.amp)) / ex.median) * 100, 0)}% over quiescent, each fading over several frames.` : 'No sustained excursion above 5σ. Nothing brightens and fades here.' }
    if (truth === 'flare') return { verdict: 'known', xp: isTarget ? 0 : 60, correct: true, checks: withCons([ev, { name: 'Shape check', status: 'pass', note: 'Fast rise and slower decay, the signature of a stellar flare.' }, cat!], 0.9) }
    return { verdict: 'rejected-stationary', xp: 5, correct: false, checks: [ev.status === 'fail' ? ev : { ...ev, status: 'fail' }, { name: 'Source check', status: 'fail', note: m.rejectNote ?? m.catalog?.note ?? 'Not an outburst.' }] }
  }
  if (cls === 'glitch') {
    const single = singleFrameHits(s), d = drift(s)
    const evid: Check = { name: 'Systematics check', status: truth === 'glitch' ? 'pass' : 'fail', note: truth === 'glitch' ? `${single ? `${single} single-frame outliers. ` : ''}${Math.abs(d) > 5 ? `Start-up drift of ${nf(Math.abs(d))}σ. ` : ''}${m.rejectNote}` : `No single-frame spikes, no ramp or step (${single} outliers, drift ${nf(Math.abs(d))}σ). The behaviour is not instrumental.` }
    if (truth === 'glitch') return { verdict: 'clear', xp: 15, correct: true, checks: withCons([evid], 0.88) }
    return { verdict: 'rejected-stationary', xp: 5, correct: false, checks: [evid, ...(m.catalog ? [{ name: 'Source check', status: 'fail' as const, note: `This is real astrophysical behaviour: ${m.catalog.name}.` }] : [])] }
  }
  // none
  if (truth === 'none' || truth === 'glitch') return { verdict: 'clear', xp: 15, correct: true, checks: withCons([{ name: 'Signal detection check', status: 'pass', note: truth === 'none' ? m.rejectNote! : 'No astrophysical signal. The only structure is instrumental.' }], 0.66) }
  return { verdict: 'missed', xp: 0, correct: false, checks: [{ name: 'Signal detection check', status: 'fail', note: truth === 'flare' ? 'This star brightens suddenly and fades. Look at the raw series again.' : 'A repeating signal is hiding in this series. Fold it and watch for a profile that stands up.' }] }
}

export function LightCurveCase({ n }: { n: number }) {
  const { t } = useTranslation()
  const { s, set } = useGame()
  const level = getLevel(n)!
  const ch = CHAPTERS[level.chapter - 1]
  const st = levelState(n, s.completed, s.tiles)
  const ok = st !== 'locked' && st !== 'sealed'
  const [phase, setPhase] = useState<'briefing' | 'scan'>('briefing')
  const [sel, setSel] = useState<string | null>(null)
  const [series, setSeries] = useState<Record<string, Series>>({})
  const [view, setView] = useState<'raw' | 'fold'>('raw')
  const [period, setPeriod] = useState<Record<string, number>>({})
  const [cls, setCls] = useState<Record<string, SignalClass | undefined>>({})
  const [results, setResults] = useState<Record<string, Result>>({})
  const [time, setTime] = useState(0)

  useEffect(() => { level.tiles.forEach((id) => loadSeries(id).then((x) => setSeries((p) => ({ ...p, [id]: x })))) }, [level])
  useEffect(() => { if (phase !== 'scan') return; const id = setInterval(() => setTime((t) => t + 1), 1000); return () => clearInterval(id) }, [phase])

  const runner = useRunner((res, id) => {
    setResults((prev) => (prev[id] && id !== level.target ? prev : { ...prev, [id]: res }))
    if (res.verdict === 'known') sfx.success()
  })

  const m = sel ? CURVES[sel] : null
  const data = sel ? series[sel] : undefined
  const P = sel ? period[sel] ?? 2.5 : 2.5
  const f = useMemo(() => (data ? fold(data, P) : null), [data, P])
  const cur = sel ? results[sel] : undefined
  const locked = !!cur && sel !== level.target
  const solved = results[level.target]?.verdict === 'known'
  const reviewed = Object.keys(results).length

  const summary = useMemo<CaseSummary>(() => {
    const r = Object.values(results)
    return {
      level: n, title: level.title, solved, collected: false,
      xp: r.reduce((a, b) => a + b.xp, 0) + (solved && reviewed === level.tiles.length ? 40 : 0),
      tiles: reviewed, correct: r.filter((x) => x.correct).length, judged: r.length,
      known: r.filter((x) => x.verdict === 'known').length, artifacts: r.filter((x) => x.verdict === 'rejected-halo').length,
      clears: r.filter((x) => x.verdict === 'clear' || x.verdict === 'pending').length,
      results: level.tiles.map((id) => ({ id, verdict: results[id]?.verdict ?? 'unreviewed' })),
    }
  }, [results, level, n, solved, reviewed])
  useEffect(() => { if (reviewed) set((p) => ({ ...p, last: summary })) }, [summary, reviewed, set])

  const open = (id: string) => { sfx.open(); setSel(id) }
  const submit = () => {
    if (!m || !data || !sel || runner.running || locked) return
    const c = cls[sel]
    if (!c) { sfx.reject(); return }
    sfx.stamp()
    runner.run(sel, verifyCurve(m, data, c, P, level.chapter, [1, 1.4, 2.1, 2.9, 4][Math.min(4, Math.max(0, level.chapter - 1))], sel === level.target))
  }

  useEffect(() => {
    if (phase !== 'scan') return
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return
      if (e.key === '1') setView('raw')
      if (e.key === '2') setView('fold')
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = sel ? level.tiles.indexOf(sel) : -1
        open(level.tiles[(i + (e.key === 'ArrowRight' ? 1 : level.tiles.length - 1)) % level.tiles.length])
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  if (!ok) {
    return (
      <div className="screen empty-state">
        <h1 className="display">{t('case.sealed_title')}</h1>
        <p>{t('case.sealed_body')}</p>
        <Btn onClick={() => navigate('/map')}>{t('case.back_to_board')}</Btn>
      </div>
    )
  }

  const mm = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`
  const display = runner.running && runner.running.key === sel ? runner.running : null
  const res = display ? display.res : cur
  const setP = (v: number) => sel && setPeriod((p) => ({ ...p, [sel]: Math.min(12, Math.max(0.3, Math.round(v * 10000) / 10000)) }))
  const meter = f ? Math.max(0, Math.min(1, f.z / (ZMIN * 2.5))) : 0

  return (
    <div className="screen case-screen" style={{ ['--accent' as any]: ch.accent }}>
      <CaseBar n={n} chapter={level.chapter} title={level.title} solved={solved}
        stats={[{ label: 'REVIEWED', value: <>{reviewed}<small>/{level.tiles.length}</small> </> }, { label: 'CASE XP', value: `+${summary.xp}`, xp: true }, { label: 'ELAPSED', value: mm }]}
        onFile={() => { set((p) => ({ ...p, last: summary })); navigate(`/debrief/${n}`) }} />

      <div className="case-grid">
        <aside className="tile-grid" aria-label="Light curve batch">
          <div className="panel-title mono">LIGHT CURVE BATCH · {level.tiles.length}</div>
          <div className="tiles">
            {level.tiles.map((id, i) => {
              const r = results[id]
              return (
                <button key={id} className={`tile-thumb lc-thumb ${sel === id ? 'sel' : ''} ${r ? 'done' : ''}`} onClick={() => open(id)} onMouseEnter={() => sfx.hover()} style={{ animationDelay: `${i * 40}ms` }}>
                  <Spark s={series[id]} />
                  <span className="thumb-code mono">{CURVES[id].code}</span>
                  {r && <span className="thumb-chip"><Chip v={r.verdict} small /></span>}
                  {id === level.target && solved && <span className="thumb-star mono">TARGET</span>}
                </button>
              )
            })}
          </div>
          <div className="kbd-help mono"><span><kbd>1</kbd> raw</span><span><kbd>2</kbd> fold</span><span><kbd>←</kbd><kbd>→</kbd> curves</span></div>
        </aside>

        <section className="inspect">
          {m && data ? (
            <>
              <div className="toolbar">
                <div className="seg">
                  <button className={view === 'raw' ? 'on' : ''} onClick={() => { sfx.click(); setView('raw') }}>Raw series</button>
                  <button className={view === 'fold' ? 'on' : ''} onClick={() => { sfx.click(); setView('fold') }}>Phase fold</button>
                </div>
                <span className="mono soft" style={{ marginLeft: 'auto' }}>{view === 'raw' ? 'Brightness against time.' : 'Every cycle stacked on top of the others.'}</span>
              </div>

              <LightChart s={data} view={view} P={P} f={f!} />

              <div className={`fold-panel ${view === 'fold' ? '' : 'dim'}`}>
                <div className="fold-top mono">
                  <span>TRIAL PERIOD</span><b>{P.toFixed(3)} d</b>
                  <button onClick={() => setP(P - 0.01)} aria-label="Decrease by 0.01 days">−.01</button>
                  <button onClick={() => setP(P - 0.001)} aria-label="Decrease by 0.001 days">−.001</button>
                  <button onClick={() => setP(P + 0.001)} aria-label="Increase by 0.001 days">+.001</button>
                  <button onClick={() => setP(P + 0.01)} aria-label="Increase by 0.01 days">+.01</button>
                </div>
                <input type="range" min={0.5} max={12} step={0.005} value={P} onChange={(e) => { setP(+e.target.value); if (view !== 'fold') setView('fold') }} aria-label="Trial period in days" />
                <div className="coh">
                  <span className="mono">COHERENCE</span>
                  <div className="coh-bar"><i style={{ width: `${meter * 100}%` }} className={f!.z >= ZMIN ? 'hit' : ''} /><u style={{ left: `${(1 / 2.5) * 100}%` }} /></div>
                  <b className="mono">{f!.z >= ZMIN ? 'SIGNAL' : f!.z >= 3 ? 'HINT' : 'NOISE'} · {nf(f!.z)}σ</b>
                </div>
              </div>

              <div className="classify">
                <div className="panel-title mono">WHAT IS THIS SIGNAL?</div>
                <div className="class-grid" role="radiogroup" aria-label="Signal type">
                  {CLASSES.map((c) => (
                    <button key={c.id} role="radio" aria-checked={cls[sel!] === c.id} className={`class-opt ${cls[sel!] === c.id ? 'on' : ''}`} disabled={locked} onClick={() => { sfx.click(); setCls((p) => ({ ...p, [sel!]: c.id })) }}>
                      <b>{c.name}</b><small>{c.hint}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="action-bar">
                <div className="mono action-hint">{locked ? 'Curve reviewed. Pick another from the batch.' : cls[sel!] === 'periodic' ? `Classifying with a period of ${P.toFixed(3)} d.` : cls[sel!] ? 'Classification set.' : 'Choose a signal type, then submit.'}</div>
                <Btn variant="danger" disabled={locked || !!runner.running || !cls[sel!]} onClick={submit} className="flag-btn">Submit classification</Btn>
              </div>
            </>
          ) : (
            <div className="inspect-empty">
              <div className="scan-sweep" />
              <h3 className="display">Select a light curve</h3>
              <p>Each tile in the batch is one star observed over days. Read it raw, then fold it.</p>
            </div>
          )}
        </section>

        <aside className="side">
          {res && m ? (
            <Pipeline code={m.code} res={res} running={display} target={sel === level.target}
              catalog={m.catalog ?? null}
              extra={res.verdict.startsWith('rejected') ? 'A dismissed lead is still progress. It is one less false signal for the professionals.' : res.verdict === 'clear' ? 'A clean negative is still a result.' : undefined} />
          ) : (
            <div className="briefing-mini">
              <div className="panel-title mono">CASE NOTES</div>
              <p>{level.briefing}</p>
              <div className="guide-quote"><img src={cdn(GUIDE.img, 96)} alt="" /><span>“Noise is random. A signal keeps its appointments.”</span></div>
            </div>
          )}
          {m && data && (
            <dl className="meta">
              <div className="panel-title mono">TARGET METADATA</div>
              <div><dt>Curve</dt><dd className="mono">{m.code}</dd></div>
              <div><dt>Points</dt><dd className="mono">{data.t.length} over {(data.t[data.t.length - 1] - data.t[0]).toFixed(1)} d</dd></div>
              <div><dt>Cadence</dt><dd className="mono">{m.cadence >= 1 / 24 ? `${nf(m.cadence * 24, 0)} h` : `${nf(m.cadence * 1440, 0)} min`}</dd></div>
              <div><dt>Scatter</dt><dd className="mono">≈{nf(m.noise * 100, 1)}% per point</dd></div>
              <div><dt>Mission</dt><dd>{m.mission}</dd></div>
              <div><dt>Data</dt><dd className={data.real ? '' : 'sim'}>{data.real ? 'Archival photometry' : 'Simulated from published ephemeris'}</dd></div>
              {cur && <div><dt>Field</dt><dd>{m.name}</dd></div>}
            </dl>
          )}
        </aside>
      </div>

      {phase === 'briefing' && (
        <Briefing n={n} chapter={level.chapter} ch={ch} title={level.title} text={level.briefing}
          lesson={{ name: 'Light Curve Analyzer', text: 'A light curve is brightness against time. A planet crossing a star, two stars eclipsing, a star that swells and shrinks: each repeats. Fold the series at a trial period and, when you hit the right one, the scatter collapses into a single clean shape.' }}
          grid={[['BATCH', `${level.tiles.length} light curves`], ['TOOLS', 'Raw · Phase fold · Coherence'], ['SCORING', 'Measured significance'], ['DATA', 'Modelled from published ephemerides']]}
          onBegin={() => setPhase('scan')} />
      )}
    </div>
  )
}

function Spark({ s }: { s?: Series }) {
  if (!s) return <svg className="spark" viewBox="0 0 100 100" />
  const step = Math.max(1, Math.floor(s.t.length / 80))
  const lo = Math.min(...s.f), hi = Math.max(...s.f), t1 = s.t[s.t.length - 1]
  const pts = s.t.filter((_, i) => i % step === 0).map((t, i) => `${(t / t1) * 100},${88 - ((s.f[i * step] - lo) / (hi - lo || 1)) * 72}`)
  return <svg className="spark" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={pts.join(' ')} /></svg>
}

function LightChart({ s, view, P, f }: { s: Series; view: 'raw' | 'fold'; P: number; f: ReturnType<typeof fold> }) {
  const W = 720, H = 300, L = 54, R = 14, T = 14, B = 40
  const sorted = [...s.f].sort((a, b) => a - b)
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  let lo = q(0.003), hi = q(0.997)
  const pad = (hi - lo) * 0.08 || 0.01
  lo -= pad; hi += pad
  const t1 = s.t[s.t.length - 1]
  const X = (v: number) => L + (v / (view === 'raw' ? t1 : 1)) * (W - L - R)
  const Y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const xs = view === 'raw' ? s.t : f.phase
  const ticks = view === 'raw' ? Array.from({ length: 6 }, (_, i) => (t1 * i) / 5) : [0, 0.25, 0.5, 0.75, 1]
  const yt = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
  const nb = f.bins.length
  const line = view === 'fold' ? f.bins.map((v, b) => (v == null ? null : `${X((b + 0.5) / nb)},${Y(v)}`)).filter(Boolean) : []
  return (
    <svg className="lc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={view === 'raw' ? 'Brightness against time' : `Brightness folded at ${P.toFixed(3)} days`}>
      {yt.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="grid" /><text x={L - 6} y={Y(v) + 3} textAnchor="end">{v.toFixed(3)}</text></g>)}
      {ticks.map((v, i) => <g key={i}><line x1={X(v)} x2={X(v)} y1={T} y2={H - B} className="grid" /><text x={X(v)} y={H - B + 16} textAnchor="middle">{view === 'raw' ? v.toFixed(1) : v.toFixed(2)}</text></g>)}
      {xs.map((x, i) => { const y = s.f[i]; return y < lo || y > hi ? null : <circle key={i} cx={X(x)} cy={Y(y)} r={view === 'raw' ? 1.9 : 1.7} className="pt" /> })}
      {view === 'fold' && line.length > 1 && <polyline points={line.join(' ')} className="bin-line" />}
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="axl">{view === 'raw' ? 'time (days)' : `phase  (P = ${P.toFixed(3)} d)`}</text>
      <text transform={`translate(12 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" className="axl">relative brightness</text>
    </svg>
  )
}
