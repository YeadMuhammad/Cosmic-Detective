import { useState } from 'react'
import { GUIDE } from '../data/fixtures'
import { cdn } from '../lib/util'
import { sfx } from '../lib/sfx'

interface TeamMember {
  name: string
  designation: string
  img: string
  accent: string
  layoutPosition: 'top-left' | 'top-mid' | 'top-right' | 'bot-left' | 'bot-right'
}

const TEAM_MEMBERS: TeamMember[] = [
  { name: 'ASHRATUL ZANNATI PURNOTA', designation: 'TEAM LEADER', img: '/img/TeamPhoto/Purnota.jpg', accent: '#fbbf24', layoutPosition: 'top-left' },
  { name: 'FARHANA FERDOUS', designation: 'RESEARCHER', img: '/img/TeamPhoto/Farhana.jpg', accent: '#0ea5e9', layoutPosition: 'top-mid' },
  { name: 'RADIT RAIAN', designation: 'RESEARCHER', img: '/img/TeamPhoto/Radit.jpg', accent: '#0ea5e9', layoutPosition: 'top-right' },
  { name: 'YEAD MUHAMMAD IVAN', designation: 'DEVELOPER', img: '/img/TeamPhoto/Ivan.jpg', accent: '#ec4899', layoutPosition: 'bot-left' },
  { name: 'REDWAN RAHMAN', designation: 'DEVELOPER', img: '/img/TeamPhoto/Redwan.jpg', accent: '#ec4899', layoutPosition: 'bot-right' },
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
    <div className="screen team-screen poster-mode">
      <section className="poster-header">
        <h1 className="poster-title display">TEAM PLEIADES</h1>
      </section>

      <div className="team-poster-layout">
        <div className="team-row row-3">
          {TEAM_MEMBERS.slice(0, 3).map((member, index) => {
            const isRevealed = !!revealed[index]
            return (
              <div 
                key={member.name} 
                className={`mag-container pos-${member.layoutPosition} ${isRevealed ? 'revealed' : ''}`}
                style={{ ['--accent' as any]: member.accent, animationDelay: `${index * 80}ms` }}
              >
                <div className="mag-glass-wrapper" onClick={() => toggleReveal(index)}>
                  <div className="mag-lens">
                    <img src={cdn(member.img, 400)} alt={member.name} className={`mag-photo ${isRevealed ? 'clear' : 'foggy'}`} />
                    <div className={`mag-fog ${isRevealed ? 'dispelled' : ''}`}>
                      <div className="fog-layer-1" />
                      <div className="fog-layer-2" />
                    </div>
                    <div className="mag-glass-sheen" />
                  </div>
                  <div className="mag-handle-ref" />
                </div>

                <div className={`mag-info-card ${isRevealed ? 'show' : ''}`}>
                  <div className="mag-details panel">
                    <h3 className="display member-name">{member.name}</h3>
                    <div className="mag-designation mono" style={{ color: member.accent }}>{member.designation}</div>
                  </div>
                  {member.layoutPosition === 'top-mid' ? (
                    <div className="vert-connector">
                      <div className="v-line" style={{ background: member.accent }} />
                      <span className="dot-node" style={{ background: member.accent, boxShadow: `0 0 10px ${member.accent}` }} />
                    </div>
                  ) : member.layoutPosition === 'top-left' ? (
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

        <div className="team-row row-2">
          {TEAM_MEMBERS.slice(3, 5).map((member, index) => {
            const actualIndex = index + 3
            const isRevealed = !!revealed[actualIndex]
            return (
              <div 
                key={member.name} 
                className={`mag-container pos-${member.layoutPosition} ${isRevealed ? 'revealed' : ''}`}
                style={{ ['--accent' as any]: member.accent, animationDelay: `${actualIndex * 80}ms` }}
              >
                <div className="mag-glass-wrapper" onClick={() => toggleReveal(actualIndex)}>
                  <div className="mag-lens">
                    <img src={cdn(member.img, 400)} alt={member.name} className={`mag-photo ${isRevealed ? 'clear' : 'foggy'}`} />
                    <div className={`mag-fog ${isRevealed ? 'dispelled' : ''}`}>
                      <div className="fog-layer-1" />
                      <div className="fog-layer-2" />
                    </div>
                    <div className="mag-glass-sheen" />
                  </div>
                  <div className="mag-handle-ref" />
                </div>

                <div className={`mag-info-card ${isRevealed ? 'show' : ''}`}>
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
  )
}