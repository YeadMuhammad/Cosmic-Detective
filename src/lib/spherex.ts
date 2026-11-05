export type CapabilityState = 'available' | 'unavailable' | 'computing'
export type CapabilityId = 'blink' | 'difference' | 'lightcurve' | 'phaseFold' | 'spectrum'
export type DataOrigin = 'live' | 'simulated'

export interface SourceMeasurement {
  dataOrigin: 'live'
  provenance: { provider: 'irsa-spherex-photometry'; release: 'qr2' | 'qr3'; detector: string; exposureId: string }
  band: string
  time: number
  flux: number
  uncertainty: number
  usable: boolean
  flags: number
  fitQuality: number
  upperLimit?: boolean
}

export interface SourceSpectrumPoint {
  dataOrigin: 'live'
  provenance: { provider: 'irsa-spherex-photometry'; release: 'qr2' | 'qr3'; detector: string; exposureId: string }
  wavelength: number
  bandwidth: number
  flux: number
  uncertainty: number
  usable: boolean
  flags: number
  fitQuality: number
  upperLimit?: boolean
}

export interface ObservationMetadata {
  band: string
  release: string
  time: number
  wavelength?: number
  position?: { ra: number; dec: number }
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
    && measurement.provenance?.provider === 'irsa-spherex-photometry'
    && ['qr2', 'qr3'].includes(measurement.provenance.release)
    && /^D[1-6]$/.test(measurement.provenance.detector) && measurement.band === measurement.provenance.detector
    && !!measurement.provenance.exposureId && Number.isFinite(measurement.fitQuality) && measurement.fitQuality >= 0
    && (measurement.flags === 0 || measurement.flags === 2 ** 21)
    && Number.isFinite(measurement.time) && Number.isFinite(measurement.flux)
    && Number.isFinite(measurement.uncertainty) && measurement.uncertainty > 0)
}

export function isUsableSpectrumPoint(point: SourceSpectrumPoint | null | undefined): point is SourceSpectrumPoint {
  return Boolean(point && point.dataOrigin === 'live' && point.usable
    && point.provenance?.provider === 'irsa-spherex-photometry'
    && ['qr2', 'qr3'].includes(point.provenance.release)
    && /^D[1-6]$/.test(point.provenance.detector) && !!point.provenance.exposureId
    && Number.isFinite(point.fitQuality) && point.fitQuality >= 0
    && (point.flags === 0 || point.flags === 2 ** 21)
    && Number.isFinite(point.wavelength) && point.wavelength > 0
    && Number.isFinite(point.bandwidth) && point.bandwidth > 0
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
  const measurementGroups = [...new Set(measurements.map((measurement) => `${measurement.band}:${measurement.provenance.release}`))]
  const lightCurveGroup = measurementGroups.find((group) => {
    const [band, release] = group.split(':')
    const points = measurements.filter((measurement) => measurement.band === band && measurement.provenance.release === release)
    return points.length >= 3 && Math.max(...points.map((point) => point.time)) > Math.min(...points.map((point) => point.time))
  })
  const spectrumPoints = measuredSpectrum(frames)

  return {
    blink: unavailable(sameChannel
      ? 'Repeat metadata exists, but aligned pixels and astrometric validation are not available.'
      : 'No same-channel repeat observations were returned.'),
    difference: unavailable('Requires validated alignment, PSF matching, and quality masks; browse mode does not provide these.'),
    lightcurve: lightCurveGroup
      ? { state: 'available', reason: `Validated live source photometry is available for ${lightCurveGroup.replace(':', ' · ').toUpperCase()}.` }
      : unavailable(measurements.length
        ? 'Fewer than three quality-approved same-channel measurements with a time baseline are available.'
        : 'Source photometry has not been extracted from the returned observations.'),
    phaseFold: unavailable('Requires a validated same-channel light curve with uncertainties and enough baseline.'),
    spectrum: unavailable(spectrumPoints.length >= 2
      ? 'Photometry is present, but these points span multiple exposures; time-coherent spectral grouping is not yet validated.'
      : 'Detector channels are present, but measured source-spectrum data are not available.'),
  }
}
