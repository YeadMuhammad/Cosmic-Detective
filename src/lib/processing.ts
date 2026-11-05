/**
 * App-side view of SPHEREx processing orchestration (thin — the orchestration
 * logic lives in netlify/lib/processing.mjs and the worker; nothing here
 * rebuilds cache keys or states). Job responses from /.netlify/functions/
 * spherex-job already carry capability records; this module only narrows,
 * renames and displays them, and never mints 'available' on its own.
 */
import type { Capability } from './spherex'

export type ProcessingProduct = 'cutout-render' | 'photometry'

export interface ProcessingCapabilityRecord {
  state: 'available' | 'unavailable' | 'computing'
  reason: string
  jobId?: string
  resultPath?: string
  cacheKey?: string
}

/** Unknown / failed fetches must surface as 'unavailable', never as a guess. */
export const ORCHESTRATION_UNAVAILABLE: ProcessingCapabilityRecord = {
  state: 'unavailable',
  reason: 'The processing orchestration could not be reached.',
}

export function capabilityFromJob(record: Partial<ProcessingCapabilityRecord> | null): Capability {
  const state = record?.state === 'available' || record?.state === 'computing' ? record.state : 'unavailable'
  return { state, reason: record?.reason || ORCHESTRATION_UNAVAILABLE.reason }
}

export async function requestProcessing(product: ProcessingProduct, input: {
  collection: string
  obsId: string
  detector: string
  release: string
  ra: number
  dec: number
  sizeDeg: number
  cutoutUrl: string
  params?: Record<string, string | number | boolean>
}, endpoint = '/.netlify/functions/spherex-job'): Promise<ProcessingCapabilityRecord> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product, ...input }),
  })
  const body = (await response.json().catch(() => null)) as Partial<ProcessingCapabilityRecord> | null
  if (!body || (body.state !== 'available' && body.state !== 'computing' && body.state !== 'unavailable')) {
    return ORCHESTRATION_UNAVAILABLE
  }
  return { ...ORCHESTRATION_UNAVAILABLE, ...body }
}
