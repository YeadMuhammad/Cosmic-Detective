import { useState } from 'react'
import { useGame } from '../lib/store'
import { useAuth } from '../lib/auth'
import { backendReady } from '../lib/supabase'
import { navigate } from '../lib/util'
import { sfx } from '../lib/sfx'
import '../squad.css'

/** Log in / create account box for the title screen. Renders nothing until .env.local is set up. */
export function AuthPanel() {
  const { s, set } = useGame()
  const { ready, username, signIn, signUp, signOut } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (!backendReady) return null
  if (!ready) return <div className="auth-box soft">Checking your badge…</div>

  // Same hand-off the guest button uses: first-timers get the tutorial, everyone else the case board.
  const go = (tutorialDone: boolean) => {
    set((p) => ({ ...p, tutorial: tutorialDone ? null : 1 }))
    navigate(tutorialDone ? '/map' : '/case/1')
  }

  if (username) {
    return (
      <div className="auth-box">
        <div className="mono kicker">SIGNED IN</div>
        <div className="auth-row">
          <strong className="display auth-name">{username}</strong>
          <button className="btn btn-primary big" onClick={() => { sfx.success(); go(s.tutorialDone) }}><span>Continue Investigation</span></button>
          <button className="link-btn" onClick={() => { sfx.click(); void signOut() }}>Log out</button>
        </div>
      </div>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const done = mode === 'register' ? await signUp(name, pw) : await signIn(name, pw)
      sfx.success(); go(done)
    } catch (ex) { sfx.reject(); setErr((ex as Error).message) } finally { setBusy(false) }
  }

  return (
    <form className="auth-box" onSubmit={submit}>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setErr('') }}>Log in</button>
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setErr('') }}>Create account</button>
      </div>
      <div className="auth-fields">
        <label>Username<input value={name} maxLength={20} autoComplete="username" onChange={(e) => setName(e.target.value)} required /></label>
        <label>Password<input type="password" value={pw} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} onChange={(e) => setPw(e.target.value)} required /></label>
        <button className="btn btn-primary big" disabled={busy}><span>{busy ? 'One moment…' : mode === 'register' ? 'Create account' : 'Log in'}</span></button>
      </div>
      {mode === 'register' && <p className="soft">3 to 20 characters: letters, numbers, _ and . Your progress is saved to this account and follows you to any device.</p>}
      {err && <div className="field-err">{err}</div>}
    </form>
  )
}
