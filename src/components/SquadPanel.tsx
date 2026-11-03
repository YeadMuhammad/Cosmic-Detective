import { useCallback, useEffect, useMemo, useState } from 'react'
import { LEAD_RANK, rankFor } from '../data/fixtures'
import { useGame } from '../lib/store'
import { useAuth } from '../lib/auth'
import { backendReady } from '../lib/supabase'
import {
  FINDINGS, findingLabel, assignJobs, createSquad, disbandSquad, getJobFrames, getJobs, getMySquad, getReports,
  joinSquad, leaveSquad, reportToNasa, reviewJob, submitJob,
  type FieldData, type JobRow, type ReportRow, type SquadInfo,
} from '../lib/squad'
import { Btn } from './ui'
import '../squad.css'

const STATUS: Record<string, string> = {
  assigned: 'Waiting for the analyst', submitted: 'Waiting for leader review', sent_back: 'Sent back for changes',
  verified: 'Verified by leader', reported: 'Filed to simulated NASA intake',
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '')

interface Props {
  /** what the portal is showing right now (used when the leader assigns data) */
  field: FieldData
  /** called when someone opens an assignment's data inside the portal */
  onOpenJob: (f: FieldData) => void
}

export function SquadPanel({ field, onOpenJob }: Props) {
  const { s } = useGame()
  const { ready, userId, username, syncNow } = useAuth()
  const rank = rankFor(s.tiles)
  const [squad, setSquad] = useState<SquadInfo | null | undefined>(undefined) // undefined = still loading
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [reports, setReports] = useState<ReportRow[]>([])
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!userId) return
    const sq = await getMySquad(userId)
    setSquad(sq)
    if (sq) { const [j, r] = await Promise.all([getJobs(sq.id), getReports(sq.id)]); setJobs(j); setReports(r) } else { setJobs([]); setReports([]) }
  }, [userId])

  useEffect(() => { setSquad(undefined); refresh().catch((e) => { setSquad(null); setMsg({ text: (e as Error).message, ok: false }) }) }, [refresh])

  /** Runs an action, shows any error in plain words, then reloads the squad. */
  const run = async (fn: () => Promise<unknown>, okText?: string) => {
    setBusy(true); setMsg(null)
    try { await fn(); if (okText) setMsg({ text: okText, ok: true }); await refresh() }
    catch (e) { setMsg({ text: (e as Error).message, ok: false }) }
    finally { setBusy(false) }
  }

  const nameOf = useMemo(() => Object.fromEntries((squad?.members ?? []).map((m) => [m.user_id, m.username])), [squad])

  const openJob = (j: JobRow) => run(async () => {
    const frames = await getJobFrames(j.id)
    onOpenJob({ ra: j.ra, dec: j.dec, fov: j.fov, bands: j.bands, frames })
  })

  // ------------------------------------------------------------ states with no squad
  if (!backendReady) return <section className="sq-panel"><p className="sq-empty">Online squads are switched off: this copy of the game has no backend configured yet.</p></section>
  if (!ready || (userId && squad === undefined)) return <section className="sq-panel"><p className="sq-empty">Loading your squad…</p></section>
  if (!userId) {
    return (
      <section className="sq-panel">
        <div className="mono kicker">RESEARCH SQUADS</div>
        <p className="sq-empty">Log in from the title screen to create or join a squad. Guests can still explore the archive.</p>
      </section>
    )
  }
  if (!squad) return <NoSquad rank={rank.n} busy={busy} msg={msg} run={run} syncNow={syncNow} />

  // ------------------------------------------------------------ in a squad
  const isLeader = squad.myRole === 'leader'
  const myJobs = jobs.filter((j) => j.assigned_to === userId)
  const toReview = jobs.filter((j) => j.status === 'submitted')
  const verified = jobs.filter((j) => j.status === 'verified')

  return (
    <section className="sq-panel" aria-label="Research squad">
      <div className="sq-head">
        <div>
          <div className="mono kicker">{isLeader ? 'YOU LEAD THIS SQUAD' : 'YOUR SQUAD'}</div>
          <h2 className="display">{squad.name}</h2>
        </div>
        {isLeader && <div><div className="soft">Share this join code with lower-ranked players</div><div className="sq-code mono">{squad.join_code}</div></div>}
        <div className="sq-actions">
          <Btn variant="ghost" disabled={busy} onClick={() => run(refresh, 'Squad refreshed.')}>Refresh</Btn>
          {isLeader
            ? <Btn variant="danger" disabled={busy} onClick={() => { if (window.confirm('Disband the squad? All its jobs and reports are deleted.')) void run(disbandSquad) }}>Disband squad</Btn>
            : <Btn variant="ghost" disabled={busy} onClick={() => { if (window.confirm('Leave this squad?')) void run(leaveSquad) }}>Leave squad</Btn>}
        </div>
      </div>
      {msg && <div className={`sq-msg ${msg.ok ? 'ok' : ''}`} role="status">{msg.text}</div>}

      <div className="sq-grid">
        <div className="sq-block">
          <h3>Roster</h3>
          <table className="sq-table">
            <thead><tr><th>Player</th><th>Rank</th><th>Verified jobs</th></tr></thead>
            <tbody>{squad.members.map((m) => {
              const mine = jobs.filter((j) => j.assigned_to === m.user_id)
              const done = mine.filter((j) => j.status === 'verified' || j.status === 'reported').length
              return <tr key={m.user_id}><td>{m.username}{m.role === 'leader' && ' ★'}</td><td>{rankFor(m.tiles).title}</td>
                <td>{m.role === 'leader' ? '—' : isLeader || m.user_id === userId ? `${done} of ${mine.length}` : '·'}</td></tr>
            })}</tbody>
          </table>
        </div>

        {isLeader && <AssignForm squad={squad} field={field} busy={busy} run={run} />}
      </div>

      {!isLeader && (
        <div className="sq-block">
          <h3>My assignments</h3>
          <p className="soft">Take your time. Open the data, look through it, then file your findings. Jobs can be done any time.</p>
          <div className="sq-jobs">
            {myJobs.length === 0 && <p className="sq-empty">Nothing assigned yet. Your leader will send data from the archive.</p>}
            {myJobs.map((j) => <MemberJob key={j.id} job={j} busy={busy} onOpen={() => openJob(j)} onSubmit={(f, n) => run(() => submitJob(j.id, f, n), 'Report sent to your leader.')} />)}
          </div>
        </div>
      )}

      {isLeader && (
        <div className="sq-block">
          <h3>Jobs {toReview.length > 0 && <span className="sq-chip" style={{ color: 'var(--pending)' }}>{toReview.length} waiting for you</span>}</h3>
          <div className="sq-jobs">
            {jobs.length === 0 && <p className="sq-empty">No jobs yet. Fetch data above, pick your analysts, and assign it.</p>}
            {jobs.map((j) => <LeaderJob key={j.id} job={j} who={nameOf[j.assigned_to] ?? 'unknown'} busy={busy} onOpen={() => openJob(j)} onReview={(ok, note) => run(() => reviewJob(j.id, ok, note), ok ? 'Job verified.' : 'Sent back to the analyst.')} />)}
          </div>
        </div>
      )}

      {isLeader && <ReportForm squadId={squad.id} verified={verified} nameOf={nameOf} busy={busy} run={run} />}

      <div className="sq-block">
        <h3>Simulated NASA intake</h3>
        <p className="sq-sim">Training sandbox. Reports stay inside Cosmic Detective and are never sent to NASA or any real observatory. They are candidate observations, not confirmed discoveries.</p>
        {reports.length === 0 ? <p className="sq-empty">No reports filed yet.</p> : (
          <table className="sq-table"><thead><tr><th>Reference</th><th>Jobs</th><th>Filed</th><th>Summary</th></tr></thead>
            <tbody>{reports.map((r) => <tr key={r.id}><td className="mono">{r.ref}</td><td>{r.job_count}</td><td>{when(r.filed_at)}</td><td>{r.summary}</td></tr>)}</tbody></table>
        )}
      </div>
      <p className="soft">Signed in as {username}.</p>
    </section>
  )
}

// ================================================================ pieces

type Run = (fn: () => Promise<unknown>, okText?: string) => Promise<void>

function NoSquad({ rank, busy, msg, run, syncNow }: { rank: number; busy: boolean; msg: { text: string; ok: boolean } | null; run: Run; syncNow: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const canLead = rank >= LEAD_RANK
  return (
    <section className="sq-panel">
      <div className="mono kicker">RESEARCH SQUADS</div>
      {canLead ? (
        <form className="sq-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await syncNow(); await createSquad(name) }) }}>
          <h3>Start your own squad</h3>
          <p className="soft">You hold the top rank, so you choose the coordinates. You assign archive data to your analysts and sign off on what they report.</p>
          <label>Squad name<input type="text" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} required /></label>
          <div><Btn disabled={busy}>Create squad</Btn></div>
        </form>
      ) : (
        <form className="sq-form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await syncNow(); await joinSquad(code) }) }}>
          <h3>Join a squad</h3>
          <p className="soft">Ask a squad leader (Rank {LEAD_RANK}) for their 6-character join code. Squad leaders pick the data you work on; until you reach Rank {LEAD_RANK} your portal fields are random.</p>
          <label>Join code<input type="text" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase())} required /></label>
          <div><Btn disabled={busy}>Join squad</Btn></div>
        </form>
      )}
      {msg && <div className={`sq-msg ${msg.ok ? 'ok' : ''}`} role="status">{msg.text}</div>}
    </section>
  )
}

function AssignForm({ squad, field, busy, run }: { squad: SquadInfo; field: FieldData; busy: boolean; run: Run }) {
  const analysts = squad.members.filter((m) => m.role === 'member')
  const [pick, setPick] = useState<string[]>([])
  const [split, setSplit] = useState(false)
  const [note, setNote] = useState('')
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const assign = () => run(async () => {
    const chosen = analysts.filter((m) => pick.includes(m.user_id))
    if (!field.frames.length) throw new Error('Fetch live SPHEREx data in the portal above first. Assignments carry the results that are on screen.')
    if (!chosen.length) throw new Error('Pick at least one analyst.')
    const items = chosen.map((m, i) => {
      const frames = split ? field.frames.filter((_, k) => k % chosen.length === i) : field.frames
      return { user_id: m.user_id, frames, bands: [...new Set(frames.map((f: any) => f.band as string))] }
    })
    if (items.some((it) => !it.frames.length)) throw new Error('Not enough observations to split between that many analysts.')
    await assignJobs(squad.id, field, note, items)
    setPick([]); setNote('')
  }, 'Data assigned. Your analysts will see it in their squad panel.')

  return (
    <div className="sq-block">
      <h3>Assign the data on screen</h3>
      <p className="soft">{field.frames.length
        ? `${field.frames.length} observation${field.frames.length === 1 ? '' : 's'} at RA ${field.ra}, Dec ${field.dec} are ready to assign.`
        : 'Search the archive above, then come back here to hand the results to your team.'}</p>
      {analysts.length === 0 && <p className="sq-empty">No analysts yet. Share your join code.</p>}
      {analysts.map((m) => (
        <label key={m.user_id} className="sq-check"><input type="checkbox" checked={pick.includes(m.user_id)} onChange={() => toggle(m.user_id)} />{m.username} <small className="soft">{rankFor(m.tiles).title}</small></label>
      ))}
      <label className="sq-check"><input type="checkbox" checked={split} onChange={() => setSplit(!split)} />Split the observations between analysts (otherwise everyone gets all of them)</label>
      <label>Instructions (optional)<textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Compare D3 and D4 for any source that changes brightness." /></label>
      <div><Btn disabled={busy || !analysts.length} onClick={assign}>Assign to team</Btn></div>
    </div>
  )
}

function MemberJob({ job, busy, onOpen, onSubmit }: { job: JobRow; busy: boolean; onOpen: () => void; onSubmit: (finding: string, notes: string) => void }) {
  const [finding, setFinding] = useState(job.finding ?? FINDINGS[0][0])
  const [notes, setNotes] = useState(job.notes ?? '')
  const editable = job.status === 'assigned' || job.status === 'sent_back'
  return (
    <article className="sq-job" data-status={job.status}>
      <div className="sq-job-top"><strong className="mono">RA {job.ra.toFixed(4)} · Dec {job.dec.toFixed(4)}</strong><span className="sq-chip">{STATUS[job.status]}</span></div>
      {job.instructions && <p className="soft">Leader’s instructions: {job.instructions}</p>}
      {job.leader_note && <p className="soft">Leader’s note: {job.leader_note}</p>}
      <div className="sq-actions"><Btn variant="ghost" disabled={busy} onClick={onOpen}>Open data in portal</Btn></div>
      {editable ? (
        <div className="sq-form">
          <label>What did you find?<select value={finding} onChange={(e) => setFinding(e.target.value)}>{FINDINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>Notes for your leader<textarea value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder="Which observations and bands did you check, and what stood out?" /></label>
          <div><Btn disabled={busy} onClick={() => onSubmit(finding, notes)}>Send report to leader</Btn></div>
        </div>
      ) : <p className="soft">Your finding: {findingLabel(job.finding)}. {job.notes}</p>}
    </article>
  )
}

function LeaderJob({ job, who, busy, onOpen, onReview }: { job: JobRow; who: string; busy: boolean; onOpen: () => void; onReview: (approve: boolean, note: string) => void }) {
  const [note, setNote] = useState('')
  return (
    <article className="sq-job" data-status={job.status}>
      <div className="sq-job-top"><strong>{who}</strong><span className="sq-chip">{STATUS[job.status]}</span></div>
      <span className="soft mono">RA {job.ra.toFixed(4)} · Dec {job.dec.toFixed(4)} · assigned {when(job.created_at)}</span>
      {job.status !== 'assigned' && <p className="soft"><b>{findingLabel(job.finding)}.</b> {job.notes}</p>}
      <div className="sq-actions"><Btn variant="ghost" disabled={busy} onClick={onOpen}>View data</Btn></div>
      {job.status === 'submitted' && (
        <div className="sq-form">
          <label>Your note to the analyst (optional)<input type="text" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="sq-actions">
            <Btn variant="ok" disabled={busy} onClick={() => onReview(true, note)}>Verify</Btn>
            <Btn variant="danger" disabled={busy} onClick={() => onReview(false, note)}>Send back</Btn>
          </div>
        </div>
      )}
    </article>
  )
}

function ReportForm({ squadId, verified, nameOf, busy, run }: { squadId: string; verified: JobRow[]; nameOf: Record<string, string>; busy: boolean; run: Run }) {
  const [pick, setPick] = useState<string[]>([])
  const [summary, setSummary] = useState('')
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  return (
    <div className="sq-block">
      <h3>Report verified work</h3>
      {verified.length === 0 ? <p className="sq-empty">Jobs you verify appear here, ready to be filed.</p> : (
        <div className="sq-form">
          {verified.map((j) => (
            <label key={j.id} className="sq-check"><input type="checkbox" checked={pick.includes(j.id)} onChange={() => toggle(j.id)} />
              {nameOf[j.assigned_to] ?? 'unknown'} · {findingLabel(j.finding)} · RA {j.ra.toFixed(3)}, Dec {j.dec.toFixed(3)}</label>
          ))}
          <label>Cover summary<textarea value={summary} maxLength={2000} onChange={(e) => setSummary(e.target.value)} placeholder="One or two sentences on what this batch shows." /></label>
          <div><Btn disabled={busy || !pick.length} onClick={() => run(async () => { const ref = await reportToNasa(squadId, pick, summary); setPick([]); setSummary(''); return ref }, 'Filed to the simulated NASA intake.')}>File report</Btn></div>
        </div>
      )}
    </div>
  )
}
