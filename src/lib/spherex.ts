export type CapabilityState = 'available' | 'unavailable' | 'computing'
export type CapabilityId = 'blink' | 'difference' | 'lightcurve' | 'phaseFold' | 'spectrum'
export type DataOrigin = 'live' | 'simulated'

export interface SourceMeasurement {
  dataOrigin: 'live'
  band: string
  time: number
  flux: number
  uncertainty: number
  usable: boolean
  upperLimit?: boolean
}

export interface SourceSpectrumPoint {
  dataOrigin: 'live'
  wavelength: number
  flux: number
  uncertainty: number
  usable: boolean
  upperLimit?: boolean
}

export interface ObservationMetadata {
  band: string
  release: string
  time: number
  wavelength?: number
  measurement?: SourceMeasurement
  spectrum?: SourceSpectrumPoint[]
}

export interface SnapshotEpoch {
  obsId?: string
  band?: string
  date?: string
  mjd?: number
  sourceUrl?: string
  cutoutUrl?: string
}

export interface SnapshotTile {
  ra: number
  dec: number
  sizeDeg: number
  epochs?: { a?: SnapshotEpoch; b?: SnapshotEpoch }
}

export interface Capability {
  state: CapabilityState
  reason: string
}

export type Capabilities = Record<CapabilityId, Capability>

const unavailable = (reason: string): Capability => ({ state: 'unavailable', reason })

export function isUsableMeasurement(measurement: SourceMeasurement | null | undefined): measurement is SourceMeasurement {
  return Boolean(measurement && measurement.dataOrigin === 'live' && measurement.usable
    && Number.isFinite(measurement.time) && Number.isFinite(measurement.flux)
    && Number.isFinite(measurement.uncertainty) && measurement.uncertainty > 0)
}

export function isUsableSpectrumPoint(point: SourceSpectrumPoint | null | undefined): point is SourceSpectrumPoint {
  return Boolean(point && point.dataOrigin === 'live' && point.usable
    && Number.isFinite(point.wavelength) && point.wavelength > 0
    && Number.isFinite(point.flux) && Number.isFinite(point.uncertainty) && point.uncertainty > 0)
}

function usableMeasurements(frames: ObservationMetadata[]): SourceMeasurement[] {
  return frames
    .map((frame) => frame.measurement)
    .filter(isUsableMeasurement)
}

function measuredSpectrum(frames: ObservationMetadata[]): SourceSpectrumPoint[] {
  return frames
    .flatMap((frame) => frame.spectrum ?? [])
    .filter(isUsableSpectrumPoint)
}

/** Metadata-only gating. No FITS pixels or photometry are treated as available here. */
export function capabilitiesFor(frames: ObservationMetadata[]): Capabilities {
  const timed = frames.filter((frame) => Number.isFinite(frame.time))
  const sameChannel = [...new Set(frames.map((frame) => frame.band))]
    .some((band) => timed.filter((frame) => frame.band === band).length >= 2)
  const measurements = usableMeasurements(frames)
  const measurementBands = [...new Set(measurements.map((measurement) => measurement.band))]
  const lightCurveBand = measurementBands.find((band) => {
    const points = measurements.filter((measurement) => measurement.band === band)
    return points.length >= 3 && Math.max(...points.map((point) => point.time)) > Math.min(...points.map((point) => point.time))
  })
  const spectrumPoints = measuredSpectrum(frames)

  return {
    blink: unavailable(sameChannel
      ? 'Repeat metadata exists, but aligned pixels and astrometric validation are not available.'
      : 'No same-channel repeat observations were returned.'),
    difference: unavailable('Requires validated alignment, PSF matching, and quality masks; browse mode does not provide these.'),
    lightcurve: lightCurveBand
      ? { state: 'available', reason: `Validated live source photometry is available for ${lightCurveBand}.` }
      : unavailable(measurements.length
        ? 'Fewer than three quality-approved same-channel measurements with a time baseline are available.'
        : 'Source photometry has not been extracted from the returned observations.'),
    phaseFold: unavailable('Requires a validated same-channel light curve with uncertainties and enough baseline.'),
    spectrum: spectrumPoints.length >= 2
      ? { state: 'available', reason: 'Validated live source-spectrum measurements are available.' }
      : unavailable('Detector channels are present, but measured source-spectrum data are not available.'),
  }
}
