import type { ObservationMetadata, SourceMeasurement, SourceSpectrumPoint } from './spherex'
import { isUsableMeasurement, isUsableSpectrumPoint } from './spherex'

export interface ValidatedLightCurve {
  dataOrigin: 'live'
  band: string
  release: 'qr2' | 'qr3'
  points: SourceMeasurement[]
  baselineMs: number
}

export interface ValidatedSpectrum {
  dataOrigin: 'live'
  points: SourceSpectrumPoint[]
}

export type SeriesResult<T> = { available: true; value: T } | { available: false; reason: string }

export interface PhaseBin {
  phase: number
  flux: number
  uncertainty: number
  count: number
}

export interface PhaseFoldResult {
  dataOrigin: 'live'
  label: 'periodic signal candidate'
  periodMs: number
  epochMs: number
  cycles: number
  bins: PhaseBin[]
  nullModel: { weightedMean: number; chiSquare: number; degreesOfFreedom: number }
  foldedModelImprovement: number
}

function measurementsFor(frames: ObservationMetadata[], band: string, release: 'qr2' | 'qr3'): SourceMeasurement[] {
  return frames
    .map((frame) => frame.measurement)
    .filter((measurement): measurement is SourceMeasurement => isUsableMeasurement(measurement)
      && measurement.band === band && measurement.provenance.release === release)
    .sort((a, b) => a.time - b.time)
}

export function buildLightCurve(frames: ObservationMetadata[], band: string, minimumPoints = 3, release?: 'qr2' | 'qr3'): SeriesResult<ValidatedLightCurve> {
  const releases = release ? [release] : ['qr2', 'qr3'] as const
  const validGroups = releases.map((candidate) => ({ release: candidate, points: measurementsFor(frames, band, candidate) }))
  const group = validGroups.find(({ points }) => points.length >= minimumPoints
    && points[points.length - 1].time > points[0].time)
  const points = group?.points ?? validGroups.sort((a, b) => b.points.length - a.points.length)[0]?.points ?? []
  if (points.length < minimumPoints) {
    return { available: false, reason: `Requires at least ${minimumPoints} quality-approved live measurements in ${band} from one calibration release.` }
  }
  const baselineMs = points[points.length - 1].time - points[0].time
  if (!Number.isFinite(baselineMs) || baselineMs <= 0) {
    return { available: false, reason: 'Same-channel measurements do not span a positive time baseline.' }
  }
  return { available: true, value: { dataOrigin: 'live', band, release: group?.release ?? release ?? points[0].provenance.release, points, baselineMs } }
}

export function buildSpectrum(frames: ObservationMetadata[], minimumPoints = 2): SeriesResult<ValidatedSpectrum> {
  const points = frames
    .flatMap((frame) => frame.spectrum ?? [])
    .filter(isUsableSpectrumPoint)
    .sort((a, b) => a.wavelength - b.wavelength)
  if (points.length < minimumPoints) {
    return { available: false, reason: `Requires at least ${minimumPoints} quality-approved live spectrum measurements.` }
  }
  return { available: false, reason: 'The imported measurements span multiple exposure times; a time-coherent spectral epoch has not been selected or validated.' }
}

export function phaseFold(
  curve: ValidatedLightCurve,
  periodMs: number,
  binCount = 10,
): SeriesResult<PhaseFoldResult> {
  if (curve.dataOrigin !== 'live') return { available: false, reason: 'Phase folding requires a live validated light curve.' }
  if (!Number.isFinite(periodMs) || periodMs <= 0) return { available: false, reason: 'Trial period must be positive and finite.' }
  if (!Number.isInteger(binCount) || binCount < 2 || binCount > 100) return { available: false, reason: 'Phase bin count must be an integer from 2 to 100.' }
  const cycles = curve.baselineMs / periodMs
  if (curve.points.length < 6 || cycles < 2) {
    return { available: false, reason: 'Requires at least six measurements spanning two trial-period cycles.' }
  }

  const weightedMean = curve.points.reduce((sum, point) => sum + point.flux / point.uncertainty ** 2, 0)
    / curve.points.reduce((sum, point) => sum + 1 / point.uncertainty ** 2, 0)
  const nullChiSquare = curve.points.reduce((sum, point) => (
    sum + ((point.flux - weightedMean) / point.uncertainty) ** 2
  ), 0)
  const buckets = Array.from({ length: binCount }, () => [] as SourceMeasurement[])
  const epochMs = curve.points[0].time
  for (const point of curve.points) {
    const elapsed = point.time - epochMs
    const phase = ((elapsed % periodMs) + periodMs) % periodMs / periodMs
    buckets[Math.min(binCount - 1, Math.floor(phase * binCount))].push(point)
  }
  const bins = buckets
    .map((points, index) => {
      if (!points.length) return null
      const weight = points.reduce((sum, point) => sum + 1 / point.uncertainty ** 2, 0)
      const flux = points.reduce((sum, point) => sum + point.flux / point.uncertainty ** 2, 0) / weight
      return {
        phase: (index + 0.5) / binCount,
        flux,
        uncertainty: Math.sqrt(1 / weight),
        count: points.length,
      }
    })
    .filter((bin): bin is PhaseBin => bin !== null)
  const degreesOfFreedom = Math.max(0, curve.points.length - 1)
  const foldedModelImprovement = Math.max(0, nullChiSquare - bins.reduce((sum, bin) => {
    const bucket = buckets[Math.floor(bin.phase * binCount)]
    return sum + bucket.reduce((inner, point) => inner + ((point.flux - bin.flux) / point.uncertainty) ** 2, 0)
  }, 0))
  return {
    available: true,
    value: {
      dataOrigin: 'live',
      label: 'periodic signal candidate',
      periodMs,
      epochMs,
      cycles,
      bins,
      nullModel: { weightedMean, chiSquare: nullChiSquare, degreesOfFreedom },
      foldedModelImprovement,
    },
  }
}
