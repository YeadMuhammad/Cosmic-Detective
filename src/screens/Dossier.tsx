import { useState } from 'react'
import { BADGES, BARNARD_BANDS, CHAPTERS, nextRank, rankFor, TOOLS } from '../data/fixtures'
import { useGame } from '../lib/store'
import { cdn, fmt, navigate } from '../lib/util'
import { sfx } from '../lib/sfx'
import { Btn, RankEmblem, XPBar } from '../components/ui'

export function Dossier() {
  const { s } = useGame()
  const [band, setBand] = useState(0)
  const r = rankFor(s.tiles)
  const nx = nextRank(s.tiles)
  const accuracy = s.judged ? ((s.correct / s.judged) * 100).toFixed(1) : '—'

  return (
    <div className="screen dossier">
      <section className="id-card">
        <div className="id-left">
          <RankEmblem n={r.n} size={140} glow />
          <div className="mono id-rank">RANK {r.n}</div>
        </div>
        <div className="id-main">
          <div className="mono kicker">DETECTIVE DOSSIER · TEAM PLEIADES</div>
          <h1 className="display">{s.callsign || 'Unnamed detective'}</h1>
          <p className="lede">{r.title}. {nx ? `${nx.tiles - s.tiles} more tiles to ${nx.title}.` : 'The highest rank in the programme.'} Consensus weight ×{r.weight.toFixed(1)}.</p>
          <XPBar />
        </div>
        <div className="id-stats">
          {[
            ['Tiles reviewed', fmt(s.tiles)],
            ['Accuracy', `${accuracy}${s.judged ? '%' : ''}`],
            ['Known objects', s.known],
            ['Artifacts explained', s.artifacts],
            ['Cases closed', s.completed.length],
            ['Badges', `${s.badges.length}/${BADGES.length}`],
          ].map(([k, v]) => <div key={k as string}><b className="display">{v}</b><span className="mono">{k}</span></div>)}
        </div>
      </section>

      <div className="dossier-grid">
        <section className="panel">
          <div className="panel-title mono">COMMENDATIONS</div>
          <div className="badges">
            {BADGES.map((b, i) => {
              const got = s.badges.includes(b.id)
              return (
                <div key={b.id} className={`badge ${got ? 'got' : ''}`} title={b.desc}>
                  <svg viewBox="0 0 60 60" width="56" height="56">
                    <circle cx="30" cy="30" r="25" fill="var(--panel-2)" stroke={got ? 'var(--rank)' : 'var(--line)'} strokeWidth="3" />
                    <circle cx="30" cy="30" r="19" fill="none" stroke={got ? 'var(--rank)' : 'var(--line)'} strokeOpacity=".4" strokeDasharray="2 3" />
                    <path transform="translate(30 30)" d={['M0 -10 L3 -3 L10 -3 L4 2 L6 10 L0 5 L-6 10 L-4 2 L-10 -3 L-3 -3 Z', 'M-9 0 A9 9 0 1 0 9 0 A9 9 0 1 0 -9 0 M-3 0 H3', 'M-8 -8 L8 8 M8 -8 L-8 8', 'M0 -11 L10 0 L0 11 L-10 0 Z'][i % 4]} fill={got ? 'var(--rank)' : 'none'} stroke={got ? 'none' : 'var(--muted)'} strokeWidth="1.5" />
                  </svg>
                  <strong>{b.name}</strong>
                  <span>{b.desc}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title mono">DETECTIVE TOOLKIT</div>
          <div className="toolkit">
            {TOOLS.map((t) => {
              const has = r.n >= t.chapter
              return (
                <div key={t.id} className={`tool-card ${has ? 'has' : ''}`} style={{ ['--accent' as any]: CHAPTERS[t.chapter - 1].accent }}>
                  <span className="mono">CH {t.chapter}</span>
                  <strong>{t.name}</strong>
                  <p>{t.blurb}</p>
                  <small className="mono">{has ? 'UNLOCKED' : `UNLOCKS AT RANK ${t.chapter}`} · {t.real}</small>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel bands-panel">
          <div className="panel-title mono">PREVIEW · MULTI-BAND COMPOSITOR (CHAPTER 3)</div>
          <p className="soft">The same field around Barnard's Star across six real survey bands, from blue light to the mid-infrared. Because each survey was taken in a different decade, the star also creeps north from frame to frame.</p>
          <div className="bands-stage">
            <img src={cdn(BARNARD_BANDS[band].file, 640)} alt={`${BARNARD_BANDS[band].label} view of Barnard's Star field`} style={{ ['--tint' as any]: BARNARD_BANDS[band].tint }} />
            <div className="mono bands-tag">{BARNARD_BANDS[band].label} · {BARNARD_BANDS[band].wl} · {BARNARD_BANDS[band].era}</div>
          </div>
          <div className="bands-strip">
            {BARNARD_BANDS.map((b, i) => (
              <button key={b.key} className={i === band ? 'on' : ''} onClick={() => { sfx.blink(); setBand(i) }} style={{ ['--tint' as any]: b.tint }}>
                <img src={cdn(b.file, 120)} alt="" />
                <span className="mono">{b.wl}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title mono">CASE HISTORY</div>
          {s.history.length ? (
            <ul className="history">
              {s.history.map((h, i) => (
                <li key={i}><span className="mono">{h.at}</span><strong>Case {String(h.level).padStart(3, '0')} · {h.title}</strong><span className="mono">{h.tiles} tiles</span><b className="mono xp-col">+{h.xp}</b></li>
              ))}
            </ul>
          ) : (
            <div className="empty">
              <p>No closed cases yet. Your first report lands here.</p>
              <Btn onClick={() => navigate('/map')}>Open the case board</Btn>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
