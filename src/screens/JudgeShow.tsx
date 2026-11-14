import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BARNARD_BANDS, CHAPTERS, getLevel, GUIDE, RANKS, TILES, TOOLS } from '../data/fixtures'
import { fold, makeSeries } from '../data/lightcurves'
import { TileViewer } from '../components/TileViewer'
import { Pipeline, type Result } from '../components/Pipeline'
import { Logo } from '../components/Chrome'
import { RankEmblem } from '../components/ui'
import { Art } from '../components/StoryScenes'
import { cdn, navigate } from '../lib/util'
import { sfx } from '../lib/sfx'
import '../squad.css'
import '../story.css'
import '../judgeshow.css'

/* Everything here is a self-contained demo: no game state, no server, no saving. */

function useTick(max: number, ms: number) {
  const [t, setT] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setT((x) => (x >= max ? x : x + 1)), ms)
    return () => window.clearInterval(id)
  }, [max, ms])
  return t
}

/* ------------------------------------------------------------ dummy data */
const OBS = [
  ['D1', '2025-09-14 03:12 UTC', '2025W37_1A_0211_1', 'QR3'],
  ['D2', '2025-09-14 03:12 UTC', '2025W37_1A_0211_1', 'QR3'],
  ['D3', '2025-09-14 03:13 UTC', '2025W37_1A_0211_2', 'QR3'],
  ['D4', '2025-11-02 18:40 UTC', '2025W44_2B_0098_1', 'QR3'],
  ['D5', '2025-11-02 18:41 UTC', '2025W44_2B_0098_2', 'QR3'],
  ['D6', '2026-01-21 07:05 UTC', '2026W03_1A_0305_1', 'QR3'],
  ['D1', '2026-01-21 07:05 UTC', '2026W03_1A_0305_1', 'QR3'],
  ['D3', '2026-03-09 22:18 UTC', '2026W10_2B_0142_2', 'QR3'],
]
const SQUAD = { name: 'Orion Watch', code: 'K7Q2ZP', lead: 'Det. Ivan', analysts: [['Det. Farhana', 'Field Analyst'], ['Det. Redwan', 'Field Analyst'], ['Det. Purnota', 'Learner']] }

const T = TILES.barnard
const ARC = Math.hypot(T.a![0] - T.b![0], T.a![1] - T.b![1]) * T.size * 3600
const RESULT: Result = {
  verdict: 'known', xp: 0, correct: true,
  checks: [
    { name: 'Stationary source check', status: 'pass', note: `Source displaced ${ARC.toFixed(0)}″ between epochs. Real motion.` },
    { name: 'Blend and halo check', status: 'pass', note: 'Point-like profile at both positions. No bright neighbour inside the halo radius.' },
    { name: 'Catalog cross-match', status: 'info', note: `Matches ${T.catalog!.name} (${T.catalog!.alias}). Proper motion ${T.catalog!.pm}.` },
  ],
}

/* ------------------------------------------------------------ slide frame */
function Slide({ art, kicker, title, copy, children }: { art?: number; kicker: string; title: string; copy?: ReactNode; children?: ReactNode }) {
  const ch = art ? CHAPTERS[art - 1] : null
  return (
    <div className="js-slide" style={ch ? ({ ['--accent' as any]: ch.accent } as any) : undefined}>
      {ch && <div className="js-art" style={{ backgroundImage: `url(${cdn(ch.art, 1600)})` }} />}
      <div className="js-copy">
        <div className="mono kicker">{kicker}</div>
        <h1 className="display js-title">{title}</h1>
        {copy}
      </div>
      <div className="js-visual">{children}</div>
    </div>
  )
}
const P = ({ children }: { children: ReactNode }) => <p className="js-p">{children}</p>
const toolOf = (n: number) => TOOLS[n - 1]

/* ------------------------------------------------------------------ slides */
function Intro() {
  return (
    <div className="js-slide js-center">
      <Logo big />
      <p className="js-tag">A story-driven citizen science game on real NASA survey data.</p>
      <div className="mono js-sub">TEAM PLEIADES · NASA SPACE APPS 2026 · PLANET X AND SPHEREX</div>
    </div>
  )
}

function Loop() {
  const t = useTick(5, 700)
  const steps = [['Briefing', 'Read the case file'], ['Scan', 'Inspect real sky tiles'], ['Flag', 'Mark the moving source'], ['Verify', 'Every flag stands trial'], ['Reward', 'XP, rank and new tools']]
  return (
    <Slide kicker="THE IDEA" title="A billion objects. Not enough eyes."
      copy={<P>SPHEREx maps the whole sky and no science team can inspect all of it. We turn the checking into an investigation anyone can play, using the same steps professionals use.</P>}>
      <ol className="js-loop">
        {steps.map(([a, b], i) => <li key={a} className={t > i ? 'on' : ''}><span className="mono">{i + 1}</span><div><strong>{a}</strong><small>{b}</small></div></li>)}
      </ol>
    </Slide>
  )
}

function StoryTeaser() {
  const t = useTick(5, 800)
  return (
    <div className="js-slide js-story-teaser-slide">
      {/* Full-bleed roof scene as the slide background */}
      <div className="js-roof-bg" aria-hidden>
        <Art art="roof" name="detective" />
      </div>
      <div className="js-copy" style={{ position: 'relative', zIndex: 2 }}>
        <div className="mono kicker" style={{ color: 'var(--rank)' }}>NARRATIVE</div>
        <h1 className="display js-title">Every chapter has a story to tell.</h1>
        <P>Before you open a single case file, the game sets the scene. Each chapter opens with its own cinematic story — written scenes, typewriter dialogue, and a guide who hands you the evidence.</P>
        <p className="js-p soft">The first story begins with a little boy on a rooftop, on a night with no power, and a question he never forgot.</p>
      </div>
      <div className="js-visual" style={{ position: 'relative', zIndex: 2 }}>
        <div className="js-story-cards">
          {CHAPTERS.map((ch, i) => (
            <div key={ch.n} className={`js-story-card ${t > i ? 'on' : ''}`} style={{ '--accent': ch.accent } as any}>
              <div className="js-story-card-art" style={{ backgroundImage: `url(${cdn(ch.art, 640)})` }} />
              <div className="js-story-card-body">
                <span className="mono">CH {ch.n}</span>
                <strong>{ch.title}</strong>
              </div>
            </div>
          ))}
          <div className={`js-story-screen-mock ${t >= 3 ? 'on' : ''}`}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--muted)', marginBottom: 6 }}>CHAPTER 1 · THE SEVEN LIGHTS</div>
            <div style={{ fontSize: 15, fontStyle: 'italic', maxWidth: '32ch', lineHeight: 1.5, opacity: 0.9 }}>
              "Welcome, Detective.<br />I read your application three times…<br /><br />It begins with a little boy,<br />a rooftop, and a night with no power."
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', marginTop: 10 }}>Bibha Chowdhuri · Senior Archivist</div>
            <div className="js-story-caret" />
          </div>
        </div>
      </div>
    </div>
  )
}

function Story() {
  const lvl = getLevel(1)!
  return (
    <Slide art={1} kicker="CHAPTER 1 · THE TRAINING GROUNDS" title={CHAPTERS[0].title}
      copy={<><P>{CHAPTERS[0].arc}</P><div className="js-file"><span className="mono">CASE 001 · CLASSIFIED</span><strong>{lvl.title}</strong><p>{lvl.briefing}</p></div></>}>
      <div className="js-guide"><img src={cdn(GUIDE.img, 400)} alt={GUIDE.name} /><div><strong>{GUIDE.name}</strong><span className="mono">{GUIDE.role}</span><q>Trust the evidence, not the first impression.</q></div></div>
    </Slide>
  )
}

function Blink() {
  const t = useTick(6, 1000)
  return (
    <Slide art={1} kicker="CHAPTER 1 · FIRST TOOL" title={toolOf(1).name}
      copy={<><P>{toolOf(1).blurb} Stars hold still. Something here does not.</P><P>Real photographic plates of Barnard’s Star, about forty years apart.</P></>}>
      <div className="js-viewer"><TileViewer tile={T} mode="blink" speed={650} marker={t >= 3 ? T.b! : null} hint={t < 3} /></div>
    </Slide>
  )
}

function Verify() {
  const t = useTick(4, 1100)
  return (
    <Slide art={1} kicker="EVIDENCE BEFORE REWARD" title="Every flag stands trial"
      copy={<><P>A flag is never taken at face value. Each check runs in the open, including rejections.</P><P>A survivor is a known object or a candidate for follow-up. Never a confirmed discovery.</P></>}>
      <div className="js-pipe"><Pipeline code={T.code} res={RESULT} running={{ shown: t }} target
        catalog={{ name: T.catalog!.name, alias: T.catalog!.alias, note: T.catalog!.note, rows: [`μ ${T.catalog!.pm}`, `d ${T.catalog!.distance}`] }} /></div>
    </Slide>
  )
}

function Progress() {
  const t = useTick(100, 35)
  const done = t >= 100
  return (
    <Slide kicker="PROGRESSION" title="Rank is earned by careful review"
      copy={<><P>Every reviewed tile counts. Ranks unlock the next chapter and its tool, and raise how much your vote weighs when the community settles a tile.</P>
        {done && <div className="js-promo"><span className="mono">PROMOTION · RANK 2</span><strong>Field Analyst</strong><small>Difference Imaging unlocked</small></div>}</>}>
      <div className="js-rank">
        <RankEmblem n={done ? 2 : 1} size={150} glow />
        <div className="js-xp"><div className="xp-track"><div className="xp-fill" style={{ transform: `scaleX(${Math.max(0.02, t / 100)})`, transition: 'none' }} /></div>
          <span className="mono">{t} / 100 tiles to Field Analyst</span></div>
        <ol className="js-ladder">{RANKS.map((r) => <li key={r.n} className={(done ? 2 : 1) >= r.n ? 'on' : ''}><RankEmblem n={r.n} size={26} /><strong>{r.title}</strong><span className="mono">{r.tiles}+ tiles · ×{r.weight.toFixed(1)}</span></li>)}</ol>
      </div>
    </Slide>
  )
}

function Diff() {
  return (
    <Slide art={2} kicker="CHAPTER 2 · THE PHANTOM ORBIT" title={toolOf(2).name}
      copy={<><P>{CHAPTERS[1].arc}</P><P>Subtract one exposure from the other. Static stars cancel to grey; the mover leaves a bright and a dark ghost.</P></>}>
      <div className="js-viewer"><TileViewer tile={T} mode="diff" speed={650} marker={null} /></div>
    </Slide>
  )
}

function Bands() {
  const t = useTick(999, 1300)
  const i = t % 6
  const b = BARNARD_BANDS[i]
  return (
    <Slide art={3} kicker="CHAPTER 3 · THE COLD COMPANION" title={toolOf(3).name}
      copy={<><P>{CHAPTERS[2].arc}</P><P>The same field in six real surveys, from blue light to the mid-infrared. Colour is wavelength: a cold source vanishes in blue and blazes in the infrared.</P></>}>
      <div className="js-bands">
        <div className="bands-stage" style={{ ['--tint' as any]: b.tint }}><img key={b.key} src={cdn(b.file, 640)} alt={b.label} /><div className="mono bands-tag">{b.label} · {b.wl} · {b.era}</div></div>
        <div className="bands-strip">{BARNARD_BANDS.map((x, k) => <button key={x.key} tabIndex={-1} className={k === i ? 'on' : ''} style={{ ['--tint' as any]: x.tint }}><img src={cdn(x.file, 120)} alt="" /><span className="mono">{x.wl}</span></button>)}</div>
      </div>
    </Slide>
  )
}

function Curve() {
  const series = useMemo(() => makeSeries('hd209458'), [])
  const t = useTick(60, 80)
  const raw = t < 12
  const k = Math.min(1, Math.max(0, (t - 12) / 40))
  const Pd = 2.2 + (3.5247 - 2.2) * (1 - (1 - k) ** 2)
  const f = useMemo(() => fold(series, Pd), [series, Pd])
  const range = useMemo(() => { const s = [...series.f].sort((a, b) => a - b); const lo = s[Math.floor(s.length * 0.003)], hi = s[Math.floor(s.length * 0.997)], p = (hi - lo) * 0.08; return { lo: lo - p, hi: hi + p } }, [series])
  const W = 560, H = 260, L = 48, R = 12, Tp = 12, B = 36, t1 = series.t[series.t.length - 1]
  const X = (v: number) => L + (v / (raw ? t1 : 1)) * (W - L - R)
  const Y = (v: number) => Tp + (1 - (v - range.lo) / (range.hi - range.lo)) * (H - Tp - B)
  const xs = raw ? series.t : f.phase
  const line = raw ? [] : f.bins.map((v, b) => (v == null ? null : `${X((b + 0.5) / f.bins.length)},${Y(v)}`)).filter(Boolean)
  const tag = f.z >= 8 ? 'SIGNAL' : f.z >= 3 ? 'HINT' : 'NOISE'
  return (
    <Slide art={4} kicker="CHAPTER 4 · THE SHATTERED RECORD" title={toolOf(4).name}
      copy={<><P>{CHAPTERS[3].arc}</P><P>Fold the record at a trial period. At the right one the scatter collapses into a single dip: a planet crossing its star.</P><P className="soft">Modelled from the published period of HD 209458.</P></>}>
      <div className="js-curve">
        <svg className="lc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Light curve">
          {Array.from({ length: 5 }, (_, i) => range.lo + ((range.hi - range.lo) * i) / 4).map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="grid" /><text x={L - 6} y={Y(v) + 3} textAnchor="end">{v.toFixed(3)}</text></g>)}
          {xs.map((x, i) => { const y = series.f[i]; return y < range.lo || y > range.hi ? null : <circle key={i} cx={X(x)} cy={Y(y)} r={1.8} className="pt" /> })}
          {line.length > 1 && <polyline points={line.join(' ')} className="bin-line" />}
          <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="axl">{raw ? 'time (days)' : `phase  (P = ${Pd.toFixed(3)} d)`}</text>
        </svg>
        <div className="coh"><span className="mono">TRIAL PERIOD {raw ? '—' : `${Pd.toFixed(3)} d`}</span>
          <div className="coh-bar"><i style={{ width: `${raw ? 0 : Math.min(1, f.z / 20) * 100}%` }} className={f.z >= 8 && !raw ? 'hit' : ''} /><u style={{ left: '40%' }} /></div>
          <b className="mono">{raw ? 'RAW' : `${tag} · ${f.z.toFixed(1)}σ`}</b></div>
      </div>
    </Slide>
  )
}

function Portal() {
  const t = useTick(4, 700)
  const items = ['Search the live IRSA archive by sky position', 'Six SPHEREx detector bands, QR2 and QR3 releases', 'Registered blink comparator and false-colour channel mixer', 'Research squads with leaders, analysts and review']
  return (
    <Slide art={5} kicker="CHAPTER 5 · OPEN SKY RESEARCH PORTAL" title={CHAPTERS[4].title}
      copy={<P>{CHAPTERS[4].arc} Training ends here. From now on the data is real, live and unreviewed.</P>}>
      <ul className="js-list">{items.map((x, i) => <li key={x} className={t > i ? 'on' : ''}>{x}</li>)}</ul>
    </Slide>
  )
}

function Fetch() {
  const t = useTick(15, 700)
  const rows = Math.max(0, Math.min(OBS.length, t - 5))
  return (
    <Slide art={5} kicker="RESEARCH PORTAL · FETCH LIVE DATA" title="Search the sky by position"
      copy={<><P>Enter a position, pick detector bands, and the portal asks IRSA which SPHEREx observations cover it.</P><P className="soft">Demo data shown for this presentation.</P></>}>
      <div className="js-portal">
        <div className="research-form">
          <label>RA (deg, ICRS)<input readOnly value={t >= 1 ? '156.09328' : ''} /></label>
          <label>Dec (deg, ICRS)<input readOnly value={t >= 2 ? '-41.64466' : ''} /></label>
          <label>Field size (arcmin)<input readOnly value={t >= 3 ? '6' : ''} /></label>
          <label>Data source<input readOnly value="Live IRSA archive" /></label>
          <button type="button" tabIndex={-1} className="js-fake-btn">{t >= 4 && t < 6 ? 'Searching IRSA…' : 'Fetch live SPHEREx data'}</button>
        </div>
        <div className="research-status">{t < 4 ? 'Search the live IRSA SPHEREx archive for coverage at a sky position.' : t < 6 ? 'Querying IRSA for live SPHEREx QR3 and QR2 observations…' : `${OBS.length} live spectral images found across SPHEREx QR3.`}</div>
        <div className="research-table-wrap"><table className="research-table"><thead><tr><th>Band</th><th>Observed</th><th>Observation</th><th>Release</th></tr></thead>
          <tbody>{OBS.slice(0, rows).map((o, i) => <tr key={i} className="js-row">{o.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody></table></div>
      </div>
    </Slide>
  )
}

function Create() {
  const t = useTick(20, 130)
  const name = SQUAD.name.slice(0, t)
  const made = t >= 15
  return (
    <Slide art={5} kicker="SQUADS · CREATE A GROUP" title="Leaders start squads"
      copy={<><P>At Rank 6, an approved Principal Investigator creates a squad and gets a join code to share with lower-ranked players.</P></>}>
      <section className="sq-panel js-squad">
        <div className="sq-block"><h3>Start your own squad</h3>
          <div className="sq-form"><label>Squad name<input type="text" readOnly value={name} /></label><div><span className={`js-fake-btn ${t >= 12 && !made ? 'press' : ''}`}>Create squad</span></div></div></div>
        {made && <div className="sq-head js-pop"><div><div className="mono kicker">YOU LEAD THIS SQUAD</div><h2 className="display">{SQUAD.name}</h2></div>
          <div><div className="soft">Share this join code with lower-ranked players</div><div className="sq-code mono">{SQUAD.code}</div></div></div>}
      </section>
    </Slide>
  )
}

function Join() {
  const t = useTick(8, 900)
  return (
    <Slide art={5} kicker="SQUADS · JOIN A GROUP" title="Analysts join with a code"
      copy={<><P>Players ranked below the leader enter the code and become analysts. One squad per player, up to eight players.</P></>}>
      <section className="sq-panel js-squad">
        <div className="sq-block"><h3>Join a squad</h3><div className="sq-form"><label>Join code<input type="text" readOnly value={t >= 1 ? SQUAD.code : ''} /></label></div></div>
        <div className="sq-block"><h3>Roster · {SQUAD.name}</h3>
          <table className="sq-table"><thead><tr><th>Player</th><th>Rank</th></tr></thead><tbody>
            <tr><td>{SQUAD.lead} ★</td><td>Principal Investigator</td></tr>
            {SQUAD.analysts.map(([n, r], i) => t >= i * 2 + 2 && <tr key={n} className="js-row"><td>{n}</td><td>{r}</td></tr>)}
          </tbody></table></div>
      </section>
    </Slide>
  )
}

function Assign() {
  const t = useTick(12, 800)
  return (
    <Slide art={5} kicker="SQUADS · ASSIGN THE DATA" title="Leaders hand out the data"
      copy={<><P>The leader sends the fetched observations to analysts, either all of it or split between them, with instructions.</P></>}>
      <section className="sq-panel js-squad">
        <div className="sq-block"><h3>Assign the data on screen</h3>
          <p className="soft">{OBS.length} observations at RA 156.09328, Dec -41.64466 are ready to assign.</p>
          {SQUAD.analysts.map(([n, r], i) => <label key={n} className="sq-check"><input type="checkbox" readOnly checked={t > i} tabIndex={-1} />{n} <small className="soft">{r}</small></label>)}
          <label className="sq-check"><input type="checkbox" readOnly checked={t >= 4} tabIndex={-1} />Split the observations between analysts</label>
          <label>Instructions<textarea readOnly value={t >= 5 ? 'Compare D3 and D4 for any source that changes brightness.' : ''} /></label>
          <div><span className={`js-fake-btn ${t === 6 ? 'press' : ''}`}>Assign to team</span></div></div>
        {t >= 7 && <div className="sq-jobs js-pop">{SQUAD.analysts.map(([n], i) => t >= 7 + i && <article key={n} className="sq-job" data-status="assigned"><div className="sq-job-top"><strong>{n}</strong><span className="sq-chip">Waiting for the analyst</span></div></article>)}</div>}
      </section>
    </Slide>
  )
}

function Review() {
  const t = useTick(8, 1100)
  const stage = Math.min(3, Math.floor(t / 2))
  const labels = ['Assigned', 'Submitted', 'Verified by leader', 'Filed to simulated NASA intake']
  const status = ['assigned', 'submitted', 'verified', 'reported'][stage]
  return (
    <Slide art={5} kicker="SQUADS · REVIEW AND REPORT" title="Findings come back for review"
      copy={<><P>Analysts file a finding. The leader verifies it or sends it back. Verified work is filed to a simulated NASA intake.</P><P className="soft">Training sandbox: reports never leave Cosmic Detective and are candidates, not confirmed discoveries.</P></>}>
      <section className="sq-panel js-squad">
        <ol className="jt-flow js-flow">{labels.map((l, i) => <li key={l} className={i <= stage ? 'on' : ''}>{l}</li>)}</ol>
        <article className="sq-job" data-status={status}>
          <div className="sq-job-top"><strong>Det. Farhana </strong><span className="sq-chip">{labels[stage]}</span></div>
          <span className="soft mono">RA 156.0933 · Dec -41.6447</span>
          {stage >= 1 && <p className="soft js-pop"><b>Possible moving source.</b> Bright source shifts between the January and March D3 frames, away from the neighbouring star.</p>}
          {stage >= 2 && <p className="soft js-pop">Leader’s note: registration looks clean. Verified.</p>}
        </article>
        {stage >= 3 && <div className="sq-block js-pop"><h3>Simulated NASA intake</h3><table className="sq-table"><tbody><tr><td className="mono">SIM-2026-00001</td><td>1 job</td><td>Candidate observation for follow-up</td></tr></tbody></table></div>}
      </section>
    </Slide>
  )
}

function Finale({ replay }: { replay: () => void }) {
  return (
    <div className="js-slide js-center">
      <div className="mono kicker">FROM CURIOSITY TO DISCOVERY</div>
      <h1 className="display js-big">Every sky has a secret.<br />Can you find it?</h1>
      <p className="js-tag">Story, real data and a research hierarchy that turns players into contributors.</p>
      <div className="js-end"><button className="btn btn-ghost" onClick={replay}><span>Replay</span></button><button className="btn btn-primary" onClick={() => navigate('/map')}><span>Open the game</span></button></div>
    </div>
  )
}

/* ------------------------------------------------------------------- show */
export function JudgeShow() {
  const [i, setI] = useState(0)
  const slides = useMemo<ReactNode[]>(() => [
    <Intro />, <Loop />, <StoryTeaser />, <Story />, <Blink />, <Verify />, <Progress />, <Diff />, <Bands />, <Curve />,
    <Portal />, <Fetch />, <Create />, <Join />, <Assign />, <Review />, <Finale replay={() => setI(0)} />,
  ], [])
  const last = slides.length - 1
  const next = () => setI((x) => { if (x < last) sfx.click(); return Math.min(last, x + 1) })
  const back = () => setI((x) => Math.max(0, x - 1))

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ([' ', 'ArrowRight', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); next() }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); back() }
      else if (e.key === 'Escape') navigate('/')
    }
    const up = (e: KeyboardEvent) => { if (e.key === ' ') e.preventDefault() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [last]) // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="js-root" role="region" aria-label="Cosmic Detective demo">
      <div className="js-top"><span className="mono">DEMO · {i + 1} / {slides.length}</span><button className="link-btn" onClick={() => navigate('/')}>Exit</button></div>
      <div className="js-stage" key={i}>{slides[i]}</div>
      <div className="js-foot">
        <div className="js-prog"><i style={{ width: `${(i / last) * 100}%` }} /></div>
        <span className="mono js-hint">Space or → continue · ← back · Esc exit</span>
        <button className="btn btn-ghost sm" disabled={i === 0} onClick={(e) => { back(); e.currentTarget.blur() }}><span>Back</span></button>
        <button className="btn btn-primary" disabled={i === last} onClick={(e) => { next(); e.currentTarget.blur() }}><span>Continue</span></button>
      </div>
    </div>,
    document.body,
  )
}
