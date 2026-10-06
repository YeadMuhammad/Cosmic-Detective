import { useEffect, useMemo, useRef, useState } from 'react'
import { CHAPTERS, getLevel, GUIDE, rankFor, TILE_IMG, TILES, TOOLS, type Tile, type Verdict } from '../data/fixtures'
import { useGame, type CaseSummary } from '../lib/store'
import { cdn, decStr, navigate, raStr } from '../lib/util'
import { sfx } from '../lib/sfx'
import { TileViewer, type ViewMode } from '../components/TileViewer'
import { Btn, Chip } from '../components/ui'
import { levelState } from './MapScreen'

type CheckStatus = 'wait' | 'run' | 'pass' | 'fail' | 'info'
interface Check { name: string; status: CheckStatus; note: string }
interface Result { verdict: Verdict; xp: number; correct: boolean; checks: Check[]; marker: [number, number] | null }

const dist = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1])

/**
 * Demo stand-in for the verification service. Mirrors the pipeline in the design
 * doc: stationary source check, blend & halo check, catalog cross-match, and
 * (from chapter 2) weighted consensus. Answers come from the tile fixtures.
 */
function verify(tile: Tile, marker: [number, number] | null, action: 'flag' | 'clear', chapter: number, weight: number, isTarget: boolean): Result {
  const consensus = (agree: number): Check => ({ name: 'Weighted consensus', status: agree > 0.7 ? 'pass' : 'info', note: `${9 + (tile.code.charCodeAt(4) % 9)} analysts reviewed · agreement ${agree.toFixed(2)} · your weight ×${weight.toFixed(1)}` })
  if (action === 'clear') {
    if (tile.kind === 'mover') return {
      verdict: 'missed', xp: 0, correct: false, marker,
      checks: [{ name: 'Stationary source check', status: 'fail', note: 'A source in this tile changed position between epochs. Look again with the blink comparator.' }],
    }
    const checks: Check[] = [{ name: 'Stationary source check', status: 'pass', note: tile.rejectNote ?? 'No displaced sources.' }]
    if (chapter >= 2) checks.push(consensus(0.62))
    return { verdict: chapter >= 2 ? 'pending' : 'clear', xp: 15, correct: true, checks, marker }
  }
  if (tile.kind === 'mover' && tile.a && tile.b && marker && (dist(marker, tile.a) < 0.08 || dist(marker, tile.b) < 0.08)) {
    const arcsec = dist(tile.a, tile.b) * tile.size * 3600
    const checks: Check[] = [
      { name: 'Stationary source check', status: 'pass', note: `Source displaced ${arcsec.toFixed(0)}″ between epochs. Real motion.` },
      { name: 'Blend and halo check', status: 'pass', note: 'Point-like profile at both positions. No bright neighbour inside the halo radius.' },
      { name: 'Catalog cross-match', status: 'info', note: `Matches ${tile.catalog!.name} (${tile.catalog!.alias}). Proper motion ${tile.catalog!.pm}.` },
    ]
    if (chapter >= 2) checks.push(consensus(0.91))
    return { verdict: 'known', xp: isTarget ? 0 : 60, correct: true, checks, marker }
  }
  if (tile.kind === 'halo' || tile.kind === 'blend') return {
    verdict: 'rejected-halo', xp: 10, correct: false, marker,
    checks: [
      { name: 'Stationary source check', status: 'pass', note: 'Apparent change between epochs detected.' },
      { name: 'Blend and halo check', status: 'fail', note: tile.rejectNote! },
    ],
  }
  return {
    verdict: 'rejected-stationary', xp: 5, correct: false, marker,
    checks: [{ name: 'Stationary source check', status: 'fail', note: tile.kind === 'mover' ? 'The source you marked holds its position in both epochs. Something else in this tile moved.' : tile.rejectNote! }],
  }
}

export function CaseScreen({ n }: { n: number }) {
  const { s, set } = useGame()
  const level = getLevel(n)
  const rank = rankFor(s.tiles)
  const tutorial = s.tutorial
  const [phase, setPhase] = useState<'briefing' | 'scan'>(tutorial && tutorial > 1 ? 'scan' : 'briefing')
  const [results, setResults] = useState<Record<string, Result>>({})
  const [sel, setSel] = useState<string | null>(null)
  const [mode, setMode] = useState<ViewMode>('a')
  const [speed, setSpeed] = useState(650)
  const [marker, setMarker] = useState<[number, number] | null>(null)
  const [running, setRunning] = useState<{ id: string; res: Result; shown: number } | null>(null)
  const [time, setTime] = useState(0)
  const ticks = useRef(0)

  const ok = level && levelState(n, s.completed, s.tiles) !== 'locked' && levelState(n, s.completed, s.tiles) !== 'sealed'
  const chapter = level?.chapter ?? 1
  const tools = { blink: true, diff: rank.n >= 2 && chapter >= 2, bands: false, lightcurve: false }

  useEffect(() => { if (phase !== 'scan') return; const id = setInterval(() => setTime((t) => t + 1), 1000); return () => clearInterval(id) }, [phase])

  const tile = sel ? TILES[sel] : null
  const solved = !!level && results[level.target]?.verdict === 'known'
  const reviewed = Object.keys(results).length

  // Keep the case summary current so the debrief (and the tutorial) can read it.
  const summary = useMemo<CaseSummary | null>(() => {
    if (!level) return null
    const r = Object.values(results)
    return {
      level: n, title: level.title, solved, collected: false,
      xp: r.reduce((a, b) => a + b.xp, 0) + (level.tutorial ? 50 : 0) + (solved && reviewed === level.tiles.length ? 40 : 0),
      tiles: reviewed, correct: r.filter((x) => x.correct).length, judged: r.length,
      known: r.filter((x) => x.verdict === 'known').length, artifacts: r.filter((x) => x.verdict === 'rejected-halo').length,
      clears: r.filter((x) => x.verdict === 'clear' || x.verdict === 'pending').length,
      results: level.tiles.map((id) => ({ id, verdict: results[id]?.verdict ?? 'unreviewed' })),
    }
  }, [results, level, n, solved, reviewed])
  useEffect(() => { if (summary && reviewed) set((p) => ({ ...p, last: summary })) }, [summary, reviewed, set])

  const open = (id: string) => {
    sfx.open(); setSel(id); setMarker(results[id]?.marker ?? null); setMode('a')
    if (tutorial === 2 && id === level?.target) set((p) => ({ ...p, tutorial: 3 }))
  }
  const setTool = (m: ViewMode) => {
    sfx.click(); setMode(m); ticks.current = 0
  }
  const onTick = () => {
    ticks.current++
    if (tutorial === 3 && ticks.current >= 2) set((p) => ({ ...p, tutorial: 4 }))
  }

  const submit = (action: 'flag' | 'clear') => {
    if (!tile || !level || running) return
    if (action === 'flag' && !marker) { sfx.reject(); return }
    action === 'flag' ? sfx.stamp() : sfx.click()
    const res = verify(tile, marker, action, chapter, rank.weight, tile.id === level.target)
    setRunning({ id: tile.id, res, shown: 0 })
    res.checks.forEach((c, i) => setTimeout(() => {
      setRunning((r) => r && { ...r, shown: i + 1 })
      c.status === 'fail' ? sfx.reject() : c.status === 'pass' ? sfx.pass() : sfx.scan()
    }, 650 * (i + 1)))
    setTimeout(() => {
      // Bonus tiles are one-shot; the mandatory target may be retried until solved.
      setResults((prev) => {
        const keep = prev[tile.id] && tile.id !== level.target
        return keep ? prev : { ...prev, [tile.id]: res }
      })
      if (res.verdict === 'known') sfx.success()
      if (tutorial === 4 && tile.id === level.target && res.verdict === 'known') set((p) => ({ ...p, tutorial: 5 }))
    }, 650 * (res.checks.length + 1))
  }

  // keyboard shortcuts
  useEffect(() => {
    if (phase !== 'scan') return
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || s.tutorial) return
      const k = e.key.toLowerCase()
      if (k === ' ') { e.preventDefault(); setTool(mode === 'blink' ? 'a' : 'blink') }
      if (k === '1') setTool('a')
      if (k === '2') setTool('b')
      if (k === 'd' && tools.diff) setTool('diff')
      if (k === 'f') submit('flag')
      if (k === 'c') submit('clear')
      if ((k === 'arrowright' || k === 'arrowleft') && level) {
        const i = sel ? level.tiles.indexOf(sel) : -1
        open(level.tiles[(i + (k === 'arrowright' ? 1 : level.tiles.length - 1)) % level.tiles.length])
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  if (!level || !ok) {
    return (
      <div className="screen empty-state">
        <h1 className="display">Case file sealed</h1>
        <p>This case is not open to you yet. Clear earlier cases or earn a higher rank to unlock it.</p>
        <Btn onClick={() => navigate('/map')}>Back to the case board</Btn>
      </div>
    )
  }
  const ch = CHAPTERS[chapter - 1]
  const cur = tile ? results[tile.id] : undefined
  const locked = !!cur && tile?.id !== level.target
  const display = running && running.id === tile?.id ? running : null
  const resultToShow = display ? display.res : cur
  const mm = `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`

  return (
    <div className="screen case-screen" style={{ ['--accent' as any]: ch.accent }}>
      <div className="case-bar">
        <div className="case-id">
          <span className="mono kicker">CH {chapter} · CASE {String(n).padStart(3, '0')}</span>
          <h1 className="display">{level.title}</h1>
        </div>
        <div className={`objective ${solved ? 'done' : ''}`}>
          <span className="obj-box">{solved && <svg viewBox="0 0 16 16"><path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.6" /></svg>}</span>
          <div><span className="mono">MANDATORY</span>Flag the primary anomaly</div>
        </div>
        <div className="case-stats mono">
          <div><b>{reviewed}</b>/{level.tiles.length}<span>REVIEWED</span></div>
          <div><b className="xp-col">+{summary?.xp ?? 0}</b><span>CASE XP</span></div>
          <div><b>{mm}</b><span>ELAPSED</span></div>
        </div>
        <div className="case-actions">
          <Btn variant="ghost" onClick={() => navigate('/map')}>Abandon</Btn>
          <Btn variant="ok" disabled={!solved} onClick={() => { set((p) => ({ ...p, last: summary })); navigate(`/debrief/${n}`) }} title={solved ? '' : 'Solve the mandatory target first'}>File report</Btn>
        </div>
      </div>

      <div className="case-grid">
        <aside className="tile-grid" aria-label="Tile batch">
          <div className="panel-title mono">SKY TILE BATCH · {level.tiles.length}</div>
          <div className="tiles">
            {level.tiles.map((id, i) => {
              const t = TILES[id]
              const r = results[id]
              return (
                <button key={id} className={`tile-thumb ${sel === id ? 'sel' : ''} ${r ? 'done' : ''} ${tutorial === 2 && id === level.target ? 'tut-pulse' : ''}`} onClick={() => open(id)} onMouseEnter={() => sfx.hover()} data-tut={id === level.target ? 'tile-target' : undefined} style={{ animationDelay: `${i * 40}ms` }}>
                  <img src={cdn(TILE_IMG(id, 'b'), 200)} alt="" loading="lazy" />
                  <span className="thumb-code mono">{t.code}</span>
                  {r && <span className="thumb-chip"><Chip v={r.verdict} small /></span>}
                  {id === level.target && solved && <span className="thumb-star mono">TARGET</span>}
                </button>
              )
            })}
          </div>
          <div className="kbd-help mono">
            <span><kbd>Space</kbd> blink</span><span><kbd>1</kbd><kbd>2</kbd> epochs</span>{tools.diff && <span><kbd>D</kbd> diff</span>}<span><kbd>F</kbd> flag</span><span><kbd>C</kbd> clear</span><span><kbd>←</kbd><kbd>→</kbd> tiles</span>
          </div>
        </aside>

        <section className="inspect" data-tut="inspect">
          {tile ? (
            <>
              <div className="toolbar">
                <div className="seg">
                  <button className={mode === 'a' ? 'on' : ''} onClick={() => setTool('a')}>Epoch A</button>
                  <button className={mode === 'b' ? 'on' : ''} onClick={() => setTool('b')}>Epoch B</button>
                </div>
                <button className={`tool ${mode === 'blink' ? 'on' : ''}`} onClick={() => setTool(mode === 'blink' ? 'a' : 'blink')} data-tut="tool-blink">
                  <svg viewBox="0 0 20 20" width="16" height="16"><rect x="2" y="4" width="9" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.8" /><rect x="9" y="4" width="9" height="12" rx="1" fill="currentColor" opacity=".45" /></svg>
                  Blink Comparator
                </button>
                <button className={`tool ${mode === 'diff' ? 'on' : ''} ${tools.diff ? '' : 'locked'}`} onClick={() => tools.diff ? setTool('diff') : sfx.reject()} title={tools.diff ? 'Subtract epoch A from epoch B' : 'Unlocks in Chapter 2 at Rank 2'}>
                  <svg viewBox="0 0 20 20" width="16" height="16"><circle cx="7.5" cy="10" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="12.5" cy="10" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                  Difference{!tools.diff && <small>CH 2</small>}
                </button>
                <button className="tool locked" onClick={() => sfx.reject()} title="Unlocks in Chapter 3"><svg viewBox="0 0 20 20" width="16" height="16"><path d="M2 14 L6 8 L10 12 L14 5 L18 9" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>Bands<small>CH 3</small></button>
                <button className="tool locked" onClick={() => sfx.reject()} title="Unlocks in Chapter 4"><svg viewBox="0 0 20 20" width="16" height="16"><path d="M2 10 H5 L7 5 L10 15 L13 8 L15 10 H18" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>Light Curve<small>CH 4</small></button>
                {mode === 'blink' && (
                  <label className="speed mono">RATE<input type="range" min={250} max={1400} step={50} value={1650 - speed} onChange={(e) => setSpeed(1650 - +e.target.value)} /></label>
                )}
              </div>

              <TileViewer
                key={tile.id}
                tile={tile}
                mode={mode}
                speed={speed}
                marker={marker}
                onMark={locked || running ? undefined : setMarker}
                reveal={!!cur && (cur.verdict === 'known' || cur.verdict === 'missed')}
                hint={tutorial === 4 && tile.id === level.target}
                onBlinkTick={onTick}
              />

              <div className="action-bar">
                <div className="mono action-hint">
                  {locked ? 'Tile reviewed. Pick another tile from the batch.' : marker ? 'Marker placed. Flag it, or move it by clicking elsewhere.' : 'Click a source on the plate to place your marker.'}
                </div>
                <Btn variant="ghost" disabled={locked || !!running} onClick={() => submit('clear')}>No anomaly</Btn>
                <Btn variant="danger" disabled={locked || !!running || !marker} onClick={() => submit('flag')} data-tut="flag" className="flag-btn">Flag anomaly</Btn>
              </div>
            </>
          ) : (
            <div className="inspect-empty">
              <div className="scan-sweep" />
              <h3 className="display">Select a tile to inspect</h3>
              <p>Every tile is a real pair of photographic plates of the same patch of sky, exposed decades apart.</p>
            </div>
          )}
        </section>

        <aside className="side">
          {resultToShow && tile ? (
            <div className={`verify ${display ? 'running' : ''}`} data-tut="result">
              <div className="panel-title mono">VERIFICATION PIPELINE · {tile.code}</div>
              <ol className="checks">
                {resultToShow.checks.map((c, i) => {
                  const st: CheckStatus = display ? (i < display.shown ? c.status : i === display.shown ? 'run' : 'wait') : c.status
                  return (
                    <li key={c.name} className={`check ${st}`}>
                      <span className="check-dot" />
                      <div><strong>{c.name}</strong>{st !== 'wait' && st !== 'run' && <p>{c.note}</p>}{st === 'run' && <p className="mono">running…</p>}</div>
                    </li>
                  )
                })}
              </ol>
              {(!display || display.shown >= resultToShow.checks.length) && (
                <div className="verdict">
                  <Chip v={resultToShow.verdict} />
                  <span className="mono xp-col">{resultToShow.xp ? `+${resultToShow.xp} XP` : tile.id === level.target && resultToShow.verdict === 'known' ? 'CASE PROGRESS' : '+0 XP'}</span>
                  {resultToShow.verdict === 'known' && tile.catalog && (
                    <div className="catalog-card">
                      <span className="mono">CATALOG RECORD</span>
                      <strong>{tile.catalog.name}</strong>
                      <em className="mono">{tile.catalog.alias}</em>
                      <p>{tile.catalog.note}</p>
                      <div className="mono cat-row"><span>μ {tile.catalog.pm}</span><span>d {tile.catalog.distance}</span></div>
                    </div>
                  )}
                  {resultToShow.verdict.startsWith('rejected') && <p className="soft">A dismissed lead is still progress. It is one less false signal for the professionals.</p>}
                  {resultToShow.verdict === 'pending' && <p className="soft">Your call is logged. The tile resolves once enough weighted reviews agree.</p>}
                </div>
              )}
            </div>
          ) : (
            <div className="briefing-mini">
              <div className="panel-title mono">CASE NOTES</div>
              <p>{level.briefing}</p>
              <div className="guide-quote">
                <img src={cdn(GUIDE.img, 96)} alt="" />
                <span>“Trust the evidence, not the first impression.”</span>
              </div>
            </div>
          )}

          {tile && (
            <dl className="meta">
              <div className="panel-title mono">TILE METADATA</div>
              <div><dt>Tile</dt><dd className="mono">{tile.code}</dd></div>
              <div><dt>Centre RA</dt><dd className="mono">{raStr(tile.ra)}</dd></div>
              <div><dt>Centre Dec</dt><dd className="mono">{decStr(tile.dec)}</dd></div>
              <div><dt>Epoch A</dt><dd>POSS-I · DSS1 Red · plates 1949–1958</dd></div>
              <div><dt>Epoch B</dt><dd>POSS-II · DSS2 Red · plates c. 1985–2000</dd></div>
              <div><dt>Instrument</dt><dd>Palomar 48-inch Schmidt (scanned)</dd></div>
              <div><dt>Wavelength</dt><dd className="mono">~0.65 µm (red emulsion)</dd></div>
              <div><dt>PSF FWHM</dt><dd className="mono">~2–3″</dd></div>
              <div><dt>Source</dt><dd>NASA SkyView · STScI Digitized Sky Survey</dd></div>
              {cur && <div><dt>Field</dt><dd>{tile.name}</dd></div>}
            </dl>
          )}
        </aside>
      </div>

      {phase === 'briefing' && (
        <div className="briefing-overlay">
          <div className="folder" data-tut="briefing">
            <div className="folder-tab mono">CASE {String(n).padStart(3, '0')}</div>
            <div className="stamp">CLASSIFIED</div>
            <div className="mono kicker">CASE FILE · CHAPTER {chapter}: {ch.title.toUpperCase()}</div>
            <h2 className="display">{level.title}</h2>
            <p className="folder-text">{level.briefing}</p>
            {chapter >= 2 && (
              <div className="lesson">
                <span className="mono">NEW TOOL LESSON</span>
                <strong>{TOOLS[1].name}</strong>
                <p>{TOOLS[1].blurb} Stars that stayed put cancel to grey. Anything that moved leaves a bright and a dark ghost: the before and after. Press <kbd>D</kbd> to switch it on.</p>
              </div>
            )}
            <div className="folder-grid mono">
              <div><span>BATCH</span>{level.tiles.length} tiles</div>
              <div><span>TOOLS</span>{tools.diff ? 'Blink · Difference' : 'Blink Comparator'}</div>
              <div><span>SCORING</span>{chapter === 1 ? 'Known answer key' : 'Weighted consensus'}</div>
              <div><span>DATA</span>Real archival plates</div>
            </div>
            <div className="folder-foot">
              <img src={cdn(GUIDE.img, 120)} alt="" />
              <span>Assigned by <b>{GUIDE.name}</b><br /><em>{GUIDE.role}</em></span>
              <Btn onClick={() => { sfx.open(); setPhase('scan'); if (tutorial === 1) set((p) => ({ ...p, tutorial: 2 })) }}>Begin investigation</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
