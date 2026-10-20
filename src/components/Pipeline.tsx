import { useEffect, useRef, useState } from 'react'
import type { Verdict } from '../data/fixtures'
import { sfx } from '../lib/sfx'
import { Chip } from './ui'

export type CheckStatus = 'wait' | 'run' | 'pass' | 'fail' | 'info'
export interface Check { name: string; status: CheckStatus; note: string }
export interface Result { verdict: Verdict; xp: number; correct: boolean; checks: Check[] }
export interface CatalogCard { name: string; alias: string; note: string; rows: string[] }

/** Plays the verification checks one by one, then hands the result back. */
export function useRunner(onDone: (res: Result, key: string) => void) {
  const [running, setRunning] = useState<{ key: string; res: Result; shown: number } | null>(null)
  const timers = useRef<number[]>([])
  const cb = useRef(onDone)
  cb.current = onDone
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const run = (key: string, res: Result) => {
    setRunning({ key, res, shown: 0 })
    res.checks.forEach((c, i) => timers.current.push(window.setTimeout(() => {
      setRunning((r) => r && { ...r, shown: i + 1 })
      c.status === 'fail' ? sfx.reject() : c.status === 'pass' ? sfx.pass() : sfx.scan()
    }, 650 * (i + 1))))
    timers.current.push(window.setTimeout(() => { cb.current(res, key); setRunning(null) }, 650 * (res.checks.length + 1)))
  }
  return { running, run }
}

export function Pipeline({ code, res, running, extra, catalog, target }: {
  code: string; res: Result; running?: { shown: number } | null; extra?: string; catalog?: CatalogCard | null; target?: boolean
}) {
  const shown = running ? running.shown : res.checks.length
  const done = shown >= res.checks.length
  return (
    <div className={`verify ${running ? 'running' : ''}`}>
      <div className="panel-title mono">VERIFICATION PIPELINE · {code}</div>
      <ol className="checks">
        {res.checks.map((c, i) => {
          const st: CheckStatus = running ? (i < shown ? c.status : i === shown ? 'run' : 'wait') : c.status
          return (
            <li key={c.name} className={`check ${st}`}>
              <span className="check-dot" />
              <div><strong>{c.name}</strong>{st !== 'wait' && st !== 'run' && <p>{c.note}</p>}{st === 'run' && <p className="mono">running…</p>}</div>
            </li>
          )
        })}
      </ol>
      {done && (
        <div className="verdict">
          <Chip v={res.verdict} />
          <span className="mono xp-col">{res.xp ? `+${res.xp} XP` : target && res.verdict === 'known' ? 'CASE PROGRESS' : '+0 XP'}</span>
          {res.verdict === 'known' && catalog && (
            <div className="catalog-card">
              <span className="mono">CATALOG RECORD</span>
              <strong>{catalog.name}</strong>
              <em className="mono">{catalog.alias}</em>
              <p>{catalog.note}</p>
              <div className="mono cat-row">{catalog.rows.map((r) => <span key={r}>{r}</span>)}</div>
            </div>
          )}
          {extra && <p className="soft">{extra}</p>}
        </div>
      )}
    </div>
  )
}
