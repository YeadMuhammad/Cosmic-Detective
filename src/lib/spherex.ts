export type CapabilityState = 'available' | 'unavailable' | 'computing'
export type CapabilityId = 'blink' | 'difference' | 'lightcurve' | 'phaseFold' | 'spectrum'
export type DataOrigin = 'live' | 'simulated'

export interface SourceMeasurement {
  dataOrigin: 'live'
  provenance: { provider: 'irsa-spherex-photometry'; release: 'qr2' | 'qr3'; detector: string; exposureId: string; deepField: boolean }
  band: string
  time: number
  wavelength: number
  bandwidth: number
  flux: number
  uncertainty: number
  backgroundFluxMJySr: number
  usable: boolean
  flags: number
  fitQuality: number
  /** Optional IRSA result diagnostics preserved verbatim until their definitions are validated. */
  diagnostics?: { ext_flg?: string; nyquist_comp?: string }
  upperLimit?: boolean
}

export interface SourceSpectrumPoint {
  dataOrigin: 'live'
  provenance: { provider: 'irsa-spherex-photometry'; release: 'qr2' | 'qr3'; detector: string; exposureId: string; deepField: boolean }
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
const analysisEligibleFlags = new Set([0, 2 ** 21])

/** Permit only IRSA's documented nominal flag values: no flags or SOURCE-only. */
export function isAnalysisEligibleFlags(flags: number): boolean {
  return Number.isSafeInteger(flags) && flags >= 0 && analysisEligibleFlags.has(flags)
}

export function isUsableMeasurement(measurement: SourceMeasurement | null | undefined): measurement is SourceMeasurement {
  return Boolean(measurement && measurement.dataOrigin === 'live' && measurement.usable
    && measurement.provenance?.provider === 'irsa-spherex-photometry'
    && ['qr2', 'qr3'].includes(measurement.provenance.release)
    && /^D[1-6]$/.test(measurement.provenance.detector) && measurement.band === measurement.provenance.detector
    && !!measurement.provenance.exposureId && typeof measurement.provenance.deepField === 'boolean'
    && Number.isFinite(measurement.fitQuality) && measurement.fitQuality >= 0
    && isAnalysisEligibleFlags(measurement.flags)
    && Number.isFinite(measurement.wavelength) && measurement.wavelength > 0
    && Number.isFinite(measurement.bandwidth) && measurement.bandwidth > 0
    && Number.isFinite(measurement.time) && Number.isFinite(measurement.flux)
    && Number.isFinite(measurement.uncertainty) && measurement.uncertainty > 0
    && Number.isFinite(measurement.backgroundFluxMJySr))
}

export function isUsableSpectrumPoint(point: SourceSpectrumPoint | null | undefined): point is SourceSpectrumPoint {
  return Boolean(point && point.dataOrigin === 'live' && point.usable
    && point.provenance?.provider === 'irsa-spherex-photometry'
    && ['qr2', 'qr3'].includes(point.provenance.release)
    && /^D[1-6]$/.test(point.provenance.detector) && !!point.provenance.exposureId && typeof point.provenance.deepField === 'boolean'
    && Number.isFinite(point.fitQuality) && point.fitQuality >= 0
    && isAnalysisEligibleFlags(point.flags)
    && Number.isFinite(point.wavelength) && point.wavelength > 0
    && Number.isFinite(point.bandwidth) && point.bandwidth > 0
    && Number.isFinite(point.flux) && Number.isFinite(point.uncertainty) && point.uncertainty > 0)
}

function usableMeasurements(frames: ObservationMetadata[]): SourceMeasurement[] {
  return frames
    .filter((frame) => isUsableMeasurement(frame.measurement)
      && frame.band === frame.measurement.band
      && frame.release === frame.measurement.provenance.release
      && frame.time === frame.measurement.time)
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
  const measurementGroups = [...new Set(measurements.map((measurement) => [
    measurement.band, measurement.provenance.release, measurement.wavelength.toFixed(4), measurement.bandwidth.toFixed(4), measurement.provenance.deepField,
  ].join(':')))]
  const lightCurveGroup = measurementGroups.find((group) => {
    const [band, release, wavelength, bandwidth, deepField] = group.split(':')
    const points = measurements.filter((measurement) => measurement.band === band && measurement.provenance.release === release
      && measurement.wavelength.toFixed(4) === wavelength && measurement.bandwidth.toFixed(4) === bandwidth
      && String(measurement.provenance.deepField) === deepField)
    return points.length >= 3 && Math.max(...points.map((point) => point.time)) > Math.min(...points.map((point) => point.time))
  })
  const spectrumPoints = measuredSpectrum(frames)

  return {
    blink: unavailable(sameChannel
      ? 'Repeat metadata exists, but aligned pixels and astrometric validation are not available.'
      : 'No same-channel repeat observations were returned.'),
    difference: unavailable('No validated difference product is available. It requires registered images, PSF and background matching, quality masks, and propagated noise.'),
    lightcurve: lightCurveGroup
      ? { state: 'available', reason: `Validated live photometry shares detector, release, exposure class, wavelength, and bandwidth (${lightCurveGroup.toUpperCase()}).` }
      : unavailable(measurements.length
        ? 'Fewer than three quality-approved measurements share a detector, release, exposure class, effective wavelength, and bandwidth over a positive time baseline.'
        : 'No validated source photometry is attached to this query. The native photometry pipeline is not enabled, and browse images are not used to infer flux.'),
    phaseFold: unavailable('Requires a validated same-channel light curve with uncertainties and enough baseline.'),
    spectrum: unavailable(spectrumPoints.length >= 2
      ? 'Photometry is present, but these points span multiple exposures; time-coherent spectral grouping is not yet validated.'
      : 'Detector channels are present, but this query has no validated source-spectrum measurements. Raw image channels are not a measured spectrum.'),
  }
}
