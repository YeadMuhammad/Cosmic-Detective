import { useEffect, useRef, type ReactNode } from 'react'
import { nextRank, rankFor, RANKS, type Verdict } from '../data/fixtures'
import { useGame } from '../lib/store'
import { sfx } from '../lib/sfx'

/** Animated three-layer parallax starfield drawn on a fixed canvas. */
export function Starfield({ density = 1 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const g = c.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0, raf = 0
    let stars: { x: number; y: number; z: number; t: number }[] = []
    const resize = () => {
      w = c.width = window.innerWidth * devicePixelRatio
      h = c.height = window.innerHeight * devicePixelRatio
      stars = Array.from({ length: Math.round((w * h) / 9000 * density) }, () => ({ x: Math.random() * w, y: Math.random() * h, z: Math.random() ** 2, t: Math.random() * 6.28 }))
    }
    resize()
    window.addEventListener('resize', resize)
    const draw = (time: number) => {
      g.clearRect(0, 0, w, h)
      const col = getComputedStyle(document.documentElement).getPropertyValue('--star').trim() || '#dfe8ff'
      g.fillStyle = col
      for (const s of stars) {
        if (!reduce) { s.x -= (0.05 + s.z * 0.35) * devicePixelRatio; if (s.x < 0) s.x = w }
        g.globalAlpha = 0.25 + s.z * 0.6 + Math.sin(time / 700 + s.t) * 0.15
        const r = (0.4 + s.z * 1.3) * devicePixelRatio
        g.fillRect(s.x, s.y, r, r)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [density])
  return <canvas ref={ref} className="starfield" aria-hidden />
}

/** Hexagonal rank insignia with one pip per rank. */
export function RankEmblem({ n, size = 44, glow = false }: { n: number; size?: number; glow?: boolean }) {
  const pips = Array.from({ length: n })
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`emblem ${glow ? 'glow' : ''}`} aria-label={`Rank ${n}`}>
      <defs>
        <linearGradient id={`eg${n}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--rank)" />
          <stop offset="1" stopColor="var(--rank-deep)" />
        </linearGradient>
      </defs>
      <path d="M32 3 L57 17 L57 47 L32 61 L7 47 L7 17 Z" fill="var(--panel-2)" stroke={`url(#eg${n})`} strokeWidth="3.5" />
      <path d="M32 11 L50 21 L50 43 L32 53 L14 43 L14 21 Z" fill="none" stroke="var(--rank)" strokeOpacity=".35" strokeWidth="1.2" />
      {n >= 4 && <path d="M19 44 L32 51 L45 44" fill="none" stroke="var(--rank)" strokeWidth="3" strokeLinecap="round" />}
      {n >= 5 && <circle cx="32" cy="20" r="4" fill="var(--rank)" />}
      {pips.slice(0, 3).map((_, i) => {
        const cx = 32 + (i - (Math.min(n, 3) - 1) / 2) * 11
        return <path key={i} transform={`translate(${cx} 33)`} d="M0 -7 L2 -2 L7 -2 L3 1.5 L4.5 7 L0 3.6 L-4.5 7 L-3 1.5 L-7 -2 L-2 -2 Z" fill="var(--rank)" />
      })}
    </svg>
  )
}

export function XPBar({ compact = false }: { compact?: boolean }) {
  const { s } = useGame()
  const r = rankFor(s.tiles)
  const nx = nextRank(s.tiles)
  const pct = nx ? ((s.tiles - r.tiles) / (nx.tiles - r.tiles)) * 100 : 100
  return (
    <div className={`xpbar ${compact ? 'compact' : ''}`} data-tut="xp">
      <RankEmblem n={r.n} size={compact ? 36 : 52} />
      <div className="xp-body">
        <div className="xp-top">
          <span className="xp-rank">R{r.n} · {r.title}</span>
          <span className="mono xp-num">{s.xp.toLocaleString()} XP</span>
        </div>
        <div className="xp-track"><div className="xp-fill" style={{ transform: `scaleX(${Math.max(0.02, pct / 100)})` }} /></div>
        {!compact && <div className="xp-sub mono">{nx ? `${s.tiles} / ${nx.tiles} tiles to ${nx.title}` : 'Maximum rank reached'}</div>}
      </div>
    </div>
  )
}

const VERDICTS: Record<Verdict, { label: string; cls: string; icon: ReactNode }> = {
  accepted: { label: 'Accepted', cls: 'v-ok', icon: <path d="M3 8.5 L6.5 12 L13 4.5" /> },
  known: { label: 'Known object', cls: 'v-known', icon: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5 V8.5 M8 11 V11.2" /></> },
  'rejected-stationary': { label: 'Rejected · Stationary', cls: 'v-bad', icon: <path d="M4 4 L12 12 M12 4 L4 12" /> },
  'rejected-halo': { label: 'Rejected · Artifact', cls: 'v-bad', icon: <><circle cx="8" cy="8" r="5.5" /><path d="M4 12 L12 4" /></> },
  pending: { label: 'Pending consensus', cls: 'v-pending', icon: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5 V8 L10 9.5" /></> },
  candidate: { label: 'Candidate · follow-up', cls: 'v-cand', icon: <path d="M8 2.5 L13.5 8 L8 13.5 L2.5 8 Z" /> },
  clear: { label: 'Cleared', cls: 'v-info', icon: <path d="M3 8 H13" /> },
  missed: { label: 'Missed motion', cls: 'v-bad', icon: <path d="M8 3 V9 M8 12 V12.3" /> },
}
export function Chip({ v, small }: { v: Verdict; small?: boolean }) {
  const d = VERDICTS[v]
  return (
    <span className={`chip ${d.cls} ${small ? 'sm' : ''}`}>
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d.icon}</svg>
      {d.label}
    </span>
  )
}

export function Btn({ children, variant = 'primary', onClick, disabled, className = '', ...rest }: { children: ReactNode; variant?: 'primary' | 'ghost' | 'danger' | 'ok'; onClick?: () => void; disabled?: boolean; className?: string; [k: string]: any }) {
  return (
    <button
      className={`btn btn-${variant} ${className}`}
      disabled={disabled}
      onMouseEnter={() => !disabled && sfx.hover()}
      onClick={() => { sfx.click(); onClick?.() }}
      {...rest}
    >
      <span>{children}</span>
    </button>
  )
}

export function DisplayToggles() {
  const { s, set } = useGame()
  return (
    <div className="display-toggles" role="group" aria-label="Display mode">
      <button className={s.theme === 'dark' ? 'on' : ''} onClick={() => { sfx.click(); set((p) => ({ ...p, theme: 'dark' })) }} title="Dark mode" aria-pressed={s.theme === 'dark'}>
        <svg viewBox="0 0 16 16" width="15" height="15"><path d="M11.5 10.5A5.5 5.5 0 0 1 5.5 4.5 5 5 0 0 1 6.3 2 6 6 0 1 0 14 9.7a5 5 0 0 1-2.5.8z" fill="currentColor" /></svg>
      </button>
      <button className={s.theme === 'light' ? 'on' : ''} onClick={() => { sfx.click(); set((p) => ({ ...p, theme: 'light' })) }} title="Light mode" aria-pressed={s.theme === 'light'}>
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" /></svg>
      </button>
      <button className={s.colorblind ? 'on cb' : 'cb'} onClick={() => { sfx.click(); set((p) => ({ ...p, colorblind: !p.colorblind })) }} title="Colorblind-safe mode (Okabe–Ito palette)" aria-pressed={s.colorblind}>
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" /><circle cx="8" cy="8" r="2.2" fill="currentColor" /></svg>
        <span>CB</span>
      </button>
    </div>
  )
}

export const RANK_LIST = RANKS
