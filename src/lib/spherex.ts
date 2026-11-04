export type CapabilityState = 'available' | 'unavailable' | 'computing'
export type CapabilityId = 'blink' | 'difference' | 'lightcurve' | 'phaseFold' | 'spectrum'

export interface ObservationMetadata {
  band: string
  release: string
  time: number
  wavelength?: number
}

export interface Capability {
  state: CapabilityState
  reason: string
}

export type Capabilities = Record<CapabilityId, Capability>

const unavailable = (reason: string): Capability => ({ state: 'unavailable', reason })

/** Metadata-only gating. No FITS pixels or photometry are treated as available here. */
export function capabilitiesFor(frames: ObservationMetadata[]): Capabilities {
  const bands = new Set(frames.map((frame) => frame.band))
  const timed = frames.filter((frame) => Number.isFinite(frame.time))
  const sameChannel = [...new Set(frames.map((frame) => frame.band))]
    .some((band) => timed.filter((frame) => frame.band === band).length >= 2)

  return {
    blink: unavailable(sameChannel
      ? 'Repeat metadata exists, but aligned pixels and astrometric validation are not available.'
      : 'No same-channel repeat observations were returned.'),
    difference: unavailable('Requires validated alignment, PSF matching, and quality masks; browse mode does not provide these.'),
    lightcurve: unavailable('Source photometry has not been extracted from the returned observations.'),
    phaseFold: unavailable('Requires a validated same-channel light curve with uncertainties and enough baseline.'),
    spectrum: bands.size >= 2
      ? { state: 'available', reason: `${bands.size} detector channels are represented; cross-channel data are a spectrum, not a time series.` }
      : unavailable('At least two detector channels are needed to present a spectrum.'),
  }
}
