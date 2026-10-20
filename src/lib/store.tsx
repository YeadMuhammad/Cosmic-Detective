import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { rankFor } from '../data/fixtures'
import { setSound } from './sfx'

// Demo-only client state, kept in localStorage so a presenter can refresh
// without losing the run. A later milestone moves this to the progress service.
export interface GameState {
  callsign: string
  started: boolean
  theme: 'dark' | 'light'
  colorblind: boolean
  sound: boolean
  xp: number
  tiles: number
  correct: number
  judged: number
  known: number
  artifacts: number
  clears: number
  completed: number[]
  badges: string[]
  tutorial: number | null // active guided step (1-7)
  tutorialDone: boolean
  history: { level: number; title: string; xp: number; tiles: number; at: string }[]
  rankUp: number | null // rank number to celebrate
  presenter: boolean
  last: CaseSummary | null // most recent case, read by the debrief screen
}

export interface CaseSummary {
  level: number; title: string; solved: boolean; collected: boolean
  xp: number; tiles: number; correct: number; judged: number; known: number; artifacts: number; clears: number
  results: { id: string; verdict: string }[]
}

const KEY = 'cosmic-detective:v1'
export const FRESH: GameState = {
  callsign: '', started: false, theme: 'dark', colorblind: false, sound: true,
  xp: 0, tiles: 0, correct: 0, judged: 0, known: 0, artifacts: 0, clears: 0,
  completed: [], badges: [], tutorial: null, tutorialDone: false, history: [], rankUp: null, presenter: false, last: null,
}

/** A pre-played save so a presentation can jump straight into a rank-up moment. */
export const DEMO_SAVE = (s: GameState): GameState => ({
  ...s, callsign: s.callsign || 'Det. Yead Muhammad', started: true,
  xp: 5240, tiles: 89, correct: 68, judged: 89, known: 3, artifacts: 14, clears: 65,
  completed: [1, 2, 3], badges: ['first-flag', 'barnard', 'skeptic', 'artifact'], tutorial: null, tutorialDone: true,
  history: [
    { level: 3, title: "Lalande's Drift", xp: 210, tiles: 12, at: '2026-10-04' },
    { level: 2, title: 'The Bright Deceivers', xp: 195, tiles: 12, at: '2026-10-03' },
    { level: 1, title: 'A Light That Will Not Stay Still', xp: 230, tiles: 12, at: '2026-10-02' },
  ],
})

interface Ctx {
  s: GameState
  set: (fn: (s: GameState) => GameState) => void
  award: (patch: Partial<Pick<GameState, 'xp' | 'tiles' | 'correct' | 'judged' | 'known' | 'artifacts' | 'clears'>>) => void
  badge: (id: string) => void
}
const GameCtx = createContext<Ctx>(null!)

export function GameProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<GameState>(() => {
    try { return { ...FRESH, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return FRESH }
  })
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(s))
    document.documentElement.dataset.theme = s.theme
    document.documentElement.dataset.cb = s.colorblind ? 'on' : 'off'
    setSound(s.sound)
  }, [s])

  // set / award / badge keep a stable identity, so effects that list them as dependencies
  // do not re-run on every state change.
  const set = useCallback((fn: (s: GameState) => GameState) => setS(fn), [])
  const award = useCallback((patch: Partial<Pick<GameState, 'xp' | 'tiles' | 'correct' | 'judged' | 'known' | 'artifacts' | 'clears'>>) => setS((prev) => {
    const next = { ...prev }
    for (const [k, v] of Object.entries(patch)) (next as any)[k] = (prev as any)[k] + (v as number)
    const before = rankFor(prev.tiles).n
    const after = rankFor(next.tiles).n
    if (after > before) {
      next.rankUp = after
      if (after >= 2 && !next.badges.includes('field-analyst')) next.badges = [...next.badges, 'field-analyst']
    }
    return next
  }), [])
  const badge = useCallback((id: string) => setS((prev) => (prev.badges.includes(id) ? prev : { ...prev, badges: [...prev.badges, id] })), [])
  const api = useMemo<Ctx>(() => ({ s, set, award, badge }), [s, set, award, badge])

  return <GameCtx.Provider value={api}>{children}</GameCtx.Provider>
}
export const useGame = () => useContext(GameCtx)

export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/')
  useEffect(() => {
    const on = () => { setHash(window.location.hash.slice(1) || '/'); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}
