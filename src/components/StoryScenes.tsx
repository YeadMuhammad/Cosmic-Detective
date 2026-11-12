import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { TILE_IMG } from '../data/fixtures'
import type { StoryArt } from '../data/story'
import { cdn } from '../lib/util'
import { sfx } from '../lib/sfx'

const vars = (o: Record<string, string>) => o as CSSProperties

/* ------------------------------------------------------------------ roof */

/** Deterministic scatter of faint stars, so the sky never jumps between renders. */
function useSkyStars(count: number) {
  return useMemo(() => {
    let s = 7
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
    return Array.from({ length: count }, () => ({ x: rnd() * 160, y: rnd() * 56, r: 0.25 + rnd() * 0.55, d: rnd() * 4 }))
  }, [count])
}

function Roof({ dim = false, cluster = true }: { dim?: boolean; cluster?: boolean }) {
  const stars = useSkyStars(70)
  return (
    <svg className={`roof-svg ${dim ? 'dim' : ''}`} viewBox="0 0 160 90" role="img" aria-label="A child and a man on a rooftop at night, looking at a small cluster of stars">
      <defs>
        <linearGradient id="roofSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#120d09" />
          <stop offset="0.7" stopColor="#2c1d12" />
          <stop offset="1" stopColor="#4f3622" />
        </linearGradient>
        <radialGradient id="clusterGlow">
          <stop offset="0" stopColor="#ffe7b0" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffe7b0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="160" height="90" fill="url(#roofSky)" />
      {stars.map((st, i) => <circle key={i} className="tw" cx={st.x} cy={st.y} r={st.r} fill="#ffe9c2" style={vars({ animationDelay: `${st.d}s` })} />)}
      {cluster && (
        <g className="roof-cluster">
          <circle cx="113" cy="27" r="20" fill="url(#clusterGlow)" />
          {[[104, 15, 1.1], [94, 24, 0.9], [98, 33, 0.9], [108, 38, 0.9], [113, 26, 1.3], [124, 31, 1.1], [127, 22, 0.8]].map(([x, y, r], i) => (
            <circle key={i} className="tw" cx={x} cy={y} r={r} fill="#fff6dc" style={vars({ animationDelay: `${i * 0.35}s` })} />
          ))}
        </g>
      )}
      {/* dark city skyline: the power is out, one window flickers back */}
      <path d="M0 74 V60 H10 V52 H20 V62 H30 V56 H44 V66 H58 V58 H70 V68 H88 V60 H100 V70 H116 V62 H130 V54 H142 V64 H160 V74 Z" fill="#0b0704" />
      <rect className="win" x="22" y="56" width="2.2" height="2.6" fill="#ffd27a" />
      <rect className="win w2" x="133" y="58" width="2.2" height="2.6" fill="#ffd27a" />
      {/* roof and parapet */}
      <rect y="76" width="160" height="14" fill="#060403" />
      <rect y="74" width="160" height="2.4" fill="#0f0a06" />
      {/* Abbu, kneeling, one arm raised toward the cluster */}
      <g fill="#060403" stroke="#060403">
        <circle cx="40" cy="58" r="3.7" stroke="none" />
        <path d="M32 76 L35 63 Q40 60 45 63 L49 76 Z" stroke="none" />
        <line className="point-arm" x1="44" y1="63" x2="62" y2="45" strokeWidth="1.7" strokeLinecap="round" />
        {/* you, age six */}
        <circle cx="55" cy="64.5" r="2.7" stroke="none" />
        <path d="M51 76 L52 68 Q55 66 58 68 L59 76 Z" stroke="none" />
      </g>
    </svg>
  )
}

/* ------------------------------------------------------- pleiades puzzle */

const PLEIADES = [
  { id: 'electra', x: 104, y: 15, r: 1.7, label: 'Electra' },
  { id: 'taygeta', x: 94, y: 24, r: 1.5, label: 'Taygeta' },
  { id: 'maia', x: 98, y: 33, r: 1.5, label: 'Maia' },
  { id: 'merope', x: 108, y: 38, r: 1.5, label: 'Merope' },
  { id: 'alcyone', x: 113, y: 26, r: 2.1, label: 'Alcyone' },
  { id: 'atlas', x: 124, y: 31, r: 1.8, label: 'Atlas' },
  { id: 'pleione', x: 127, y: 22, r: 1.4, label: 'Pleione' },
]

/** Tap the seven lights in any order. Optional flavour: nothing depends on finishing it. */
function PleiadesPuzzle() {
  const [tapped, setTapped] = useState<string[]>([])
  const done = tapped.length === PLEIADES.length
  const tap = (id: string) => {
    if (tapped.includes(id)) return
    const next = [...tapped, id]
    setTapped(next)
    next.length === PLEIADES.length ? sfx.success() : sfx.pass()
  }
  const pts = tapped.map((id) => PLEIADES.find((p) => p.id === id)!)
  return (
    <svg className="pz-svg" viewBox="0 0 160 90" aria-label="Interactive: tap the seven stars of the Pleiades">
      {done && <circle className="pz-haze" cx="113" cy="27" r="24" fill="#9fd0ff" />}
      {pts.length > 1 && <polyline className="pz-line" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />}
      {PLEIADES.map((p) => {
        const on = tapped.includes(p.id)
        return (
          <g key={p.id} className={`pz-star ${on ? 'on' : ''}`} role="button" tabIndex={0} aria-pressed={on} aria-label={`${p.label}${on ? ', connected' : ''}`}
            onClick={(e) => { e.stopPropagation(); tap(p.id) }}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); tap(p.id) } }}>
            <circle className="pz-hit" cx={p.x} cy={p.y} r="6" />
            {!on && <circle className="pz-ring" cx={p.x} cy={p.y} r={p.r + 2.2} />}
            <circle className="pz-core" cx={p.x} cy={p.y} r={on ? p.r + 0.6 : p.r} />
          </g>
        )
      })}
      <text className="pz-note" x="80" y="7" textAnchor="middle">
        {done ? 'Seven. The Pleiades.' : `${tapped.length} of 7 · tap each light`}
      </text>
    </svg>
  )
}

/* ---------------------------------------------------------------- present */

function Archive({ name }: { name: string }) {
  return (
    <div className="dossier-card" aria-label={`Application file for ${name}`}>
      <div className="dc-stamp display">RECEIVED</div>
      <div className="mono kicker">APPLICATION FILE · TEAM PLEIADES PROGRAMME</div>
      <h2 className="display dc-name">{name}</h2>
      <div className="dc-reads mono">
        {['Read 1', 'Read 2', 'Read 3'].map((t, i) => <span key={t} style={vars({ '--d': `${0.5 + i * 0.8}s` })}>{t}</span>)}
      </div>
      <div className="dc-lines" aria-hidden>
        <i /><i /><i className="hot"><b className="mono">paragraph 4</b></i><i /><i />
      </div>
    </div>
  )
}

function Logbook() {
  const lines = ['Look carefully.', 'Write it down.', 'Doubt yourself.', 'Look again.']
  return (
    <div className="logbook">
      <div className="mono kicker">THE HABIT</div>
      {lines.map((l, i) => (
        <div key={l} className="lb-line" style={vars({ '--d': `${0.3 + i * 0.9}s` })}>
          <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden><rect x="2" y="2" width="16" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path className="lb-tick" d="M5 10.5 L9 14 L15.5 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          <span>{l}</span>
        </div>
      ))}
    </div>
  )
}

/** Two real plates of Barnard's Star, blinking, with the moving point ringed. */
function Plates() {
  const [f, setF] = useState<'a' | 'b'>('a')
  useEffect(() => { const id = setInterval(() => setF((x) => (x === 'a' ? 'b' : 'a')), 900); return () => clearInterval(id) }, [])
  const pos = f === 'a' ? [247 / 512, 372 / 512] : [266 / 512, 132 / 512]
  return (
    <figure className="plate-box">
      <img src={cdn(TILE_IMG('barnard', 'a'), 720)} alt="" style={{ opacity: f === 'a' ? 1 : 0 }} />
      <img src={cdn(TILE_IMG('barnard', 'b'), 720)} alt="Two archival plates of the same sky, blinking: one point of light has moved" style={{ opacity: f === 'b' ? 1 : 0 }} />
      <div className="reticle" /><div className="crt" />
      <span className="hint-ring" style={{ left: `${pos[0] * 100}%`, top: `${pos[1] * 100}%` }} />
      <span className="mono epoch-tag">{f === 'a' ? 'PLATE A · 1950s' : 'PLATE B · c. 1991'}</span>
    </figure>
  )
}

/* ----------------------------------------------------------------- switch */

export function Art({ art, name }: { art: StoryArt; name: string }) {
  switch (art) {
    case 'archive': return <Archive name={name} />
    case 'roof': return <div className="art-stack"><Roof /></div>
    case 'pleiades': return <div className="art-stack"><Roof dim cluster={false} /><PleiadesPuzzle /></div>
    case 'logbook': return <Logbook />
    case 'plates': return <Plates />
  }
}
