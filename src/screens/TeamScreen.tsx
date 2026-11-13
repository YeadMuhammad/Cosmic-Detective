import { useState } from 'react'
import { sfx } from '../lib/sfx'
import { ScaleContainer } from '../components/ScaleContainer'

interface TeamMember {
  id: string
  name: string
  designation: string
  img: string
  accent: string
  layoutPosition: 'top-left' | 'top-right' | 'bot-left' | 'bot-right'
  // --- CONTROLS ---
  scaleMultiplier?: number // Enlarge/shrink whole member group
  offsetX?: number         // Nudge whole member group left/right
  offsetY?: number         // Nudge whole member group up/down
  cardOffsetX?: number     // ➔ Nudge ONLY the name tag left/right (in px)
  cardOffsetY?: number     // ➔ Nudge ONLY the name tag up/down (in px)
}

// 📌 CONTROL CENTER: Move name tags independently using cardOffsetX & cardOffsetY!
const TEAM_MEMBERS: TeamMember[] = [
  {
    id: 'purnota',
    name: 'ASHRATUL ZANNATI PURNOTA',
    designation: 'TEAM LEADER',
    img: '/img/TeamPhoto/Purnota.jpg',
    accent: '#fbbf24',
    layoutPosition: 'top-left',
    scaleMultiplier: 1.3,
    offsetX: 0,
    offsetY: 0,
    cardOffsetX: -30, // Change this to move Purnota's name card left/right
    cardOffsetY: 10, // Change this to move Purnota's name card up/down
  },
  {
    id: 'farhana',
    name: 'FARHANA FERDOUS',
    designation: 'RESEARCHER',
    img: '/img/TeamPhoto/Farhana.jpg',
    accent: '#0ea5e9',
    layoutPosition: 'top-right',
    scaleMultiplier: 1.3,
    offsetX: 0,
    offsetY: 0,
    cardOffsetX: 30,
    cardOffsetY: 10,
  },
  {
    id: 'ivan',
    name: 'YEAD MUHAMMAD IVAN',
    designation: 'DEVELOPER',
    img: '/img/TeamPhoto/Ivan.jpg',
    accent: '#ec4899',
    layoutPosition: 'bot-left',
    scaleMultiplier: 1.3,
    offsetX: 0,
    offsetY: 35,
    cardOffsetX: -30,
    cardOffsetY: 10,
  },
  {
    id: 'redwan',
    name: 'REDWAN RAHMAN',
    designation: 'DEVELOPER',
    img: '/img/TeamPhoto/Redwan.jpg',
    accent: '#a855f7',
    layoutPosition: 'bot-right',
    scaleMultiplier: 1.3,
    offsetX: 0,
    offsetY: 35,
    cardOffsetX: 30,
    cardOffsetY: 10,
  },
]

export function TeamScreen() {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})

  const toggleReveal = (index: number) => {
    if (!revealed[index]) {
      sfx.success()
      setRevealed((prev) => ({ ...prev, [index]: true }))
    } else {
      sfx.click()
      setRevealed((prev) => ({ ...prev, [index]: false }))
    }
  }

  return (
    <div className="w-screen h-screen bg-slate-950 overflow-hidden fixed inset-0 flex items-center justify-center select-none">
      {/* Static Poster Canvas Wrapper (1440x900 base resolution scales automatically with zero scrollbars) */}
      <ScaleContainer width={1440} height={900}>
        <div className="screen team-screen poster-mode w-full h-full flex flex-col items-center justify-center relative">
          
          {/* HEADER */}
          <section className="poster-header mb-6">
            <h1 className="poster-title display tracking-widest text-6xl font-black text-amber-400">TEAM PLEIADES7</h1>
          </section>

          {/* POSTER GRID LAYOUT (2x2 Balanced Layout) */}
          <div className="team-poster-layout w-full max-w-6xl flex flex-col gap-16 items-center justify-center">
            
            {/* TOP ROW */}
            <div className="team-row flex justify-center gap-48 w-full">
              {TEAM_MEMBERS.slice(0, 2).map((member, index) => {
                const isRevealed = !!revealed[index]
                const scale = member.scaleMultiplier ?? 1.0
                const ox = member.offsetX ?? 0
                const oy = member.offsetY ?? 0
                const cx = member.cardOffsetX ?? 0
                const cy = member.cardOffsetY ?? 0

                return (
                  <div 
                    key={member.id} 
                    className={`mag-container pos-${member.layoutPosition} ${isRevealed ? 'revealed' : ''}`}
                    style={{ 
                      '--accent': member.accent, 
                      animationDelay: `${index * 80}ms`,
                      transform: `scale(${scale}) translate(${ox}px, ${oy}px)`,
                      transformOrigin: 'center center'
                    } as any}
                  >
                    <div className="mag-glass-wrapper cursor-pointer" onClick={() => toggleReveal(index)}>
                      <div className="mag-lens">
                        <img src={member.img} alt={member.name} className={`mag-photo ${isRevealed ? 'clear' : 'foggy'}`} />
                        <div className={`mag-fog ${isRevealed ? 'dispelled' : ''}`}>
                          <div className="fog-layer-1" />
                          <div className="fog-layer-2" />
                        </div>
                        <div className="mag-glass-sheen" />
                      </div>
                      <div className="mag-handle-ref" />
                    </div>

                    {/* NAME TAG WITH INDEPENDENT OFFSET CONTROLS */}
                    <div 
                      className={`mag-info-card ${isRevealed ? 'show' : ''}`}
                      style={{
                        transform: `translate(${cx}px, ${cy}px)`,
                        transition: 'transform 0.1s ease-out'
                      }}
                    >
                      <div className="mag-details panel">
                        <h3 className="display member-name">{member.name}</h3>
                        <div className="mag-designation mono" style={{ color: member.accent }}>{member.designation}</div>
                      </div>
                      {member.layoutPosition === 'top-left' ? (
                        <div className="side-connector left">
                          <div className="arm-h" style={{ background: member.accent }} />
                          <div className="arm-diag" style={{ background: member.accent }}>
                            <span className="dot-node" style={{ background: member.accent, boxShadow: `0 0 10px ${member.accent}` }} />
                          </div>
                        </div>
                      ) : (
                        <div className="side-connector right">
                          <div className="arm-h" style={{ background: member.accent }} />
                          <div className="arm-diag" style={{ background: member.accent }}>
                            <span className="dot-node" style={{ background: member.accent, boxShadow: `0 0 10px ${member.accent}` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* BOTTOM ROW */}
            <div className="team-row flex justify-center gap-48 w-full">
              {TEAM_MEMBERS.slice(2, 4).map((member, index) => {
                const actualIndex = index + 2
                const isRevealed = !!revealed[actualIndex]
                const scale = member.scaleMultiplier ?? 1.0
                const ox = member.offsetX ?? 0
                const oy = member.offsetY ?? 0
                const cx = member.cardOffsetX ?? 0
                const cy = member.cardOffsetY ?? 0

                return (
                  <div 
                    key={member.id} 
                    className={`mag-container pos-${member.layoutPosition} ${isRevealed ? 'revealed' : ''}`}
                    style={{ 
                      '--accent': member.accent, 
                      animationDelay: `${actualIndex * 80}ms`,
                      transform: `scale(${scale}) translate(${ox}px, ${oy}px)`,
                      transformOrigin: 'center center'
                    } as any}
                  >
                    <div className="mag-glass-wrapper cursor-pointer" onClick={() => toggleReveal(actualIndex)}>
                      <div className="mag-lens">
                        <img src={member.img} alt={member.name} className={`mag-photo ${isRevealed ? 'clear' : 'foggy'}`} />
                        <div className={`mag-fog ${isRevealed ? 'dispelled' : ''}`}>
                          <div className="fog-layer-1" />
                          <div className="fog-layer-2" />
                        </div>
                        <div className="mag-glass-sheen" />
                      </div>
                      <div className="mag-handle-ref" />
                    </div>

                    {/* NAME TAG WITH INDEPENDENT OFFSET CONTROLS */}
                    <div 
                      className={`mag-info-card ${isRevealed ? 'show' : ''}`}
                      style={{
                        transform: `translate(${cx}px, ${cy}px)`,
                        transition: 'transform 0.1s ease-out'
                      }}
                    >
                      <div className="mag-details panel">
                        <h3 className="display member-name">{member.name}</h3>
                        <div className="mag-designation mono" style={{ color: member.accent }}>{member.designation}</div>
                      </div>
                      {member.layoutPosition === 'bot-left' ? (
                        <div className="side-connector left">
                          <div className="arm-h" style={{ background: member.accent }} />
                          <div className="arm-diag" style={{ background: member.accent }}>
                            <span className="dot-node" style={{ background: member.accent, boxShadow: `0 0 10px ${member.accent}` }} />
                          </div>
                        </div>
                      ) : (
                        <div className="side-connector right">
                          <div className="arm-h" style={{ background: member.accent }} />
                          <div className="arm-diag" style={{ background: member.accent }}>
                            <span className="dot-node" style={{ background: member.accent, boxShadow: `0 0 10px ${member.accent}` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

          </div>
        </div>
      </ScaleContainer>
    </div>
  )
}