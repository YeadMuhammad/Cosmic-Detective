import type { ReactNode } from 'react'
import { cdn, navigate } from '../lib/util'
import { sfx } from '../lib/sfx'
import { GUIDE, type Chapter } from '../data/fixtures'
import { Btn } from './ui'

/** Top bar shared by the tool-driven cases (Chapters 3 and 4). Mirrors the Chapter 1 case bar. */
export function CaseBar({ n, chapter, title, solved, stats, onFile }: {
  n: number; chapter: number; title: string; solved: boolean
  stats: { label: string; value: ReactNode; xp?: boolean }[]; onFile: () => void
}) {
  return (
    <div className="case-bar">
      <div className="case-id">
        <span className="mono kicker">CH {chapter} · CASE {String(n).padStart(3, '0')}</span>
        <h1 className="display">{title}</h1>
      </div>
      <div className={`objective ${solved ? 'done' : ''}`}>
        <span className="obj-box">{solved && <svg viewBox="0 0 16 16"><path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.6" /></svg>}</span>
        <div><span className="mono">MANDATORY</span>Flag the primary anomaly</div>
      </div>
      <div className="case-stats mono">
        {stats.map((s) => <div key={s.label}><b className={s.xp ? 'xp-col' : ''}>{s.value}</b><span>{s.label}</span></div>)}
      </div>
      <div className="case-actions">
        <Btn variant="ghost" onClick={() => navigate('/map')}>Abandon</Btn>
        <Btn variant="ok" disabled={!solved} onClick={onFile} title={solved ? '' : 'Solve the mandatory target first'}>File report</Btn>
      </div>
    </div>
  )
}

export function Briefing({ n, chapter, ch, title, text, lesson, grid, onBegin }: {
  n: number; chapter: number; ch: Chapter; title: string; text: string
  lesson: { name: string; text: string }; grid: [string, string][]; onBegin: () => void
}) {
  return (
    <div className="briefing-overlay">
      <div className="folder">
        <div className="folder-tab mono">CASE {String(n).padStart(3, '0')}</div>
        <div className="stamp">CLASSIFIED</div>
        <div className="mono kicker">CASE FILE · CHAPTER {chapter}: {ch.title.toUpperCase()}</div>
        <h2 className="display">{title}</h2>
        <p className="folder-text">{text}</p>
        <div className="lesson">
          <span className="mono">NEW TOOL LESSON</span>
          <strong>{lesson.name}</strong>
          <p>{lesson.text}</p>
        </div>
        <div className="folder-grid mono">{grid.map(([k, v]) => <div key={k}><span>{k}</span>{v}</div>)}</div>
        <div className="folder-foot">
          <img src={cdn(GUIDE.img, 120)} alt="" />
          <span>Assigned by <b>{GUIDE.name}</b><br /><em>{GUIDE.role}</em></span>
          <Btn onClick={() => { sfx.open(); onBegin() }}>Begin investigation</Btn>
        </div>
      </div>
    </div>
  )
}
