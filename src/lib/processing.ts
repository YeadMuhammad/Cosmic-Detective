/**
 * App-side view of SPHEREx processing orchestration (thin — the orchestration
 * logic lives in netlify/lib/processing.mjs and the worker; nothing here
 * rebuilds cache keys or states). Job responses from /.netlify/functions/
 * spherex-job already carry capability records; this module only narrows,
 * renames and displays them, and never mints 'available' on its own.
 */
import type { Capability } from './spherex'

export type ProcessingProduct = 'cutout-render' | 'photometry' | 'blink-pair' | 'band-composite'

export interface ProcessingCapabilityRecord {
  state: 'available' | 'unavailable' | 'computing'
  reason: string
  jobId?: string
  resultPath?: string
  resultUrl?: string
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
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product, ...input }),
    })
  } catch {
    return {
      state: 'unavailable',
      reason: import.meta.env.DEV
        ? 'Could not reach the local processing endpoint. If you started with `npm run dev`, use `netlify dev` because plain Vite does not run Netlify Functions.'
        : 'Could not contact the Netlify processing function. Check the function deployment and network connection.',
    }
  }
  const body = (await response.json().catch(() => null)) as Partial<ProcessingCapabilityRecord> | null
  if (!body || (body.state !== 'available' && body.state !== 'computing' && body.state !== 'unavailable')) {
    return {
      state: 'unavailable',
      reason: import.meta.env.DEV
        ? `The local endpoint returned no valid function response (HTTP ${response.status}). If you started with 'npm run dev', use 'netlify dev'; plain Vite does not run Netlify Functions.`
        : `The Netlify processing function returned an invalid response (HTTP ${response.status}). Check the function logs and deployment configuration.`,
    }
  }
  return { ...ORCHESTRATION_UNAVAILABLE, ...body }
}
