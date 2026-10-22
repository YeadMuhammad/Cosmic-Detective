import { useEffect, useState } from 'react'
import { useGame } from '../lib/store'

export function DevInspector() {
  const { s } = useGame()
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!s.presenter) return

    const handleClick = (e: MouseEvent) => {
      if (e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        const el = e.target as HTMLElement
        if (!el) return
        setTargetRect(el.getBoundingClientRect())
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTargetRect(null)
      }
    }

    window.addEventListener('click', handleClick, { capture: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleClick, { capture: true })
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [s.presenter])

  if (!s.presenter || !targetRect) return null

  const pad = 6
  const r = {
    x: targetRect.left - pad,
    y: targetRect.top - pad,
    w: targetRect.width + pad * 2,
    h: targetRect.height + pad * 2,
  }

  return (
    <div className="guide-layer" style={{ zIndex: 100 }} onClick={() => setTargetRect(null)}>
      {/* Dimmed background blockers around the spotlight */}
      <div className="blocker" style={{ left: 0, top: 0, width: '100%', height: Math.max(0, r.y) }} />
      <div className="blocker" style={{ left: 0, top: r.y + r.h, width: '100%', bottom: 0 }} />
      <div className="blocker" style={{ left: 0, top: r.y, width: Math.max(0, r.x), height: r.h }} />
      <div className="blocker" style={{ left: r.x + r.w, top: r.y, right: 0, height: r.h }} />
      
      {/* Spotlight ring */}
      <div className="spotlight" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
    </div>
  )
}