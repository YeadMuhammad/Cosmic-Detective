import { FRESH, useGame } from '../lib/store'
import { navigate } from '../lib/util'
import { Btn, DisplayToggles } from '../components/ui'

export function Settings() {
  const { s, set } = useGame()
  return (
    <div className="screen settings">
      <div className="mono kicker">SETTINGS</div>
      <h1 className="display">Field kit</h1>
      <div className="settings-list">
        <div className="set-row">
          <div><strong>Display mode</strong><p>Dark is the default. Colour-blind safe mode swaps every meaningful colour for the Okabe–Ito palette. Presentation only, never game logic.</p></div>
          <DisplayToggles />
        </div>
        <div className="set-row">
          <div><strong>Sound effects</strong><p>Synthesised interface sounds for blinks, flags and verification results.</p></div>
          <button className={`switch ${s.sound ? 'on' : ''}`} role="switch" aria-checked={s.sound} onClick={() => set((p) => ({ ...p, sound: !p.sound }))}><span /></button>
        </div>
        <div className="set-row">
          <div><strong>Replay the guided tutorial</strong><p>Dr. Varga walks you through Case 001 again, one control at a time.</p></div>
          <Btn variant="ghost" onClick={() => { set((p) => ({ ...p, tutorial: 1, started: true })); navigate('/case/1') }}>Replay</Btn>
        </div>
        <div className="set-row">
          <div><strong>Presenter controls</strong><p>A floating panel for live demos: load a pre-played save, jump ranks, unlock chapters. Shortcut: Shift+P.</p></div>
          <button className={`switch ${s.presenter ? 'on' : ''}`} role="switch" aria-checked={s.presenter} onClick={() => set((p) => ({ ...p, presenter: !p.presenter }))}><span /></button>
        </div>
        <div className="set-row danger">
          <div><strong>Reset progress</strong><p>Clears rank, experience, badges and case history on this device.</p></div>
          <Btn variant="danger" onClick={() => { if (confirm('Reset all progress on this device?')) { set((p) => ({ ...FRESH, theme: p.theme, colorblind: p.colorblind, presenter: p.presenter })); navigate('/') } }}>Reset</Btn>
        </div>
      </div>
    </div>
  )
}
