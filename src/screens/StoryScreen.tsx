import { useCallback, useEffect, useRef, useState } from 'react'
import { GUIDE } from '../data/fixtures'
import { STORIES } from '../data/story'
import { useGame } from '../lib/store'
import { navigate } from '../lib/util'
import { sfx } from '../lib/sfx'
import { Art } from '../components/StoryScenes'
import { Btn } from '../components/ui'
import '../story.css'

/** Reveals text letter by letter. `finish()` shows the rest at once. Reduced-motion users get it instantly. */
function useTypewriter(text: string, speed = 20) {
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
  const [beatIdx, setBeatIdx] = useState(0) // fragmented beat within scene
  const last = (story?.scenes.length ?? 1) - 1
  const scene = story && idx >= 0 ? story.scenes[idx] : null
  const beats = scene ? (scene.beats ?? [scene.text]) : []
  const isLastBeat = beatIdx >= beats.length - 1
  const isLastScene = idx === last
  const rawText = beats[beatIdx] ?? ''
  const text = rawText.replaceAll('{name}', name)
  const { shown, done, finish } = useTypewriter(text, 22)

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
    if (idx < 0) { sfx.open(); setIdx(0); setBeatIdx(0); return }
    if (!done) { finish(); return }
    if (beatIdx < beats.length - 1) {
      sfx.click()
      setBeatIdx((b) => b + 1)
      return
    }
    if (idx < last) {
      sfx.click()
      setIdx((i) => i + 1)
      setBeatIdx(0)
    }
  }, [idx, done, finish, beatIdx, beats.length, last])

  useEffect(() => { if (!story) navigate('/map') }, [story])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { leave(); return }
      if (e.key === 'ArrowLeft') {
        if (beatIdx > 0) {
          setBeatIdx((b) => b - 1)
        } else if (idx > 0 && story) {
          const prevBeats = story.scenes[idx - 1].beats ?? [story.scenes[idx - 1].text]
          setIdx((i) => i - 1)
          setBeatIdx(prevBeats.length - 1)
        } else {
          setIdx(-1)
          setBeatIdx(0)
        }
        return
      }
      const t = e.target as HTMLElement
      if (t.tagName === 'BUTTON' || t.getAttribute('role') === 'button') return
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [next, leave, beatIdx, idx, story])

  if (!story) return null
  const interactive = !!scene?.interaction
  const isFullBleed = scene?.art === 'roof' || scene?.art === 'pleiades'
  const onStage = () => { if (idx < 0 || !done || !interactive || !isLastBeat) next() }

  return (
    <div className={`story ${scene?.mode ?? 'present'} ${scene ? `scene-${scene.art}` : 'scene-title'}`} onClick={onStage}>
      <div className="story-backdrop" aria-hidden />

      <header className="story-top" onClick={stop}>
        <span className="mono kicker">CHAPTER {chapter} · {story.title.toUpperCase()}</span>
        <ol className="story-dots" aria-label="Story progress">
          {story.scenes.map((_, i) => <li key={i} className={i === idx ? 'now' : i < idx ? 'past' : ''} />)}
        </ol>
        <button className="link-btn" onClick={leave}>Skip story [Esc]</button>
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
          <div className={`story-art ${isFullBleed ? 'story-art--full' : 'story-art--focal'}`} key={idx}>
            <Art art={scene.art} name={name} />
          </div>

          <div className="story-gradient-bottom" aria-hidden />

          {/* Cinematic floating subtitle overlay */}
          <section className={`story-caption ${scene.mode}`} aria-live="polite">
            <div className="cap-kicker mono">
              {scene.mode === 'present' ? `${GUIDE.name} · ${GUIDE.role}` : scene.place}
            </div>
            <p className={`cap-text ${text.startsWith('“') ? 'is-quote' : ''}`}>
              {shown}{!done && <span className="caret" />}
            </p>
            <div className="cap-hint-line" onClick={stop}>
              {!done ? (
                <span className="mono story-hint">Click or press Space to reveal</span>
              ) : isLastScene && isLastBeat ? (
                <Btn onClick={leave}>{story.cta} →</Btn>
              ) : isLastBeat && interactive ? (
                <div className="cap-interactive-row">
                  <span className="mono story-hint hint-puzzle">Tap the 7 lights above, or continue</span>
                  <button className="link-btn-glow mono" onClick={next}>Continue →</button>
                </div>
              ) : (
                <span className="mono story-hint ready">Click or press Space to continue <span className="arrow">→</span></span>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
