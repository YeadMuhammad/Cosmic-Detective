import { useEffect, useState } from 'react'
import { getLevel, PLAYABLE, TILE_IMG, TILES, type Verdict } from '../data/fixtures'
import { useGame } from '../lib/store'
import { cdn, navigate } from '../lib/util'
import { sfx } from '../lib/sfx'
import { Btn, Chip, XPBar } from '../components/ui'
import { levelState } from './MapScreen'

export function Debrief({ n }: { n: number }) {
  const { s, set, award, badge } = useGame()
  const c = s.last && s.last.level === n ? s.last : null
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!c) return
    setShown(0)
    let v = 0
    const id = setInterval(() => {
      v = Math.min(c.xp, v + Math.max(3, Math.round(c.xp / 40)))
      setShown(v); sfx.xp()
      if (v >= c.xp) clearInterval(id)
    }, 30)
    return () => clearInterval(id)
  }, [c?.xp, c?.level])

  if (!c) return (
    <div className="screen empty-state">
      <h1 className="display">No report on file</h1>
      <p>Close a case from the investigation screen to see its debrief here.</p>
      <Btn onClick={() => navigate('/map')}>Back to the case board</Btn>
    </div>
  )

  const level = getLevel(n)!
  const accuracy = c.judged ? Math.round((c.correct / c.judged) * 1000) / 10 : 0

  const collect = () => {
    if (c.collected) return
    award({ xp: c.xp, tiles: c.tiles, correct: c.correct, judged: c.judged, known: c.known, artifacts: c.artifacts, clears: c.clears })
    set((p) => ({
      ...p,
      last: { ...c, collected: true },
      completed: p.completed.includes(n) ? p.completed : [...p.completed, n],
      history: [{ level: n, title: c.title, xp: c.xp, tiles: c.tiles, at: new Date().toISOString().slice(0, 10) }, ...p.history].slice(0, 12),
      tutorial: p.tutorial === 6 ? 7 : p.tutorial,
    }))
    badge('first-flag')
    if (level.target === 'barnard') badge('barnard')
    if (c.artifacts > 0) badge('artifact')
    if (s.clears + c.clears >= 5) badge('skeptic')
    if (c.tiles === level.tiles.length) badge('clean-case')
    if (level.chapter >= 2) badge('subtractor')
    sfx.success()
    if (s.tutorial === 6) setTimeout(() => navigate('/map'), 900)
  }

  const next = PLAYABLE.find((l) => l.n > n && levelState(l.n, [...s.completed, n], s.tiles + (c.collected ? 0 : c.tiles)) === 'open')

  return (
    <div className="screen debrief">
      <div className="debrief-head">
        <div className="closed-stamp display">CASE CLOSED</div>
        <div className="mono kicker">DEBRIEF · CASE {String(n).padStart(3, '0')}</div>
        <h1 className="display">{c.title}</h1>
        <p className="lede">Primary anomaly verified and matched against the catalogue. Your report joins {c.tiles} reviewed tiles to the survey record.</p>
      </div>

      <div className="debrief-grid">
        <section className="reward" data-tut="xp">
          <div className="reward-xp display">+{shown}<span>XP</span></div>
          <div className="reward-break mono">
            {level.tutorial && <div><span>Training reward</span><b>+50</b></div>}
            <div><span>Bonus inspection</span><b>+{c.xp - (level.tutorial ? 50 : 0) - (c.solved && c.tiles === level.tiles.length ? 40 : 0)}</b></div>
            {c.solved && c.tiles === level.tiles.length && <div><span>Clean case bonus</span><b>+40</b></div>}
            <div><span>Mandatory target</span><b>story progress</b></div>
          </div>
          <XPBar />
          <Btn variant="ok" className="collect" onClick={collect} disabled={c.collected}>{c.collected ? 'Reward collected' : 'Collect reward'}</Btn>
        </section>

        <section className="stats-cards">
          {[
            ['Tiles reviewed', c.tiles],
            ['Accuracy', `${accuracy}%`],
            ['Known objects', c.known],
            ['Artifacts explained', c.artifacts],
            ['Clean tiles cleared', c.clears],
          ].map(([k, v], i) => (
            <div key={k as string} className="stat-card" style={{ animationDelay: `${200 + i * 80}ms` }}>
              <b className="display">{v}</b><span className="mono">{k}</span>
            </div>
          ))}
        </section>

        <section className="debrief-tiles">
          <div className="panel-title mono">BATCH LEDGER</div>
          <div className="ledger">
            {c.results.map((r) => (
              <div key={r.id} className={`ledger-row ${r.verdict === 'unreviewed' ? 'dim' : ''}`}>
                <img src={cdn(TILE_IMG(r.id, 'b'), 80)} alt="" />
                <span className="mono">{TILES[r.id].code}</span>
                <span className="ledger-name">{r.verdict === 'unreviewed' ? 'Not reviewed' : TILES[r.id].name}</span>
                {r.verdict !== 'unreviewed' && <Chip v={r.verdict as Verdict} small />}
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="debrief-foot">
        <Btn variant="ghost" onClick={() => navigate('/ranks')}>View rankings</Btn>
        <Btn variant="ghost" onClick={() => navigate('/map')}>Case board</Btn>
        {next && c.collected && <Btn onClick={() => navigate(`/case/${next.n}`)}>Next case: {next.title}</Btn>}
      </div>
    </div>
  )
}
