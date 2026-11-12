import { useCallback, useEffect, useRef, useState } from 'react'
import { GUIDE } from '../data/fixtures'
import { STORIES } from '../data/story'
import { useGame } from '../lib/store'
import { cdn, navigate } from '../lib/util'
import { sfx } from '../lib/sfx'
import { Art } from '../components/StoryScenes'
import { Btn } from '../components/ui'
import '../story.css'

/** Reveals text letter by letter. `finish()` shows the rest at once. Reduced-motion users get it instantly. */
function useTypewriter(text: string, speed = 18) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(text.length); return }
    setN(0)
    const id = setInterval(() => setN((v) => { if (v >= text.length) { clearInterval(id); return v } return v + 1 }), speed)
    return () => clearInterval(id)
  }, [text, speed])
  return { shown: text.slice(0, n), done: n >= text.length, finish: () => setN(text.length) }
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

export function StoryScreen({ chapter }: { chapter: number }) {
  const { s, set } = useGame()
  const story = STORIES[chapter]
  const name = s.callsign.trim() || 'detective'
  const wasSeen = useRef(s.storySeen.includes(chapter)) // replays return to the map
  const [idx, setIdx] = useState(-1) // -1 = title card
  const last = (story?.scenes.length ?? 1) - 1
  const scene = story && idx >= 0 ? story.scenes[idx] : null
  const text = scene ? scene.text.replaceAll('{name}', name) : ''
  const { shown, done, finish } = useTypewriter(text)

  const leave = useCallback(() => {
    if (!story) return
    set((p) => ({
      ...p,
      storySeen: p.storySeen.includes(chapter) ? p.storySeen : [...p.storySeen, chapter],
      // the first story hands over to the existing guided tutorial
      tutorial: chapter === 1 && !wasSeen.current && !p.tutorialDone ? 1 : p.tutorial,
    }))
    sfx.success()
    navigate(wasSeen.current ? '/map' : `/case/${story.firstCase}`)
  }, [story, chapter, set])

  const next = useCallback(() => {
    if (idx < 0) { sfx.open(); setIdx(0); return }
    if (!done) { finish(); return }
    if (idx < last) { sfx.click(); setIdx(idx + 1) }
  }, [idx, done, finish, last])

  useEffect(() => { if (!story) navigate('/map') }, [story])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { leave(); return }
      if (e.key === 'ArrowLeft') { setIdx((i) => Math.max(-1, i - 1)); return }
      const t = e.target as HTMLElement
      if (t.tagName === 'BUTTON' || t.getAttribute('role') === 'button') return
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [next, leave])

  if (!story) return null
  const interactive = !!scene?.interaction
  const isLast = idx === last
  const onStage = () => { if (idx < 0 || !done || !interactive) next() }

  return (
    <div className={`story ${scene?.mode ?? 'present'}`} onClick={onStage}>
      <div className="story-sepia" aria-hidden />

      <header className="story-top" onClick={stop}>
        <span className="mono kicker">CHAPTER {chapter} · {story.title.toUpperCase()}</span>
        <ol className="story-dots" aria-label="Story progress">
          {story.scenes.map((_, i) => <li key={i} className={i === idx ? 'now' : i < idx ? 'past' : ''} />)}
        </ol>
        <button className="link-btn" onClick={leave}>Skip story (Esc)</button>
      </header>

      {!scene ? (
        <div className="story-title">
          <div className="story-seven" aria-hidden>{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ ['--i' as any]: i }} />)}</div>
          <h1 className="display">{story.title}</h1>
          <p className="story-welcome">Welcome, <b>{name}</b>.</p>
          <p className="soft">{story.subtitle}</p>
          <div className="cap-actions" onClick={stop}>
            <Btn onClick={next}>Begin</Btn>
          </div>
          <span className="mono story-hint">or press Space</span>
        </div>
      ) : (
        <>
          <div className="story-art" key={idx}><Art art={scene.art} name={name} /></div>
          <section className={`story-caption ${scene.mode}`} aria-live="polite">
            {scene.mode === 'present' && <img className="cap-face" src={cdn(GUIDE.img, 200)} alt="" />}
            <div className="cap-body">
              <div className="cap-who mono">
                {scene.mode === 'present' ? `${GUIDE.name} · ${GUIDE.role}` : `${scene.place} · read aloud by Dr. Chowdhury`}
              </div>
              <p className="cap-text">{shown}{!done && <span className="caret" />}</p>
              <div className="cap-actions" onClick={stop}>
                {done && isLast && <Btn onClick={leave}>{story.cta}</Btn>}
                {done && !isLast && interactive && <Btn variant="ghost" onClick={next}>Continue</Btn>}
                {done && !isLast && !interactive && <span className="mono story-hint">Click or press Space to continue</span>}
                {!done && <span className="mono story-hint">Click to show the full line</span>}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
