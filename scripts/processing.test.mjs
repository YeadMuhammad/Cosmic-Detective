// Orchestration tests for PLAN.md item 2 ('Worker, jobs, and cache').
//
//  - netlify/lib/processing.mjs must reproduce the Python worker's golden
//    cache keys (worker/cache_key_cases.json) byte for byte;
//  - the rate limiter bounds coordinate queries in a sliding window;
//  - job status maps to capability records: queued/running -> computing,
//    completed -> available, failed -> unavailable with the worker's reason;
//  - the app-side mapper narrows records and never mints availability.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalParams,
  capabilityForJob,
  cacheKey,
  rateLimitDecision,
  uploadPath,
  verifyGoldenCacheKeys,
} from '../netlify/lib/processing.mjs'
import { capabilityFromJob, ORCHESTRATION_UNAVAILABLE } from '../src/lib/processing.ts'

const GOLDEN_CASES = [
  {
    product: 'cutout-render',
    collection: 'qr2',
    obsId: '2025W17_4B_0136_1',
    detector: 'D1',
    release: 'l2b-v20-2025-240',
    ra: 269.4587,
    dec: 4.609,
    sizeDeg: 0.08,
    params: { pipelineVersion: '1.0', stretch: 'asinh' },
    key: 'spherex/v1/cutout-render/qr2/2025W17_4B_0136_1/D1/l2b-v20-2025-240/ra269.458700-dec4.609000-s0.0800/b213ede4e9d0',
  },
  {
    product: 'photometry',
    collection: 'qr3',
    obsId: '2026W22_1A_0026_2',
    detector: 'D6',
    release: 'l2b-v25-2026-150',
    ra: 0,
    dec: -90,
    sizeDeg: 1.5,
    params: {},
    key: 'spherex/v1/photometry/qr3/2026W22_1A_0026_2/D6/l2b-v25-2026-150/ra0.000000-dec-90.000000-s1.5000/781508e680da',
  },
]

test('JavaScript cache keys match the Python goldens', () => {
  assert.equal(verifyGoldenCacheKeys(), 3, 'the shared goldens file must stay fully covered')
})

test('cacheKey rebuilds every golden key byte for byte', () => {
  for (const { key, params, product, ...input } of GOLDEN_CASES) {
    assert.equal(cacheKey(product, { ...input, params }), key)
  }
})

test('canonical params equal Python canonical forms for golden inputs', () => {
  const expected = [
    '{"pipelineVersion":"1.0","product":"cutout-render","stretch":"asinh"}',
    '{"product":"photometry"}',
  ]
  for (const [{ product, params }, canonical] of GOLDEN_CASES.slice(0, 2).map((item, index) => [item, expected[index]])) {
    assert.equal(canonicalParams(product, params), canonical)
  }
  assert.equal(canonicalParams('p', { a: 'x', b: 2, c: true, d: null }), '{"a":"x","b":2,"c":true,"d":null,"product":"p"}')
})

test('cache key rejects path-hostile components and non-finite geometry', () => {
  for (const product of ['../x', 'sp ace', '', 'a/b']) {
    assert.throws(() => cacheKey(product, { collection: 'qr2', obsId: 'o', detector: 'D1', release: 'r', ra: 0, dec: 0, sizeDeg: 1 }), /unsafe/)
  }
  assert.throws(() => cacheKey('p', { collection: 'qr2', obsId: 'o', detector: 'D1', release: 'r', ra: 'x', dec: 0, sizeDeg: 1 }), /not finite/)
  assert.throws(() => cacheKey('p', { collection: 'qr2', obsId: 'o', detector: 'D1', release: 'r', ra: 0, dec: 0, sizeDeg: 'big' }), /not finite/)
})

test('canonical params reject floats, nested structures and product overrides', () => {
  assert.throws(() => canonicalParams('p', { tol: 0.5 }), /flat/)
  assert.throws(() => canonicalParams('p', { nested: { deep: true } }), /flat/)
  assert.throws(() => canonicalParams('p', { list: [1, 2] }), /flat/)
  assert.throws(() => canonicalParams('p', { odd: undefined }), /flat/)
  assert.throws(() => canonicalParams('p', { product: 'x' }), /must not override/)
})

test('upload paths stay inside the bucket prefix', () => {
  assert.equal(uploadPath('spherex/v1/p', '.json'), 'spherex/v1/p.json')
  assert.throws(() => uploadPath('k', '.png/evil'), /suffix/)
})

test('rate limiter stops after maxRequests and reports retry window', () => {
  assert.deepEqual(rateLimitDecision(0), { allow: true, retryAfterMs: 0 })
  assert.deepEqual(rateLimitDecision(5), { allow: true, retryAfterMs: 0 })
  assert.deepEqual(rateLimitDecision(6), { allow: false, retryAfterMs: 60 })
  assert.deepEqual(rateLimitDecision(100), { allow: false, retryAfterMs: 60 })
  assert.throws(() => rateLimitDecision(-1))
})

const BASE_JOB = { id: '11111111-1111-1111-1111-111111111111', product: 'cutout-render', cache_key: 'spherex/v1/p/x' }

test('job status maps to capability records like the contract says', () => {
  assert.equal(capabilityForJob({ ...BASE_JOB, status: 'queued' }).state, 'computing')
  assert.equal(capabilityForJob({ ...BASE_JOB, status: 'running' }).state, 'computing')
  const completed = capabilityForJob({ ...BASE_JOB, status: 'completed', result_path: 'spherex/v1/p/x' })
  assert.equal(completed.state, 'available')
  assert.equal(completed.resultPath, 'spherex/v1/p/x')
  assert.equal(capabilityForJob({ ...BASE_JOB, status: 'completed', result_path: null }).state, 'unavailable')
  const failed = capabilityForJob({ ...BASE_JOB, status: 'failed', error_reason: 'IRSA 503' })
  assert.equal(failed.state, 'unavailable')
  assert.equal(failed.reason, 'IRSA 503')
  assert.equal(capabilityForJob({ ...BASE_JOB, status: 'failed' }).state, 'unavailable')
  assert.equal(capabilityForJob(null).state, 'unavailable')
  assert.equal(capabilityForJob({ ...BASE_JOB, status: 'future' }).state, 'unavailable')
})

test('app-side mapping narrows records and never mints availability', () => {
  assert.deepEqual(capabilityFromJob({ state: 'computing', reason: 'Processing is running.' }), { state: 'computing', reason: 'Processing is running.' })
  assert.deepEqual(capabilityFromJob({ state: 'available', reason: 'ok' }), { state: 'available', reason: 'ok' })
  assert.equal(capabilityFromJob({ state: 'corrupted', reason: 'x' }).state, 'unavailable')
  assert.equal(capabilityFromJob(null).state, 'unavailable')
  assert.equal(capabilityFromJob(null).reason, ORCHESTRATION_UNAVAILABLE.reason)
})
