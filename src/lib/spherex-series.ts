import type { ObservationMetadata, SourceMeasurement, SourceSpectrumPoint } from './spherex'

export interface ValidatedLightCurve {
  dataOrigin: 'live'
  band: string
  points: SourceMeasurement[]
  baselineMs: number
}

export interface ValidatedSpectrum {
  dataOrigin: 'live'
  points: SourceSpectrumPoint[]
}

export type SeriesResult<T> = { available: true; value: T } | { available: false; reason: string }

function measurementsFor(frames: ObservationMetadata[], band: string): SourceMeasurement[] {
  return frames
    .map((frame) => frame.measurement)
    .filter((measurement): measurement is SourceMeasurement => Boolean(
      measurement
      && measurement.dataOrigin === 'live'
      && measurement.band === band
      && measurement.usable
      && Number.isFinite(measurement.time)
      && Number.isFinite(measurement.flux)
      && Number.isFinite(measurement.uncertainty)
      && measurement.uncertainty > 0,
    ))
    .sort((a, b) => a.time - b.time)
}

export function buildLightCurve(frames: ObservationMetadata[], band: string, minimumPoints = 3): SeriesResult<ValidatedLightCurve> {
  const points = measurementsFor(frames, band)
  if (points.length < minimumPoints) {
    return { available: false, reason: `Requires at least ${minimumPoints} quality-approved live measurements in ${band}.` }
  }
  const baselineMs = points[points.length - 1].time - points[0].time
  if (!Number.isFinite(baselineMs) || baselineMs <= 0) {
    return { available: false, reason: 'Same-channel measurements do not span a positive time baseline.' }
  }
  return { available: true, value: { dataOrigin: 'live', band, points, baselineMs } }
}

export function buildSpectrum(frames: ObservationMetadata[], minimumPoints = 2): SeriesResult<ValidatedSpectrum> {
  const points = frames
    .flatMap((frame) => frame.spectrum ?? [])
    .filter((point): point is SourceSpectrumPoint => Boolean(
      point
      && point.dataOrigin === 'live'
      && point.usable
      && Number.isFinite(point.wavelength)
      && point.wavelength > 0
      && Number.isFinite(point.flux)
      && Number.isFinite(point.uncertainty)
      && point.uncertainty > 0,
    ))
    .sort((a, b) => a.wavelength - b.wavelength)
  if (points.length < minimumPoints) {
    return { available: false, reason: `Requires at least ${minimumPoints} quality-approved live spectrum measurements.` }
  }
  return { available: true, value: { dataOrigin: 'live', points } }
}
