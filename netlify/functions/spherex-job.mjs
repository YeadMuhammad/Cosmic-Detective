/**
 * SPHEREx processing orchestration (PLAN.md item 2: 'Worker, jobs, and cache').
 *
 * This function NEVER processes FITS. It orchestrates:
 *   POST /            create a processing job for a cutout/photometry request
 *                     (rated-limited per client, cache-key deduplicated) and
 *                     answer with the capability record 'computing';
 *   GET ?cacheKey=…   current capability record for one product input set
 *                     ('computing' | 'available' | 'unavailable' + reason);
 *   GET ?jobId=…      same, addressed by job id.
 *
 * The Python worker (worker/spherex_worker.py, deployed near IRSA) claims jobs
 * through Postgres (for update skip locked), verifies cutout support with a
 * bounded GET, processes with astropy/photutils/reproject and uploads products
 * to the spherex-products bucket under the SAME versioned cache keys built in
 * netlify/lib/processing.mjs (locked to worker/cache_key_cases.json).
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *      RATE_LIMIT_SALT (optional; extra salt for the per-client key hash).
 */

import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { assertGoldenCacheKeys, capabilityForJob, cacheKey, rateLimitDecision, RATE_LIMIT } from '../lib/processing.mjs'

const PRODUCTS = new Set(['cutout-render', 'photometry', 'blink-pair', 'band-composite'])
const DETECTOR_RE = /^D[1-6]$/
const COLLECTION_RE = /^qr\d+$/
const RELEASE_RE = /^l2[a-z]\d*-[A-Za-z0-9.-]+$/
const OBS_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const DAY_MS = 86_400_000

let goldenCount = 0
let driftError = null
try {
  goldenCount = assertGoldenCacheKeys()
} catch (error) {
  driftError = error
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

function fail(message, status = 400) {
  return json({ state: 'unavailable', reason: message }, status)
}

/* Production server keys are fine after cold start; no per-request rebuild. */
function clientKeyHash(request, salt) {
  const ip = request.headers.get('x-nf-client-connection-ip')
    || request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
  return createDayHash(ip, salt)
}

function createDayHash(value, salt) {
  const day = new Date().toISOString().slice(0, 10)
  return createHash('sha256').update(`${value}|${day}|${salt}`).digest('hex')
}

function validation(requestBody) {
  const body = requestBody && typeof requestBody === 'object' ? requestBody : null
  if (!body) return 'Request body must be a JSON processing request.'
  const { product, collection, obsId, detector, release, ra, dec, sizeDeg, cutoutUrl } = body
  if (!PRODUCTS.has(product)) return `Unknown product ${String(product)}; expected one of ${[...PRODUCTS].join(', ')}.`
  if (!COLLECTION_RE.test(String(collection))) return 'collection must look like qr2 or qr3.'
  if (!OBS_ID_RE.test(String(obsId ?? ''))) return 'obsId is missing or unsafe.'
  if (!DETECTOR_RE.test(String(detector ?? ''))) return 'detector must be D1..D6.'
  if (!RELEASE_RE.test(String(release ?? ''))) return 'release must look like l2b-v20-2025-240.'
  if (typeof cutoutUrl !== 'string') return 'cutoutUrl must be an IRSA cutout URL.'
  if (!Number.isFinite(Number(ra)) || Number(ra) < 0 || Number(ra) > 360) return 'RA must be 0–360 degrees.'
  if (!Number.isFinite(Number(dec)) || Number(dec) < -90 || Number(dec) > 90) return 'Dec must be −90–90 degrees.'
  if (!Number.isFinite(Number(sizeDeg)) || Number(sizeDeg) <= 0 || Number(sizeDeg) > 0.5) return 'sizeDeg must be > 0 and at most 0.5 degrees.'
  if (body.params !== undefined && (typeof body.params !== 'object' || body.params === null || Array.isArray(body.params))) return 'params must be an object of strings/ints/bools.'
  const validateCutout = (value, expectedCollection, expectedObsId, expectedDetector, expectedRelease) => {
    let parsed
    try { parsed = new URL(value) } catch { return false }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'irsa.ipac.caltech.edu' || parsed.port || parsed.username || parsed.password || !parsed.pathname.startsWith('/ibe/data/spherex/')) return false
    const centerValues = parsed.searchParams.getAll('center')
    const sizeValues = parsed.searchParams.getAll('size')
    const center = centerValues.length === 1 && sizeValues.length === 1
      ? centerValues[0].match(/^\s*(-?\d+(?:\.\d+)?)d?\s*,\s*(-?\d+(?:\.\d+)?)d?\s*$/i)
      : null
    const size = Number(parsed.searchParams.get('size'))
    const expectedFile = `/level2_${expectedObsId}${expectedDetector}_spx_${expectedRelease}.fits`
    return parsed.pathname.includes(`/spherex/${expectedCollection}/`) && parsed.pathname.endsWith(expectedFile)
      && center && Number(center[1]) === Number(ra) && Number(center[2]) === Number(dec) && size === Number(sizeDeg)
  }
  if (!validateCutout(cutoutUrl, collection, obsId, detector, release)) return 'cutoutUrl must match the requested observation, detector, release, position, and size.'
  if (product === 'blink-pair') {
    const p = body.params ?? {}
    if (typeof p.referenceCutoutUrl !== 'string' || !OBS_ID_RE.test(String(p.referenceObsId ?? ''))
      || !DETECTOR_RE.test(String(p.referenceDetector ?? '')) || !RELEASE_RE.test(String(p.referenceRelease ?? ''))
      || p.referenceCollection !== collection || p.referenceDetector !== detector || p.referenceRelease !== release) {
      return 'Blink pairs must use the same detector, collection, and processing release and include a valid reference cutout.'
    }
    if (!validateCutout(p.referenceCutoutUrl, collection, p.referenceObsId, detector, release)) return 'referenceCutoutUrl must match the requested target and reference observation.'
    if (p.referenceCandidates !== undefined) {
      let candidates
      try { candidates = JSON.parse(p.referenceCandidates) } catch { return 'referenceCandidates must be a JSON array of candidate observations.' }
      if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 8) return 'Blink requests may include 1 to 8 reference candidates.'
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object' || !OBS_ID_RE.test(String(candidate.obsId ?? ''))
          || !validateCutout(candidate.cutoutUrl, collection, candidate.obsId, detector, release)) {
          return 'Every reference candidate must be a matching IRSA cutout from the same detector, collection, and release.'
        }
      }
    }
    const mismatch = Number(p.maxPassbandMismatchFraction ?? 0)
    if (!Number.isFinite(mismatch) || mismatch < 0 || mismatch > 1) return 'maxPassbandMismatchFraction must be between 0.00 and 1.00.'
  }
  if (product === 'band-composite') {
    const p = body.params ?? {}
    let channels
    try { channels = JSON.parse(p.channels) } catch { return 'Band composite requires a JSON array of RGB channel inputs.' }
    if (!Array.isArray(channels) || channels.length !== 3
      || new Set(channels.map((channel) => channel?.color)).size !== 3
      || new Set(channels.map((channel) => channel?.detector)).size !== 3
      || !['R', 'G', 'B'].every((color) => channels.some((channel) => channel?.color === color))) {
      return 'Band composite requires one distinct detector input for each R, G, and B channel.'
    }
    if (!channels.some((channel) => channel?.cutoutUrl === cutoutUrl && channel?.detector === detector)) {
      return 'The primary cutout must be one of the selected RGB channel inputs.'
    }
    for (const channel of channels) {
      if (!channel || !OBS_ID_RE.test(String(channel.obsId ?? ''))
        || !DETECTOR_RE.test(String(channel.detector ?? ''))
        || channel.collection !== collection || channel.release !== release
        || !validateCutout(channel.cutoutUrl, collection, channel.obsId, channel.detector, release)) {
        return 'Every RGB input must be a valid IRSA cutout from the same collection and processing release at the requested position.'
      }
    }
    const pixelScale = Number(p.pixelScaleArcsec ?? 6.2)
    if (!Number.isFinite(pixelScale) || pixelScale < 0.1 || pixelScale > 60) return 'Composite pixel scale is outside supported bounds.'
  }
  try { cacheKey(product, { collection, obsId, detector, release, ra, dec, sizeDeg, params: body.params ?? {} }) }
  catch { return 'Processing request parameters are invalid.' }
  return null
}

/* --------------------------------------------------------------- handlers */

async function createJob(request, supabase) {
  let requestBody = null
  try { requestBody = await request.json() } catch { return fail('Request body must be a JSON processing request.') }
  const problem = validation(requestBody)
  if (problem) return fail(problem)

  const { product, collection, obsId, detector, release, ra, dec, sizeDeg, cutoutUrl, params = {} } = requestBody
  let key
  try { key = cacheKey(product, { collection, obsId, detector, release, ra, dec, sizeDeg, params }) }
  catch (error) { return fail(`Invalid processing parameters: ${error.message}`) }

  // Idempotent: the same input set is the same job, whatever the queue state.
  const existing = await supabase.from('processing_jobs').select('*').eq('cache_key', key).maybeSingle()
  if (existing.data) return json(capabilityForJob(existing.data))

  const salt = process.env.RATE_LIMIT_SALT || 'cosmic-detective'
  const clientKey = clientKeyHash(request, salt)
  const cutoff = new Date(Date.now() - RATE_LIMIT.windowMs).toISOString()
  const recent = await supabase.from('processing_requests')
    .select('id', { count: 'exact', head: true })
    .eq('client_key', clientKey)
    .gte('created_at', cutoff)
  if (recent.error) return fail(`Rate limiting is unavailable: ${recent.error.message}`, 503)
  const decision = rateLimitDecision(recent.count ?? 0)
  if (!decision.allow) {
    return json(
      { state: 'unavailable', reason: 'Queued too many coordinate queries; wait before requesting more Processing runs.' },
      429,
      { 'Retry-After': String(decision.retryAfterMs) },
    )
  }

  const inserted = await supabase.from('processing_jobs').insert({
    cache_key: key,
    product,
    collection,
    obs_id: String(obsId),
    detector,
    release,
    ra: Number(ra),
    dec: Number(dec),
    size_deg: Number(sizeDeg),
    cutout_url: cutoutUrl,
    params,
  }).select('*').single()
  if (inserted.error) {
    if (inserted.error.code === '23505') {
      const raced = await supabase.from('processing_jobs').select('*').eq('cache_key', key).maybeSingle()
      if (raced.error || !raced.data) return fail('Could not load the existing processing job.', 503)
      return json({ ...capabilityForJob(raced.data), cacheKey: key }, 202)
    }
    return fail(`Could not create processing job: ${inserted.error.message}`, 503)
  }
  const logged = await supabase.from('processing_requests').insert({ client_key: clientKey, cache_key: key })
  void logged
  return json({ ...capabilityForJob(inserted.data), cacheKey: key }, 202)
}

async function jobStatus(url, supabase) {
  const jobId = url.searchParams.get('jobId')
  const cacheKeyValue = url.searchParams.get('cacheKey')
  if (cacheKeyValue) {
    if (!/^spherex\/v1\//.test(cacheKeyValue)) return fail('cacheKey must be a spherex/v1 product key.')
    const { data } = await supabase.from('processing_jobs').select('*').eq('cache_key', cacheKeyValue).maybeSingle()
    return json(await capabilityWithResult(data, supabase))
  }
  if (jobId) {
    const { data } = await supabase.from('processing_jobs').select('*').eq('id', jobId).maybeSingle()
    return json(await capabilityWithResult(data, supabase))
  }
  return fail('Provide jobId or cacheKey to look up a processing job.')
}

async function capabilityWithResult(job, supabase) {
  const capability = capabilityForJob(job)
  if (capability.state !== 'available' || !job.result_path) return capability
  const { data, error } = await supabase.storage.from('spherex-products').createSignedUrl(job.result_path, 600)
  if (error || !data?.signedUrl) return { state: 'unavailable', reason: 'The registered image product is ready, but its temporary result link could not be created.', jobId: job.id }
  return { ...capability, resultUrl: data.signedUrl }
}

export default async (request) => {
  if (driftError) {
    return json(
      { state: 'unavailable', reason: 'Processing orchestration is paused: cache keys drifted from the Python worker.' },
      503,
    )
  }
  let supabase
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return fail('Processing orchestration is not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).', 503)
  }
  supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  try {
    if (request.method === 'POST') return await createJob(request, supabase)
    if (request.method === 'GET') return await jobStatus(new URL(request.url), supabase)
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } })
  } catch (error) {
    return fail(`Processing orchestration failed: ${error.message}`, 503)
  }
}

/* Kept for tests: pure helpers and the DAY_MS constant live in processing.mjs. */
export const __internals = { validation, createDayHash, DAY_MS, goldenCount }
