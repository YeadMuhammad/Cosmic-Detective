import assert from 'node:assert/strict'
import test from 'node:test'

import { buildLightCurve, buildSpectrum, phaseFold } from '../src/lib/spherex-series.ts'
import { capabilitiesFor } from '../src/lib/spherex.ts'
import { differenceSignificance, validateComparisonPair, withMotionOffset } from '../src/lib/image-comparison.ts'

const liveMeasurement = (band, time, flux = 1) => ({
  dataOrigin: 'live',
  band,
  time,
  flux,
  uncertainty: 0.1,
  usable: true,
})

test('light curve requires quality-approved same-channel live measurements', () => {
  const frames = [
    { band: 'D1', release: 'r', time: 1, measurement: liveMeasurement('D1', 1) },
    { band: 'D1', release: 'r', time: 2, measurement: liveMeasurement('D1', 2) },
    { band: 'D1', release: 'r', time: 3, measurement: liveMeasurement('D1', 3) },
  ]
  const result = buildLightCurve(frames, 'D1')
  assert.equal(result.available, true)
  assert.equal(result.value.points.length, 3)
  assert.equal(capabilitiesFor(frames).lightcurve.state, 'available')
})

test('unusable and simulated measurements never enable light curves', () => {
  const frames = [
    { band: 'D1', release: 'r', time: 1, measurement: { ...liveMeasurement('D1', 1), usable: false } },
    { band: 'D1', release: 'r', time: 2, measurement: { ...liveMeasurement('D1', 2), dataOrigin: 'simulated' } },
    { band: 'D1', release: 'r', time: 3 },
  ]
  assert.equal(buildLightCurve(frames, 'D1').available, false)
  assert.equal(capabilitiesFor(frames).lightcurve.state, 'unavailable')
})

test('spectrum requires measured live source-spectrum points', () => {
  const frames = [
    { band: 'D1', release: 'r', time: 1, spectrum: [{ dataOrigin: 'live', wavelength: 1, flux: 2, uncertainty: 0.2, usable: true }] },
    { band: 'D2', release: 'r', time: 2, spectrum: [{ dataOrigin: 'live', wavelength: 2, flux: 3, uncertainty: 0.3, usable: true }] },
  ]
  const result = buildSpectrum(frames)
  assert.equal(result.available, true)
  assert.deepEqual(result.value.points.map((point) => point.wavelength), [1, 2])
  assert.equal(capabilitiesFor(frames).spectrum.state, 'available')
})

test('phase folding bins weighted live points and compares a null model', () => {
  const points = Array.from({ length: 8 }, (_, index) => liveMeasurement('D1', index * 1000, index % 2 ? 2 : 1))
  const curve = buildLightCurve(points.map((measurement) => ({
    band: 'D1', release: 'r', time: measurement.time, measurement,
  })), 'D1', 6)
  assert.equal(curve.available, true)
  const folded = phaseFold(curve.value, 2000, 4)
  assert.equal(folded.available, true)
  assert.equal(folded.value.label, 'periodic signal candidate')
  assert.equal(folded.value.bins.length, 2)
  assert.equal(folded.value.nullModel.degreesOfFreedom, 7)
  assert.ok(folded.value.foldedModelImprovement >= 0)
})

test('phase folding rejects insufficient cycles and invalid periods', () => {
  const measurement = liveMeasurement('D1', 0)
  const curve = buildLightCurve([
    { band: 'D1', release: 'r', time: 0, measurement },
    { band: 'D1', release: 'r', time: 1, measurement: { ...measurement, time: 1 } },
    { band: 'D1', release: 'r', time: 2, measurement: { ...measurement, time: 2 } },
  ], 'D1')
  assert.equal(curve.available, true)
  assert.equal(phaseFold(curve.value, 0).available, false)
  assert.equal(phaseFold(curve.value, 1).available, false)
})

test('image comparison requires scientifically aligned inputs', () => {
  const first = { id: 'a', detector: 'D1', band: 'D1', release: 'r', time: 1, overlaps: true, validPixels: 10, astrometricResidualPixels: 0.1 }
  const second = { ...first, id: 'b', time: 2 }
  const result = validateComparisonPair(first, second)
  assert.equal(result.available, true)
  const moved = withMotionOffset(result.value, { dxPixels: 1.7, dyPixels: -0.2 })
  assert.equal(moved.motionOffset.dxPixels, 1.7)
  assert.equal(validateComparisonPair(first, { ...second, band: 'D2' }).available, false)
  assert.equal(validateComparisonPair(first, { ...second, overlaps: false }).available, false)
})

test('difference significance includes registration error through the local gradient', () => {
  const value = differenceSignificance(5, 4, 5, 0.2, 3)
  assert.equal(value, 5 / Math.sqrt(4 + 5 + (0.2 * 3) ** 2))
})
