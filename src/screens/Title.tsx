import { useState } from 'react'
import { COMMUNITY } from '../data/fixtures'
import { DEMO_SAVE, useGame } from '../lib/store'
import { cdn, fmt, navigate } from '../lib/util'
import { sfx } from '../lib/sfx'
import { Logo } from '../components/Chrome'
import { DisplayToggles } from '../components/ui'

export function Title() {
  const { s, set } = useGame()
  const [name, setName] = useState(s.callsign)
  const [err, setErr] = useState('')

  const start = () => {
    if (name.trim().length < 2) { setErr('Sign your badge with at least two characters.'); sfx.reject(); return }
    sfx.success()
    set((p) => ({ ...p, callsign: name.trim(), started: true, tutorial: p.tutorialDone ? null : 1 }))
    navigate(s.tutorialDone ? '/map' : '/case/1')
  }

  return (
    <div className="title-screen">
      <div className="title-art" style={{ backgroundImage: `url(${cdn('/img/title-key.png', 1920)})` }} />
      <div className="title-vignette" />
      <div className="title-top">
        <span className="mono">TEAM PLEIADES · CITIZEN SCIENCE PROGRAMME</span>
        <DisplayToggles />
      </div>

      <main className="title-main">
        <div className="title-kicker mono"><span className="rec" /> CASE FILES OPEN · {fmt(COMMUNITY.detectives)} DETECTIVES ON SHIFT</div>
        <Logo big />
        <p className="title-tag">
          The sky is full of things that moved when no one was looking.
          Inspect <em>real NASA survey plates</em>, catch what shifted, and send it through the same checks professional astronomers use.
        </p>

        <div className="badge-sign">
          <label htmlFor="callsign" className="mono">DETECTIVE CALLSIGN</label>
          <div className="badge-row">
            <input id="callsign" value={name} maxLength={24} placeholder="e.g. Det. Nova Reyes" onChange={(e) => { setName(e.target.value); setErr('') }} onKeyDown={(e) => e.key === 'Enter' && start()} aria-invalid={!!err} />
            <button className="btn btn-primary big" onClick={start}><span>{s.started ? 'Resume Investigation' : 'New Investigation'}</span></button>
          </div>
          {err && <div className="field-err">{err}</div>}
          <div className="title-secondary">
            <button className="link-btn" onClick={() => { sfx.click(); set((p) => DEMO_SAVE(p)); navigate('/map') }}>Load presentation save, Rank 1, 11 tiles from promotion</button>
            <span className="dot" />
            <a className="link-btn" href="#/archive" onClick={() => sfx.click()}>How the science works</a>
          </div>
        </div>
      </main>

      <div className="title-ticker mono" aria-label="Community totals (demo figures)">
        <div className="ticker-track">
          {[0, 1].map((k) => (
            <span key={k}>
              <b>{fmt(COMMUNITY.tiles)}</b> tiles reviewed <i>◆</i> <b>{fmt(COMMUNITY.known)}</b> known objects matched <i>◆</i> <b>{fmt(COMMUNITY.rejected)}</b> false leads ruled out <i>◆</i> <b>{COMMUNITY.candidates}</b> candidates queued for professional follow-up <i>◆</i> Data: NASA SkyView · DSS · 2MASS · WISE · SPHEREx-ready pipeline <i>◆</i> Community figures are demo data <i>◆</i>{' '}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
