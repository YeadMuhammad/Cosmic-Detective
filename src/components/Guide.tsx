import { useEffect, useState } from 'react'
import { GUIDE } from '../data/fixtures'
import { useGame } from '../lib/store'
import { cdn, navigate } from '../lib/util'
import { sfx } from '../lib/sfx'

interface Step { target: string; title: string; text: string; manual?: string }
export const TUTORIAL: Record<number, Step> = {
  1: { target: 'briefing', title: 'The case file', text: "Welcome aboard, detective. Every investigation starts with a briefing. Read what the archive flagged, then press Begin Investigation." },
  2: { target: 'tile-target', title: 'Open a sky tile', text: 'This grid is your batch: real photographic plates of the sky. I have marked one for you. Open it to view it full size.' },
  3: { target: 'tool-blink', title: 'The Blink Comparator', text: 'Two exposures of the same sky, taken about forty years apart. Switch on the blink comparator and watch. Stars stay put. Something here does not.' },
  4: { target: 'inspect', title: 'Mark and flag', text: 'See the bright star that jumps? Click it on either plate to place your marker, then press Flag Anomaly. The rings show you where to look, this once.' },
  5: { target: 'result', title: 'Evidence before reward', text: 'A flag is never taken at face value. Each check runs in the open, including rejections. Yours survived, and matched a real catalogue: Barnard\'s Star, the fastest star in our sky.', manual: 'File the report' },
  6: { target: 'xp', title: 'Experience and rank', text: 'Your report is in. Collect your reward and watch your progress toward Rank 2, Field Analyst. Every tile you review counts.' },
  7: { target: 'next-level', title: 'The chapter map', text: 'Case 002 is now unlocked. From here on you work the full batch on your own. I will be in the archive if you need me.', manual: 'Got it' },
}

export function Guide() {
  const { s, set } = useGame()
  const step = s.tutorial
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [typed, setTyped] = useState('')
  const cfg = step ? TUTORIAL[step] : null

  useEffect(() => {
    if (!cfg) return
    const find = () => {
      const el = document.querySelector(`[data-tut="${cfg.target}"]`)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    find()
    const id = setInterval(find, 250)
    window.addEventListener('resize', find)
    window.addEventListener('scroll', find, true)
    return () => { clearInterval(id); window.removeEventListener('resize', find); window.removeEventListener('scroll', find, true) }
  }, [cfg])

  useEffect(() => {
    if (!cfg) return
    sfx.open()
    setTyped('')
    let i = 0
    const id = setInterval(() => { i += 2; setTyped(cfg.text.slice(0, i)); if (i >= cfg.text.length) clearInterval(id) }, 16)
    return () => clearInterval(id)
  }, [cfg])

  if (!cfg || !step) return null
  const skip = () => set((p) => ({ ...p, tutorial: null, tutorialDone: true }))
  const manual = () => {
    if (step === 5) { set((p) => ({ ...p, tutorial: 6 })); navigate('/debrief/1') }
    if (step === 7) { set((p) => ({ ...p, tutorial: null, tutorialDone: true })); sfx.success() }
  }
  const pad = 10
  const r = rect && { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 }
  const side = r && r.x + r.w / 2 > window.innerWidth / 2 ? 'left' : 'right'

  return (
    <div className="guide-layer">
      {r ? (
        <>
          <div className="blocker" style={{ left: 0, top: 0, width: '100%', height: Math.max(0, r.y) }} />
          <div className="blocker" style={{ left: 0, top: r.y + r.h, width: '100%', bottom: 0 }} />
          <div className="blocker" style={{ left: 0, top: r.y, width: Math.max(0, r.x), height: r.h }} />
          <div className="blocker" style={{ left: r.x + r.w, top: r.y, right: 0, height: r.h }} />
          <div className="spotlight" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
        </>
      ) : <div className="blocker dim" style={{ inset: 0 }} />}

      <div className={`guide-box ${side ?? 'right'}`} role="dialog" aria-live="polite">
        <img src={cdn(GUIDE.img, 200)} alt={GUIDE.name} className="guide-face" />
        <div className="guide-body">
          <div className="guide-head">
            <span className="guide-name">{GUIDE.name}</span>
            <span className="mono guide-step">STEP {step}/7</span>
          </div>
          <h4>{cfg.title}</h4>
          <p>{typed}<span className="caret" /></p>
          <div className="guide-actions">
            {cfg.manual && <button className="btn btn-primary sm" onClick={() => { sfx.click(); manual() }}><span>{cfg.manual}</span></button>}
            <button className="link-btn" onClick={() => { sfx.click(); skip() }}>Skip tutorial</button>
          </div>
        </div>
      </div>
    </div>
  )
}
