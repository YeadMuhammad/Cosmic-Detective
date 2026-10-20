import { useMemo, useState } from 'react'
import { PLAYERS, rankFor, RANKS, type Player } from '../data/fixtures'
import { useGame } from '../lib/store'
import { fmt } from '../lib/util'
import { sfx } from '../lib/sfx'
import { RankEmblem } from '../components/ui'

const TABS = [
  ['global', 'Global'],
  ['team', 'Team Pleiades'],
  ['accuracy', 'Accuracy'],
  ['weight', 'Consensus weight'],
] as const
type Tab = (typeof TABS)[number][0]

const SCORING = [
  ['1', 'Compared only against a known answer. Never affects another player.'],
  ['2', 'Compared against the combined answers of many previous players, with heavy redundancy.'],
  ['3–4', 'High-ranking players count for more, so fewer reviews resolve a tile.'],
  ['5', 'Marked for professional follow-up only after expert consensus and the full pipeline agree.'],
]

export function Rankings() {
  const { s } = useGame()
  const [tab, setTab] = useState<Tab>('global')
  const me: Player & { me: true } = {
    me: true, callsign: s.callsign || 'You', country: '··', tiles: s.tiles, xp: s.xp, streak: s.history.length,
    accuracy: s.judged ? Math.round((s.correct / s.judged) * 1000) / 10 : 0, team: 'Pleiades',
  }
  const rows = useMemo(() => {
    let list: (Player & { me?: boolean })[] = [...PLAYERS, me]
    if (tab === 'team') list = list.filter((p) => p.team === 'Pleiades')
    const key = (p: Player) => (tab === 'accuracy' ? p.accuracy * 1e6 + p.tiles : tab === 'weight' ? rankFor(p.tiles).weight * 1e6 + p.accuracy * 1e3 : p.xp)
    return list.sort((a, b) => key(b) - key(a))
  }, [tab, s.tiles, s.xp, s.correct, s.judged, s.callsign])
  const myPos = rows.findIndex((r) => r.me) + 1
  const top = rows.slice(0, 3)
  const r = rankFor(s.tiles)

  return (
    <div className="screen ranks">
      <section className="ranks-head">
        <div>
          <div className="mono kicker">SEASON 01 · SPACE APPS SPRINT · ENDS IN 12D 04H</div>
          <h1 className="display">Rankings</h1>
          <p className="lede">Rank is earned by careful review, not speed. Accuracy decides how much your vote counts when the community settles a tile.</p>
        </div>
        <div className="my-standing">
          <RankEmblem n={r.n} size={74} glow />
          <div>
            <span className="mono">YOUR STANDING</span>
            <b className="display">#{myPos}</b>
            <small>{r.title} · weight ×{r.weight.toFixed(1)}</small>
          </div>
        </div>
      </section>

      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { sfx.click(); setTab(k) }}>{label}</button>
        ))}
      </div>

      <div className="ranks-body">
        <div>
          <div className="podium">
            {[1, 0, 2].map((i) => top[i] && (
              <div key={top[i].callsign} className={`podium-step p${i + 1} ${(top[i] as any).me ? 'me' : ''}`}>
                <RankEmblem n={rankFor(top[i].tiles).n} size={i === 0 ? 70 : 54} glow={i === 0} />
                <strong>{top[i].callsign}</strong>
                <span className="mono">{tab === 'accuracy' ? `${top[i].accuracy}%` : tab === 'weight' ? `×${rankFor(top[i].tiles).weight.toFixed(1)}` : `${fmt(top[i].xp)} XP`}</span>
                <div className="step display">{i + 1}</div>
              </div>
            ))}
          </div>

          <table className="board">
            <thead className="mono">
              <tr><th>#</th><th>Detective</th><th>Rank</th><th className="num">Tiles</th><th className="num">Accuracy</th><th className="num">Weight</th><th className="num">XP</th></tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const pr = rankFor(p.tiles)
                return (
                  <tr key={p.callsign + i} className={p.me ? 'me' : ''} style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}>
                    <td className="mono pos">{i + 1}</td>
                    <td><span className="who"><span className="cc mono">{p.country}</span>{p.callsign}{p.team && <span className="team mono">PLE</span>}{p.me && <span className="you mono">YOU</span>}</span></td>
                    <td><span className="rank-cell"><RankEmblem n={pr.n} size={22} />{pr.title}</span></td>
                    <td className="num mono">{fmt(p.tiles)}</td>
                    <td className="num mono">{p.accuracy.toFixed(1)}%</td>
                    <td className="num mono">×{pr.weight.toFixed(1)}</td>
                    <td className="num mono xp-col">{fmt(p.xp)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="footnote mono">Other detectives shown are demo fixtures for this presentation build.</p>
        </div>

        <aside className="ladder-col">
          <div className="ladder">
            <div className="panel-title mono">RANK LADDER</div>
            {[...RANKS].reverse().map((rk) => {
              const reached = s.tiles >= rk.tiles
              return (
                <div key={rk.n} className={`rung ${reached ? 'reached' : ''} ${rk.n === r.n ? 'current' : ''}`}>
                  <RankEmblem n={rk.n} size={40} />
                  <div>
                    <strong>{rk.title}</strong>
                    <span className="mono">{rk.tiles}+ tiles · from case {String(rk.level).padStart(3, '0')}</span>
                  </div>
                  <span className="mono w">×{rk.weight.toFixed(1)}</span>
                </div>
              )
            })}
          </div>
          <div className="scoring">
            <div className="panel-title mono">HOW A FLAG IS SCORED</div>
            {SCORING.map(([ch, txt]) => (
              <div key={ch} className="score-row"><span className="mono">CH {ch}</span><p>{txt}</p></div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}
