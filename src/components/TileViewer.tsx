import { useEffect, useRef, useState } from 'react'
import { TILE_IMG, type Tile } from '../data/fixtures'
import { cdn, decStr, raStr } from '../lib/util'
import { sfx } from '../lib/sfx'

export type ViewMode = 'a' | 'b' | 'blink' | 'diff'

interface Props {
  tile: Tile
  mode: ViewMode
  speed: number // blink interval ms
  marker: [number, number] | null
  onMark?: (p: [number, number]) => void
  reveal?: boolean // draw the true motion vector after verification
  hint?: boolean // tutorial: pulse the target
  onBlinkTick?: () => void
}

export function TileViewer({ tile, mode, speed, marker, onMark, reveal, hint, onBlinkTick }: Props) {
  const [frame, setFrame] = useState<'a' | 'b'>('a')
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const tick = useRef(onBlinkTick)
  tick.current = onBlinkTick

  useEffect(() => {
    if (mode !== 'blink') { setFrame(mode === 'b' ? 'b' : 'a'); return }
    const id = setInterval(() => { setFrame((f) => (f === 'a' ? 'b' : 'a')); sfx.blink(); tick.current?.() }, speed)
    return () => clearInterval(id)
  }, [mode, speed])

  const A = cdn(TILE_IMG(tile.id, 'a'), 720)
  const B = cdn(TILE_IMG(tile.id, 'b'), 720)
  const shown = mode === 'diff' ? 'diff' : frame

  const pos = (e: React.MouseEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }
  // East is left on sky images, so RA increases to the left.
  const skyAt = ([x, y]: [number, number]) => ({
    ra: tile.ra + (0.5 - x) * tile.size / Math.cos((tile.dec * Math.PI) / 180),
    dec: tile.dec + (0.5 - y) * tile.size,
  })
  const c = cursor ? skyAt(cursor) : { ra: tile.ra, dec: tile.dec }

  return (
    <div className="viewer">
      <div
        ref={box}
        className={`viewer-img mode-${mode} ${onMark ? 'markable' : ''}`}
        onMouseMove={(e) => setCursor(pos(e))}
        onMouseLeave={() => setCursor(null)}
        onClick={(e) => { if (onMark) { sfx.click(); onMark(pos(e)) } }}
        data-tut="viewer"
      >
        <div className="plates">
          <img src={A} alt={`${tile.code} epoch A`} className="plate" style={{ opacity: shown === 'b' ? 0 : 1 }} draggable={false} />
          <img src={B} alt={`${tile.code} epoch B`} className={`plate ${mode === 'diff' ? 'subtract' : ''}`} style={{ opacity: shown === 'a' ? 0 : 1 }} draggable={false} />
        </div>
        <div className="reticle" />
        <div className="crt" />

        {hint && tile.a && tile.b && (
          <>
            <span className="hint-ring" style={{ left: `${tile.a[0] * 100}%`, top: `${tile.a[1] * 100}%` }} />
            <span className="hint-ring" style={{ left: `${tile.b[0] * 100}%`, top: `${tile.b[1] * 100}%` }} />
          </>
        )}
        {reveal && tile.a && tile.b && (
          <svg className="vector" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--known)" /></marker></defs>
            <line x1={tile.a[0] * 100} y1={tile.a[1] * 100} x2={tile.b[0] * 100} y2={tile.b[1] * 100} stroke="var(--known)" strokeWidth=".7" strokeDasharray="2 1.4" markerEnd="url(#ah)" vectorEffect="non-scaling-stroke" />
            <circle cx={tile.a[0] * 100} cy={tile.a[1] * 100} r="3.4" fill="none" stroke="var(--known)" strokeWidth=".5" />
            <circle cx={tile.b[0] * 100} cy={tile.b[1] * 100} r="3.4" fill="none" stroke="var(--known)" strokeWidth=".5" />
          </svg>
        )}
        {marker && <span className="marker" style={{ left: `${marker[0] * 100}%`, top: `${marker[1] * 100}%` }} />}

        {cursor && mode !== 'diff' && (
          <div className="loupe" style={{
            left: `${cursor[0] * 100}%`, top: `${cursor[1] * 100}%`,
            backgroundImage: `url(${frame === 'a' ? A : B})`,
            backgroundPosition: `${cursor[0] * 100}% ${cursor[1] * 100}%`,
          }} />
        )}

        <div className={`epoch-tag ${shown}`}>
          {shown === 'diff' ? 'DIFFERENCE · B − A' : shown === 'a' ? 'EPOCH A · POSS-I · 1950s' : 'EPOCH B · POSS-II · ~1990'}
        </div>
      </div>
      <div className="viewer-foot mono">
        <span>RA {raStr(c.ra)}</span>
        <span>DEC {decStr(c.dec)}</span>
        <span>FOV {(tile.size * 60).toFixed(1)}′ · {((tile.size * 3600) / 512).toFixed(2)}″/px</span>
      </div>
    </div>
  )
}
