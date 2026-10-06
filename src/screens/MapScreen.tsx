import { CHAPTERS, getLevel, LEVEL_NAMES, PLAYABLE, rankFor, RANKS, TOOLS } from '../data/fixtures'
import { useGame } from '../lib/store'
import { cdn, navigate } from '../lib/util'
import { sfx } from '../lib/sfx'

export type NodeState = 'done' | 'open' | 'locked' | 'sealed'

export function levelState(n: number, completed: number[], tiles: number): NodeState {
  if (completed.includes(n)) return 'done'
  const lvl = getLevel(n)
  const ch = Math.ceil(n / 10)
  if (rankFor(tiles).n < ch) return 'locked'
  if (!lvl) return 'sealed'
  const prev = PLAYABLE.filter((l) => l.chapter === ch && l.n < n)
  return prev.every((l) => completed.includes(l.n)) ? 'open' : 'locked'
}

// zig-zag constellation path for 10 nodes
const NODE_POS = Array.from({ length: 10 }, (_, i) => [6 + i * 9.8, i % 2 ? 68 : 30 + (i % 4 === 0 ? 0 : 6)])

export function MapScreen() {
  const { s, set } = useGame()
  const rank = rankFor(s.tiles)
  const nextOpen = PLAYABLE.find((l) => levelState(l.n, s.completed, s.tiles) === 'open')

  const go = (n: number) => {
    const st = levelState(n, s.completed, s.tiles)
    if (st === 'open' || st === 'done') {
      sfx.open()
      if (s.tutorial === 7) { set((p) => ({ ...p, tutorial: null, tutorialDone: true })); return }
      navigate(`/case/${n}`)
    } else sfx.reject()
  }

  return (
    <div className="screen map-screen">
      <section className="map-head">
        <div>
          <div className="mono kicker">CAMPAIGN · 5 CHAPTERS · 50 CASES</div>
          <h1 className="display">The Case Board</h1>
          <p className="lede">Each case is one batch of 10 to 15 real sky tiles. Solve the mandatory target to advance the story; inspect the rest for experience and rank.</p>
        </div>
        {nextOpen && (
          <button className="next-case" onClick={() => go(nextOpen.n)} onMouseEnter={() => sfx.hover()}>
            <span className="mono">NEXT CASE · {String(nextOpen.n).padStart(3, '0')}</span>
            <strong>{nextOpen.title}</strong>
            <span className="arrow">Open file →</span>
          </button>
        )}
      </section>

      <div className="chapters">
        {CHAPTERS.map((ch) => {
          const lockedCh = rank.n < ch.n
          const tool = TOOLS.find((t) => t.id === ch.tool)!
          const done = s.completed.filter((n) => Math.ceil(n / 10) === ch.n).length
          return (
            <section key={ch.n} className={`chapter ${lockedCh ? 'locked' : ''}`} style={{ ['--accent' as any]: ch.accent }}>
              <div className="chapter-art" style={{ backgroundImage: `url(${cdn(ch.art, 1400)})` }} />
              <div className="chapter-shade" />
              <header className="chapter-info">
                <div className="chapter-num display">{String(ch.n).padStart(2, '0')}</div>
                <div>
                  <div className="mono kicker">CHAPTER {ch.n} · {done}/10 SOLVED</div>
                  <h2 className="display">{ch.title}</h2>
                  <p>{ch.arc}</p>
                  <div className="tool-pill mono"><svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 8h12M8 2v12" stroke="currentColor" strokeWidth="2" /></svg>{tool.name}</div>
                </div>
              </header>

              <div className="nodes">
                <svg className="node-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polyline points={NODE_POS.map(([x, y]) => `${x + 3},${y}`).join(' ')} fill="none" stroke="var(--accent)" strokeOpacity=".45" strokeWidth=".35" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
                </svg>
                {NODE_POS.map(([x, y], i) => {
                  const n = (ch.n - 1) * 10 + i + 1
                  const st = levelState(n, s.completed, s.tiles)
                  const lvl = getLevel(n)
                  const title = lvl?.title ?? LEVEL_NAMES[n]
                  return (
                    <button
                      key={n}
                      className={`node ${st}`}
                      style={{ left: `${x}%`, top: `${y}%` }}
                      onClick={() => go(n)}
                      onMouseEnter={() => sfx.hover()}
                      data-tut={n === 2 ? 'next-level' : undefined}
                      aria-label={`Case ${n}: ${title} (${st})`}
                    >
                      <span className="node-core">
                        {st === 'done' ? <svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
                          : st === 'locked' || st === 'sealed' ? <svg viewBox="0 0 16 16" width="13" height="13"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" /><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                          : <b>{n}</b>}
                      </span>
                      <span className="node-label">
                        <span className="mono">CASE {String(n).padStart(3, '0')}</span>
                        {title}
                        {st === 'sealed' && <em>Tile pair in registration</em>}
                      </span>
                    </button>
                  )
                })}
              </div>

              {lockedCh && (
                <div className="chapter-lock">
                  <svg viewBox="0 0 16 16" width="26" height="26"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" /><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                  <div>
                    <strong>Requires Rank {ch.n} · {RANKS[ch.n - 1].title}</strong>
                    <span className="mono">{RANKS[ch.n - 1].tiles} cumulative tiles reviewed</span>
                  </div>
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
