import type { ObservationMetadata, SourceMeasurement, SourceSpectrumPoint } from './spherex'

export interface ImportedIRSAResult {
  target: { ra: number; dec: number }
  observations: ObservationMetadata[]
  rows: number
  rejected: number
  source: 'IRSA SPHEREx Spectrophotometry Tool'
}

const requiredColumns = ['wavelength', 'flux', 'flux_err', 'lambda_width', 'flags', 'fit_ql', 'mjd', 'data_collection', 'det_id', 'lvf_id', 'ra', 'dec']
const EXPECTED_UNITS: Record<string, string[]> = {
  wavelength: ['um', 'micron', 'microns'],
  flux: ['ujy'],
  flux_err: ['ujy'],
  lambda_width: ['um', 'micron', 'microns'],
  mjd: ['d', 'day', 'days', 'mjd'],
  ra: ['deg', 'degree'],
  dec: ['deg', 'degree'],
}
const NOMINAL_FLAGS = new Set([0, 2 ** 21])

function finite(value: string, field: string): number {
  const parsed = Number(value)
  if (!value || !Number.isFinite(parsed)) throw new Error(`IRSA result has an invalid ${field} value.`)
  return parsed
}

function unitsMatch(field: string, unit: string | null): boolean {
  const allowed = EXPECTED_UNITS[field]
  const normalized = unit?.trim().toLowerCase().replace(/[\u00b5\u03bc]/g, 'u').replace(/^[^a-z]+/, '')
  return !allowed || (!!normalized && allowed.includes(normalized))
}

/** Parse the IRSA Spectrophotometry VOTable export, rejecting incomplete schemas. */
export function parseIRSASpectrophotometry(xml: string, expected: { ra: number; dec: number }): ImportedIRSAResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Selected file is not a readable XML VOTable.')
  if (doc.documentElement.localName !== 'VOTABLE') throw new Error('Selected XML document is not a VOTable export.')
  const elements = [...doc.getElementsByTagName('*')]
  const queryStatus = elements.find((el) => el.localName === 'INFO' && el.getAttribute('name') === 'QUERY_STATUS')
  if (queryStatus?.getAttribute('value') === 'ERROR') throw new Error(queryStatus.textContent?.trim() || 'IRSA reported an error in this result.')
  const fields = elements.filter((el) => el.localName === 'FIELD')
  const names = fields.map((field) => (field.getAttribute('name') || field.getAttribute('ID') || '').trim().toLowerCase())
  const indexes = new Map(names.map((name, index) => [name, index]))
  const missing = requiredColumns.filter((name) => !indexes.has(name))
  if (missing.length) throw new Error(`IRSA VOTable is missing required columns: ${missing.join(', ')}.`)
  for (const name of requiredColumns) {
    const field = fields[indexes.get(name)!]
    if (!unitsMatch(name, field.getAttribute('unit'))) throw new Error(`Unexpected or missing unit for IRSA ${name}; expected ${EXPECTED_UNITS[name]?.join(' or ') ?? 'a documented unit'}.`)
  }
  const table = elements.find((el) => el.localName === 'TABLEDATA')
  if (!table) throw new Error('IRSA VOTable must contain TABLEDATA; this result serialization is not supported.')
  const trs = [...table.getElementsByTagName('*')].filter((el) => el.localName === 'TR')
  if (!trs.length) throw new Error('IRSA VOTable contains no photometry rows.')

  const observations: ObservationMetadata[] = []
  const exposures = new Set<string>()
  let rejected = 0
  for (const tr of trs) {
    const cells = [...tr.getElementsByTagName('*')].filter((el) => el.localName === 'TD').map((td) => td.textContent?.trim() ?? '')
    const get = (name: string) => cells[indexes.get(name)!] ?? ''
    const wavelength = finite(get('wavelength'), 'wavelength')
    const flux = finite(get('flux'), 'flux')
    const uncertainty = finite(get('flux_err'), 'flux uncertainty')
    const width = finite(get('lambda_width'), 'bandwidth')
    const mjd = finite(get('mjd'), 'MJD')
    const ra = finite(get('ra'), 'RA')
    const dec = finite(get('dec'), 'Dec')
    const flags = finite(get('flags'), 'flags')
    const fitQuality = finite(get('fit_ql'), 'fit quality')
    const release = get('data_collection').toLowerCase()
    const detector = get('det_id').toUpperCase()
    const exposure = get('lvf_id')
    if (!(wavelength > 0 && width > 0 && uncertainty > 0 && Number.isInteger(flags) && flags >= 0 && fitQuality >= 0)) {
      throw new Error('IRSA VOTable contains physically invalid wavelength, bandwidth, uncertainty, flags, or fit quality.')
    }
    if (!['qr2', 'qr3'].includes(release) || !/^D[1-6]$/.test(detector) || !exposure) {
      throw new Error('IRSA VOTable contains unsupported release, detector, or exposure provenance.')
    }
    const exposureKey = `${release}:${detector}:${exposure}`
    if (exposures.has(exposureKey)) throw new Error(`IRSA VOTable repeats exposure ${exposureKey}; duplicate points cannot be treated as independent measurements.`)
    exposures.add(exposureKey)
    const deltaRa = ((ra - expected.ra + 540) % 360) - 180
    const angularOffsetArcsec = Math.hypot(deltaRa * Math.cos(expected.dec * Math.PI / 180), dec - expected.dec) * 3600
    if (angularOffsetArcsec > 6) {
      throw new Error('IRSA result target does not match the portal coordinate (tolerance: 6 arcsec, approximately one SPHEREx pixel).')
    }
    const usable = NOMINAL_FLAGS.has(flags)
    if (!usable) rejected += 1
    const time = (mjd - 40587) * 86400000
    const provenance = { provider: 'irsa-spherex-photometry' as const, release: release as 'qr2' | 'qr3', detector, exposureId: exposure }
    const measurement: SourceMeasurement = { dataOrigin: 'live', provenance, band: detector, time, wavelength, bandwidth: width, flux, uncertainty, usable, flags, fitQuality }
    const spectrum: SourceSpectrumPoint = { dataOrigin: 'live', provenance, wavelength, bandwidth: width, flux, uncertainty, usable, flags, fitQuality }
    observations.push({ band: detector, release, time, wavelength, position: { ra, dec }, measurement, spectrum: [spectrum] })
  }
  if (!observations.some((observation) => observation.measurement?.usable)) {
    throw new Error('No rows have nominal IRSA photometry flags (0 or SOURCE only); the result cannot enable analysis.')
  }
  return { target: expected, observations, rows: observations.length, rejected, source: 'IRSA SPHEREx Spectrophotometry Tool' }
}
