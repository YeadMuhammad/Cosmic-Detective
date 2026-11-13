import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { TILE_IMG } from '../data/fixtures'
import type { StoryArt } from '../data/story'
import { cdn } from '../lib/util'
import { sfx } from '../lib/sfx'

const vars = (o: Record<string, string>) => o as CSSProperties

/* ------------------------------------------------------------------ roof */

/** Deterministic scatter of realistic pinpoint stars. */
function useSkyStars(count: number) {
  return useMemo(() => {
    let s = 137
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280 }
    return Array.from({ length: count }, () => {
      const rVal = rnd()
      // Real magnitude distribution: 75% tiny pinpoints, 20% medium, 5% brighter
      const r = rVal < 0.75 ? 0.12 + rnd() * 0.15 : rVal < 0.95 ? 0.30 + rnd() * 0.14 : 0.50 + rnd() * 0.18
      const cVal = rnd()
      const color = cVal < 0.72 ? '#ffffff' : cVal < 0.9 ? '#dce9ff' : '#c4d8fa'
      const twClass = rnd() < 0.35 ? 'tw-fast' : rnd() < 0.7 ? 'tw-mid' : 'tw-slow'
      return {
        x: -60 + rnd() * 280,
        y: -50 + rnd() * 115,
        r,
        color,
        twClass,
        d: rnd() * 5,
        opacity: 0.3 + rnd() * 0.65,
      }
    })
  }, [count])
}

/** Authentic Pleiades cluster star pattern */
const PLEIADES = [
  { id: 'electra', x: 104, y: 15, r: 1.5, label: 'Electra' },
  { id: 'taygeta', x: 94, y: 24, r: 1.3, label: 'Taygeta' },
  { id: 'maia', x: 98, y: 33, r: 1.3, label: 'Maia' },
  { id: 'merope', x: 108, y: 38, r: 1.3, label: 'Merope' },
  { id: 'alcyone', x: 113, y: 26, r: 1.8, label: 'Alcyone' },
  { id: 'atlas', x: 124, y: 31, r: 1.5, label: 'Atlas' },
  { id: 'pleione', x: 127, y: 22, r: 1.2, label: 'Pleione' },
]

function Roof({ dim = false, cluster = true }: { dim?: boolean; cluster?: boolean }) {
  const stars = useSkyStars(240)
  return (
    <svg className={`roof-svg ${dim ? 'dim' : ''}`} viewBox="0 0 160 90" preserveAspectRatio="xMidYMax slice" role="img" aria-label="A child and a man on a rooftop at night, looking at a small cluster of stars">
      <defs>
        {/* Real crystalline midnight sky gradient: pure cosmic dark to deep midnight navy */}
        <linearGradient id="roofSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#020409" />
          <stop offset="45%" stopColor="#050a16" />
          <stop offset="80%" stopColor="#091224" />
          <stop offset="100%" stopColor="#0e1a34" />
        </linearGradient>

        {/* Delicate sapphire reflection nebula (Pleiades dust cloud) */}
        <radialGradient id="clusterGlow">
          <stop offset="0%" stopColor="#d0e5ff" stopOpacity="0.5" />
          <stop offset="40%" stopColor="#70aaff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#3060c0" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="-80" y="-60" width="320" height="180" fill="url(#roofSky)" />

      {/* Realistic twinkling pinpoint starfield */}
      {stars.map((st, i) => (
        <circle
          key={i}
          className={st.twClass}
          cx={st.x}
          cy={st.y}
          r={st.r}
          fill={st.color}
          opacity={st.opacity}
          style={vars({ animationDelay: `${st.d}s` })}
        />
      ))}

      {/* Pleiades cluster: classic star asterism with ethereal sapphire glow */}
      {cluster && (
        <g className="roof-cluster">
          <circle cx="113" cy="27" r="20" fill="url(#clusterGlow)" />
          {PLEIADES.map((p, i) => (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r={p.r * 1.8} fill="#9ec5ff" opacity="0.3" />
              <circle
                className="tw-fast"
                cx={p.x}
                cy={p.y}
                r={p.r * 0.6}
                fill="#ffffff"
                style={vars({ animationDelay: `${i * 0.35}s` })}
              />
            </g>
          ))}
          {/* Alcyone subtle diffraction cross */}
          <line x1="108" y1="26" x2="118" y2="26" stroke="#a5cbff" strokeWidth="0.22" opacity="0.45" />
          <line x1="113" y1="21" x2="113" y2="31" stroke="#a5cbff" strokeWidth="0.22" opacity="0.45" />
        </g>
      )}

      {/* Dark city skyline: drops low behind figures (x=20..54) so the figures stand clearly against open sky */}
      <path d="M-80 70 V60 H-50 V56 H-20 V62 H5 V55 H15 V64 H22 V68 H54 V65 H68 V58 H88 V62 H100 V70 H116 V64 H130 V56 H142 V65 H160 V58 H185 V55 H200 V62 H245 V70 Z" fill="#050811" />
      {/* Radio tower with blinking red beacon */}
      <line x1="12" y1="55" x2="12" y2="47" stroke="#050811" strokeWidth="0.5" />
      <circle cx="12" cy="47" r="0.55" fill="#ff4040" className="beacon" />
      {/* Rooftop water tank */}
      <path d="M80 62 H86 V58 H80 Z M81.5 62 V66 M84.5 62 V66" stroke="#050811" strokeWidth="0.6" fill="#050811" />

      {/* Rare flickering warm windows during the blackout */}
      <rect className="win" x="-30" y="61" width="1.8" height="2.2" fill="#ffd07a" style={vars({ animationDelay: '1.2s' })} />
      <rect className="win w2" x="133" y="60" width="1.8" height="2.2" fill="#ffd07a" />
      <rect className="win w2" x="190" y="59" width="1.8" height="2.2" fill="#ffd07a" style={vars({ animationDelay: '3.8s' })} />

      {/* Roof parapet and facade */}
      <rect x="-80" y="68.5" width="320" height="1.5" fill="#0c121e" />
      <rect x="-80" y="70" width="320" height="50" fill="#04060a" />

      {/* 
        Clean pictographic figures matching user reference image:
        Solid circular heads, connected necks, rounded rectangle torsos,
        clean capsule arms and clean straight legs with rounded caps on the roof floor.
      */}
      <g fill="#04070d" stroke="#04070d">
        {/* --- Father (Abbu, pointing toward the cluster) --- */}
        {/* Head */}
        <circle cx="28" cy="41" r="3.4" stroke="none" />
        {/* Neck (solid connection) */}
        <rect x="26.8" y="43.5" width="2.4" height="2.5" stroke="none" />
        {/* Torso (rounded rectangle) */}
        <rect x="25" y="45.5" width="6" height="11.5" rx="2.2" stroke="none" />
        {/* Left arm: bent at side, hand on hip (matching reference image) */}
        <polyline points="25.5,47.5 21.5,51.5 25,55.5" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Right arm: raised pointing toward the stars (matching reference image) */}
        <polyline points="30.5,47.5 35.5,41.5 40.5,34" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Clean straight legs on roof floor (matching reference image) */}
        <line x1="26.8" y1="56.5" x2="26.8" y2="70" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="29.2" y1="56.5" x2="29.2" y2="70" strokeWidth="2.2" strokeLinecap="round" />

        {/* --- Child (Son, age six, standing distinctly beside Abbu) --- */}
        {/* Head */}
        <circle cx="44" cy="53" r="2.3" stroke="none" />
        {/* Neck (solid connection) */}
        <rect x="43.2" y="54.8" width="1.6" height="1.8" stroke="none" />
        {/* Torso (rounded rectangle) */}
        <rect x="42.2" y="56.2" width="3.6" height="7.2" rx="1.4" stroke="none" />
        {/* Left leg (clean straight leg on roof floor) */}
        <line x1="43" y1="63.2" x2="43" y2="70" strokeWidth="1.3" strokeLinecap="round" />
        {/* Right leg (clean straight leg on roof floor) */}
        <line x1="45" y1="63.2" x2="45" y2="70" strokeWidth="1.3" strokeLinecap="round" />
        {/* Left arm at side */}
        <line x1="42.2" y1="57.5" x2="41" y2="63.5" strokeWidth="1.2" strokeLinecap="round" />
        {/* Right arm at side */}
        <line x1="45.8" y1="57.5" x2="47" y2="63.5" strokeWidth="1.2" strokeLinecap="round" />
      </g>
    </svg>
  )
}

/* ------------------------------------------------------- pleiades puzzle */

/** Tap the seven lights in any order. Restored classic Pleiades pattern. */
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
    <svg className="pz-svg" viewBox="0 0 160 90" preserveAspectRatio="xMidYMax slice" aria-label="Interactive: tap the seven stars of the Pleiades">
      {done && <circle className="pz-haze" cx="113" cy="27" r="24" fill="#70aaff" />}
      {pts.length > 1 && <polyline className="pz-line" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />}
      {PLEIADES.map((p) => {
        const on = tapped.includes(p.id)
        return (
          <g key={p.id} className={`pz-star ${on ? 'on' : ''}`} role="button" tabIndex={0} aria-pressed={on} aria-label={`${p.label}${on ? ', connected' : ''}`}
            onClick={(e) => { e.stopPropagation(); tap(p.id) }}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); tap(p.id) } }}>
            <circle className="pz-hit" cx={p.x} cy={p.y} r="5" />
            {!on && <circle className="pz-ring" cx={p.x} cy={p.y} r={p.r + 1.6} />}
            <circle className="pz-core" cx={p.x} cy={p.y} r={on ? p.r + 0.4 : p.r} />
          </g>
        )
      })}
      <text className="pz-note" x="113" y="7" textAnchor="middle">
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
      <div className="mono kicker">THE HABIT · OBSERVATIONAL PROTOCOL</div>
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
