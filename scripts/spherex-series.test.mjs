import assert from 'node:assert/strict'
import test from 'node:test'

import { buildLightCurve, buildSpectrum } from '../src/lib/spherex-series.ts'
import { capabilitiesFor } from '../src/lib/spherex.ts'

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
