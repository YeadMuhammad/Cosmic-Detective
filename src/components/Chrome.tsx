import { useEffect, useState } from 'react'
import { RANKS, TOOLS, CHAPTERS } from '../data/fixtures'
import { DEMO_SAVE, FRESH, useGame } from '../lib/store'
import { navigate } from '../lib/util'
import { sfx } from '../lib/sfx'
import { DisplayToggles, RankEmblem, XPBar } from './ui'

const NAV = [
  ['/map', 'Campaign'],
  ['/ranks', 'Rankings'],
  ['/dossier', 'Dossier'],
  ['/archive', 'Mission'],
] as const

export function Logo({ big = false }: { big?: boolean }) {
  return (
    <span className={`logo ${big ? 'big' : ''}`}>
      <svg viewBox="0 0 40 40" aria-hidden>
        <circle cx="17" cy="17" r="11" fill="none" stroke="currentColor" strokeWidth="3.4" />
        <path d="M25 25 L36 36" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <circle cx="13.5" cy="20" r="2" fill="currentColor" opacity=".5" />
        <circle cx="20" cy="13.5" r="2.6" fill="currentColor" />
      </svg>
      <span className="logo-word"><b>COSMIC</b><i>DETECTIVE</i></span>
    </span>
  )
}

export function HUD({ route }: { route: string }) {
  const { s } = useGame()
  return (
    <header className="hud">
      <button className="hud-logo" onClick={() => { sfx.click(); navigate('/') }} aria-label="Title screen"><Logo /></button>
      <nav className="hud-nav">
        {NAV.map(([href, label]) => (
          <a key={href} href={`#${href}`} className={route.startsWith(href) ? 'active' : ''} onClick={() => sfx.click()} onMouseEnter={() => sfx.hover()}>{label}</a>
        ))}
      </nav>
      <div className="hud-right">
        <div className="hud-callsign mono">{s.callsign || 'Unnamed detective'}</div>
        <XPBar compact />
        <DisplayToggles />
        <a href="#/settings" className="icon-btn" title="Settings" onClick={() => sfx.click()}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
        </a>
      </div>
    </header>
  )
}

export function RankUp() {
  const { s, set } = useGame()
  const n = s.rankUp
  useEffect(() => { if (n) sfx.rankUp() }, [n])
  if (!n) return null
  const r = RANKS[n - 1]
  const ch = CHAPTERS.find((c) => c.n === n)
  const tool = TOOLS.find((t) => t.chapter === n)
  return (
    <div className="rankup" onClick={() => set((p) => ({ ...p, rankUp: null }))}>
      <div className="rankup-rays" />
      <div className="rankup-card" onClick={(e) => e.stopPropagation()}>
        <div className="mono rankup-kicker">PROMOTION · RANK {n}</div>
        <div className="rankup-emblem"><RankEmblem n={n} size={150} glow /></div>
        <h2>{r.title}</h2>
        <p>Your reviews now carry a consensus weight of <b className="mono">×{r.weight.toFixed(1)}</b>. Fewer reviews are needed to resolve a tile when you are on it.</p>
        {tool && ch && (
          <div className="unlock">
            <span className="mono">NEW TOOL UNLOCKED</span>
            <strong>{tool.name}</strong>
            <small>Chapter {ch.n}: {ch.title} is now open. A short guided lesson runs before your first case.</small>
          </div>
        )}
        <button className="btn btn-primary" onClick={() => { sfx.click(); set((p) => ({ ...p, rankUp: null })); navigate('/map') }}><span>Continue</span></button>
      </div>
      {Array.from({ length: 28 }).map((_, i) => <i key={i} className="confetti" style={{ ['--i' as any]: i }} />)}
    </div>
  )
}

/** Hidden controls for live presentations. Toggle with Shift+P or from Settings. */
export function Presenter() {
  const { s, set, award } = useGame()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.shiftKey && e.key.toLowerCase() === 'p') set((p) => ({ ...p, presenter: !p.presenter })) }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [set])
  if (!s.presenter) return null
  return (
    <div className={`presenter ${open ? 'open' : ''}`}>
      <button className="presenter-tab mono" onClick={() => setOpen(!open)}>DEMO CONTROLS</button>
      {open && (
        <div className="presenter-body">
          <button onClick={() => { set((p) => DEMO_SAVE(p)); navigate('/map') }}>Load demo save (189 tiles)</button>
          <button onClick={() => award({ tiles: 25, xp: 400 })}>+25 tiles · +400 XP</button>
          <button onClick={() => set((p) => ({ ...p, rankUp: Math.min(5, (p.rankUp ?? 1) + 1) }))}>Preview rank-up</button>
          <button onClick={() => { set((p) => ({ ...p, completed: [1, 2, 3, 4], tiles: Math.max(p.tiles, 205) })); navigate('/map') }}>Unlock Chapter 2</button>
          <button onClick={() => { set((p) => ({ ...p, tutorial: 1, started: true })); navigate('/case/1') }}>Start tutorial</button>
          <button onClick={() => { set(() => ({ ...FRESH, presenter: true })); navigate('/') }}>Reset to fresh player</button>
          <small className="mono">Shift+P hides this panel</small>
        </div>
      )}
    </div>
  )
}
