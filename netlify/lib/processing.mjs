/**
 * SPHEREx processing orchestration, pure logic (no Netlify runtime imports).
 *
 * Worker, jobs and cache contract (PLAN.md item 2):
 *  - cache keys are IDENTICAL to worker/lib/cache_keys.py; both implementations
 *    run the shared goldens in worker/cache_key_cases.json, locked by tests;
 *  - job state maps to capability records: queued/running -> 'computing',
 *    completed -> 'available', failed -> 'unavailable' with the worker's reason;
 *  - the rate limiter bounds coordinate queries per client in a sliding window.
 * This module never performs FITS processing — that lives in the Python worker.
 */
import { createHash } from 'node:crypto'
import cases from '../../worker/cache_key_cases.json' with { type: 'json' }

export const KEY_VERSION = 'v1'

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function checkSegment(component, name) {
  if (typeof component !== 'string' || !SAFE_SEGMENT.test(component)) {
    throw new Error(`unsafe ${name} cache-key component: ${JSON.stringify(component)}`)
  }
  return component
}

function fixed(value, decimals, name) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`${name} is not finite: ${String(value)}`)
  return number.toFixed(decimals)
}

/**
 * Canonical parameter JSON, byte-identical to Python's
 * json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False).
 * Flat primitive params only — floats and nested structures are rejected
 * because Python (recursive sort_keys) and JavaScript (insertion order)
 * would otherwise canonicalize them differently.
 */
export function canonicalParams(product, params = {}) {
  const merged = { product }
  for (const [key, value] of Object.entries(params)) {
    const primitive = value === null || typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isInteger(value))
    if (!primitive || typeof value === 'number' && !Number.isInteger(value)) {
      throw new Error(`params[${key}] must be a flat string, int, bool or null`)
    }
    if (key === 'product') throw new Error("params must not override 'product'")
    merged[key] = value
  }
  const keys = Object.keys(merged).sort()
  const parts = keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(merged[key])}`)
  return `{${parts.join(',')}}`
}

export function paramsHash(product, params) {
  return createHash('sha256').update(canonicalParams(product, params), 'utf8').digest('hex').slice(0, 12)
}

/**
 * One cache/object key per product input set, versioned end to end.
 * Layout: spherex/<keyVersion>/<product>/<collection>/<obsId>/<detector>/<release>/<geo>/<paramsHash>
 */
export function cacheKey(product, { collection, obsId, detector, release, ra, dec, sizeDeg, params }) {
  const segments = [
    'spherex',
    KEY_VERSION,
    checkSegment(product, 'product'),
    checkSegment(collection, 'collection'),
    checkSegment(obsId, 'obsId'),
    checkSegment(detector, 'detector'),
    checkSegment(release, 'release'),
    `ra${fixed(ra, 6, 'ra')}-dec${fixed(dec, 6, 'dec')}-s${fixed(sizeDeg, 4, 'sizeDeg')}`,
    paramsHash(product, params),
  ]
  return segments.join('/')
}

export function uploadPath(cacheKeyValue, suffix) {
  if (!/^\.[A-Za-z0-9]+$/.test(suffix)) throw new Error(`unsafe product suffix: ${suffix}`)
  return `${cacheKeyValue}${suffix}`
}

/**
 * Verifies the JS implementation against the shared golden cases so the two
 * languages can never drift. Exported for the test suite; the function calls
 * it on cold start and fails loudly on mismatch.
 */
export function verifyGoldenCacheKeys(fn = cacheKey) {
  for (const testCase of cases.cases) {
    const key = fn(testCase.input.product, testCase.input)
    if (key !== testCase.key) {
      throw new Error(`cache-key golden mismatch for ${testCase.name}: ${key} != ${testCase.key}`)
    }
  }
  return cases.cases.length
}

export function assertGoldenCacheKeys() {
  try {
    return verifyGoldenCacheKeys()
  } catch (error) {
    throw new Error(`cache keys drifted from the Python worker: ${error.message}`)
  }
}

/* --------------------------------------------------------------- rate limit */

export const RATE_LIMIT = { windowMs: 60_000, maxRequests: 6 }

/** Sliding-window decision from the count of accepted requests in the window. */
export function rateLimitDecision(count, nowMs, { windowMs = RATE_LIMIT.windowMs, maxRequests = RATE_LIMIT.maxRequests } = {}) {
  if (!Number.isFinite(count) || count < 0) throw new Error('count must be a non-negative number')
  if (count >= maxRequests) {
    return { allow: false, retryAfterMs: Math.ceil(windowMs / 1000) }
  }
  return { allow: true, retryAfterMs: 0 }
}

/* --------------------------------------------------------- capability state */

const UNAVAILABLE_REASONS = {
  queued: 'Your processing request is queued and waiting for a SPHEREx worker.',
  running: 'Processing is running on the SPHEREx worker.',
}

/**
 * A queue row -> capability record. Worker failure becomes 'unavailable' with
 * the recorded reason; a missing result after completion is also unavailable.
 */
export function capabilityForJob(job) {
  if (!job || typeof job !== 'object') {
    return { state: 'unavailable', reason: 'No processing job was found for this request.' }
  }
  switch (job.status) {
    case 'queued':
    case 'running':
      return { state: 'computing', reason: UNAVAILABLE_REASONS[job.status], jobId: job.id }
    case 'completed':
      if (!job.result_path) {
        return { state: 'unavailable', reason: 'The completed job stored no product; the result is unavailable.', jobId: job.id }
      }
      return { state: 'available', reason: 'Product is available in the SPHEREx product store.', jobId: job.id, resultPath: job.result_path }
    case 'failed':
      return { state: 'unavailable', reason: job.error_reason || 'The SPHEREx processing worker reported a failure without a reason.', jobId: job.id }
    default:
      return { state: 'unavailable', reason: `Unknown job status: ${String(job.status)}`, jobId: job.id }
  }
}
