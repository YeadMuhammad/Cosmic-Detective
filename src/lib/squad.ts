import { supabase } from './supabase'

export type JobStatus = 'assigned' | 'submitted' | 'sent_back' | 'verified' | 'reported'

/** The archive results currently on screen in the portal. */
export interface FieldData { ra: number; dec: number; fov: number; bands: string[]; frames: any[] }

export interface Member { user_id: string; role: 'leader' | 'member'; username: string; tiles: number }
export interface SquadInfo { id: string; name: string; join_code: string; leader_id: string; myRole: 'leader' | 'member'; members: Member[] }
export interface JobRow {
  id: string; assigned_to: string; ra: number; dec: number; fov: number; bands: string[]; instructions: string
  status: JobStatus; finding: string | null; notes: string | null; leader_note: string | null
  created_at: string; submitted_at: string | null; verified_at: string | null; reported_at: string | null
}
export interface ReportRow { id: string; ref: string; summary: string; job_count: number; filed_at: string }

export const FINDINGS: [string, string][] = [
  ['no_anomaly', 'No anomaly noted'],
  ['variable_source', 'Possible variable source'],
  ['moving_source', 'Possible moving source'],
  ['data_quality', 'Data-quality problem'],
]
export const findingLabel = (k: string | null) => FINDINGS.find(([v]) => v === k)?.[1] ?? '—'

const one = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x)

async function rpc(fn: string, args?: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

export async function getMySquad(uid: string): Promise<SquadInfo | null> {
  const mine = await supabase.from('squad_members').select('role, squads(id, name, join_code, leader_id)').eq('user_id', uid).maybeSingle()
  if (mine.error) throw new Error(mine.error.message)
  if (!mine.data) return null
  const sq = one(mine.data.squads as any) as { id: string; name: string; join_code: string; leader_id: string }
  const roster = await supabase.from('squad_members').select('user_id, role, profiles(username, tiles)').eq('squad_id', sq.id)
  if (roster.error) throw new Error(roster.error.message)
  const members: Member[] = (roster.data ?? []).map((r: any) => {
    const p = one(r.profiles) as { username: string; tiles: number } | null
    return { user_id: r.user_id, role: r.role, username: p?.username ?? 'unknown', tiles: p?.tiles ?? 0 }
  }).sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === 'leader' ? -1 : 1))
  return { ...sq, myRole: mine.data.role as 'leader' | 'member', members }
}

export async function getJobs(squadId: string): Promise<JobRow[]> {
  // "frames" is left out of the list on purpose: it can be large. getJobFrames() loads it on demand.
  const { data, error } = await supabase.from('jobs')
    .select('id, assigned_to, ra, dec, fov, bands, instructions, status, finding, notes, leader_note, created_at, submitted_at, verified_at, reported_at')
    .eq('squad_id', squadId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as JobRow[]
}
export async function getJobFrames(jobId: string): Promise<any[]> {
  const { data, error } = await supabase.from('jobs').select('frames').eq('id', jobId).single()
  if (error) throw new Error(error.message)
  return (data?.frames ?? []) as any[]
}
export async function getReports(squadId: string): Promise<ReportRow[]> {
  const { data, error } = await supabase.from('nasa_reports').select('id, ref, summary, job_count, filed_at').eq('squad_id', squadId).order('filed_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ReportRow[]
}

export const createSquad = (name: string) => rpc('create_squad', { p_name: name })
export const joinSquad = (code: string) => rpc('join_squad', { p_code: code })
export const leaveSquad = () => rpc('leave_squad')
export const disbandSquad = () => rpc('disband_squad')
export const assignJobs = (squad: string, f: FieldData, instructions: string, items: { user_id: string; bands: string[]; frames: any[] }[]) =>
  rpc('assign_jobs', { p_squad: squad, p_ra: f.ra, p_dec: f.dec, p_fov: f.fov, p_instructions: instructions, p_items: items })
export const submitJob = (job: string, finding: string, notes: string) => rpc('submit_job', { p_job: job, p_finding: finding, p_notes: notes })
export const reviewJob = (job: string, approve: boolean, note: string) => rpc('review_job', { p_job: job, p_approve: approve, p_note: note })
export const reportToNasa = (squad: string, jobIds: string[], summary: string) => rpc('report_to_nasa', { p_squad: squad, p_job_ids: jobIds, p_summary: summary }) as Promise<string>
