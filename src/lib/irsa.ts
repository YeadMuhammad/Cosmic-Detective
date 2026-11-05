/**
 * IRSA SPHEREx metadata adapter.
 *
 * Pure functions that turn raw IRSA TAP rows (spherex.artifact JOIN spherex.plane,
 * as used by scripts/build-spherex-registry.mjs and scripts/fetch-spherex.mjs) into
 * the registry used for capability gating and the per-target acceptance fixtures.
 *
 * Three layers have one source of truth each:
 *   - snapshot   — timed archive metadata fetches, verbatim TAP rows (data/spherex/registry/snapshot.json)
 *   - registry   — adapter output: observations grouped by footprint, channel, release,
 *                  survey pass and time (data/spherex/registry/registry.json)
 *   - fixtures   — per-target expected capabilities DERIVED from the snapshot, never
 *                  hand-asserted (data/spherex/registry/acceptance-fixtures.json)
 *
 * No network and no DOM code may live in this module: it runs in the browser build,
 * the Node build scripts and the node --test acceptance suite.
 */
import type { ObservationMetadata } from './spherex'

export type RegistryTargetKind = 'named' | 'deep-field' | 'ecliptic-pole'

export interface RegistryTargetMeta {
  id: string
  label: string
  kind: RegistryTargetKind
  ra: number
  dec: number
  /** Half-width of the metadata query cone, in degrees. */
  radiusDeg: number
}

/** One verbatim row of the snapshot's TAP CSV for one target. */
export interface TapRow {
  uri: string
  t_lo: string
  t_hi?: string
  band?: string
  e_lo?: string
  e_hi?: string
}

/** Timestamped archive metadata snapshot (immutable once written). */
export interface MetadataSnapshot {
  adapter: 'irsa-tap-spherex-v1'
  irsaRoot: string
  capturedAt: string
  perTargetMaxRows: number
  /** True when a target hit the TAP row limit; its groups cover a partial set. */
  truncatedTargets: string[]
  targets: Record<string, { meta: RegistryTargetMeta; truncated: boolean; rows: TapRow[] }>
}

export interface RegistryObservation {
  uri: string
  /** IRSA file obsId without detector band and release, e.g. `2025W35_1A_0658_1`. */
  obsId: string
  /** SPHEREx detector channel, `D1`..`D6`. */
  band: string
  /** L2B processing release, e.g. `l2b-v20-2025-269`. */
  release: string
  /** IRSA collection, `qr2` | `qr3` (no hard-coded list). */
  collection: string
  /** Survey pass parsed from the obsId, e.g. `4B`. */
  surveyPass: string
  /** Survey week parsed from the obsId, e.g. `2025W35`. */
  surveyWeek: string
  section: string | null
  mjdStart: number
  mjdEnd: number | null
  mjdMid: number
  /**
   * Plane-level energy bounds in microns. Coarse: SPHEREx's linear variable
   * filters mean this describes the whole detector band, not the target pixel.
   */
  wavelengthBoundsUm: [number, number] | null
}

export interface ReleasePick {
  collection: string
  release: string
  observations: number
  mjdStart: number
  mjdEnd: number | null
}

/** Observations of one footprint+channel, folded across reprocessings. */
export interface ObservationGroup {
  key: string
  obsId: string
  /** Detector channel D1..D6 (each SPHEREx detector array is one channel). */
  channel: string
  surveyPass: string
  surveyWeek: string
  /** Ordered best-release first; entries whose sections differ are kept separate. */
  releases: ReleasePick[]
  mjdStart: number
  mjdEnd: number | null
  truncated: boolean
}

export interface ChannelSummary {
  channel: string
  observations: number
  groups: number
  firstMjd: number
  lastMjd: number
}

export interface TargetSummary {
  items: number
  groups: number
  channels: ChannelSummary[]
  surveyPasses: string[]
  collections: string[]
  releases: string[]
  timeSpanMjd: [number, number] | null
  wavelength: { tierPlaneBounds: number; tierWcsWave: number; withBounds: number }
}

export interface RegistryTarget {
  meta: RegistryTargetMeta
  truncated: boolean
  observations: SourceObservation[]
  groups: ObservationGroup[]
  summary: TargetSummary
  /**
   * Wavelength at the target pixel. Only here when a pixel-level evaluation
   * exists: either fetched from the manifest (Astropy WCS-WAVE) or never set.
   */
  wavelengthAtTargetUm: number | null
  wavelengthTier: 'plane-bounds' | 'wcs-wave'
}

/* ------------------------------------------------------------------ parsing */

/**
 * `level2_2025W35_1A_0658_1D1_spx_l2b-v20-2025-269.fits` ->
 *   core `2025W35_1A_0658_1`, band `D1`, release `l2b-v20-2025-269`.
 */
const FILENAME_RE = /^level2_(\d{4}W\d{1,2})_(\d[AB])_(\w+?)_(\d+)D([1-6])_spx_(l2[a-z]\d*-.+?)\.fits$/i

function toMicrons(x: string | undefined): number | null {
  const n = parseFloat(String(x ?? ''))
  if (!Number.isFinite(n)) return null
  // CAOM energy bounds are metres; tolerate values already in microns.
  return n < 1e-3 ? n * 1e6 : n
}

/** One TAP row -> registry observation. Returns null when the row is unusable. */
export function parseObservation(row: TapRow): RegistryObservation | null {
  const uri = (row.uri ?? '').trim()
  if (!uri || !/\.fits/i.test(uri)) return null
  const m = FILENAME_RE.exec(decodeURIComponent(uri.split('?')[0].split('/').pop() ?? ''))
  if (!m) return null
  const mjdStart = parseFloat(row.t_lo)
  if (!Number.isFinite(mjdStart)) return null
  const mjdEnd = parseFloat(row.t_hi ?? '')
  const mjdMid = Number.isFinite(mjdEnd) ? (mjdStart + mjdEnd) / 2 : mjdStart
  const wlLo = toMicrons(row.e_lo)
  const wlHi = toMicrons(row.e_hi)
  const collection = /\/spherex\/(qr\d+)\//i.exec(uri)?.[1]?.toLowerCase() ?? ''
  return {
    uri,
    obsId: `${m[1]}_${m[2]}_${m[3]}_${m[4]}`,
    band: `D${m[5]}`,
    release: m[6],
    collection,
    surveyPass: m[2],
    surveyWeek: m[1],
    section: m[3] ?? null,
    mjdStart,
    mjdEnd: Number.isFinite(mjdEnd) ? mjdEnd : null,
    mjdMid,
    wavelengthBoundsUm: wlLo !== null && wlHi !== null ? [wlLo, wlHi] : null,
  }
}

export function parseSnapshot(rows: TapRow[]): SourceObservation[] {
  const seen = new Set<string>()
  const observations: SourceObservation[] = []
  for (const row of rows) {
    const observation = parseObservation(row)
    if (!observation || seen.has(observation.uri)) continue
    seen.add(observation.uri)
    observations.push(observation)
  }
  observations.sort((a, b) => a.mjdMid - b.mjdMid || a.obsId.localeCompare(b.obsId) || a.uri.localeCompare(b.uri))
  return observations
}

/* ------------------------------------------------------------------- groups */
/**
 * Groups observations by footprint, detector channel, processing release and
 * survey pass/time. Key = obsId|channel: an obsId pins the footprint, survey
 * pass and time together (it encodes week, pass, section and map index), the
 * channel is the detector array. Re-later reprocessings of the same exposure
 * appear as additional entries of the same group, ordered best-release first.
 */
export function groupObservations(observations: RegistryObservation[]): ObservationGroup[] {
  const map = new Map<string, ObservationGroup>()
  for (const observation of observations) {
    const key = `${observation.obsId}|${observation.band}`
    let group = map.get(key)
    if (!group) {
      group = {
        key,
        obsId: observation.obsId,
        channel: observation.band,
        surveyPass: observation.surveyPass,
        surveyWeek: observation.surveyWeek,
        releases: [],
        mjdStart: observation.mjdStart,
        mjdEnd: observation.mjdEnd,
        truncated: false,
      }
      map.set(key, group)
    }
    const releasePick = group.releases.find((r) => r.collection === observation.collection && r.release === observation.release)
    if (releasePick) {
      releasePick.observations += 1
      if (group.mjdEnd === null && observation.mjdEnd !== null) group.mjdEnd = observation.mjdEnd
    } else {
      group.releases.push({
        collection: observation.collection,
        release: observation.release,
        observations: 1,
        mjdStart: observation.mjdStart,
        mjdEnd: observation.mjdEnd,
      })
    }
  }
  const groups = [...map.values()]
  for (const group of groups) {
    // Higher QR collection first, then the numerically latest L2B release.
    group.releases.sort((a, b) =>
      b.collection.localeCompare(a.collection, undefined, { numeric: true }) ||
      b.release.localeCompare(a.release, undefined, { numeric: true }))
  }
  groups.sort((a, b) => a.mjdStart - b.mjdStart || a.key.localeCompare(b.key))
  return groups
}

/** Summary block for one registry target. */
export function summarizeTarget(observations: SourceObservation[], groups: ObservationGroup[]): TargetSummary {
  const byChannel = new Map<string, ChannelSummary>()
  for (const group of groups) {
    const count = group.releases.reduce((sum, r) => sum + r.observations, 0)
    let summary = byChannel.get(group.channel)
    if (!summary) {
      summary = { channel: group.channel, observations: 0, groups: 0, firstMjd: group.mjdStart, lastMjd: group.mjdStart }
      byChannel.set(group.channel, summary)
    }
    summary.observations += count
    summary.groups += 1
    summary.firstMjd = Math.min(summary.firstMjd, group.mjdStart)
    summary.lastMjd = Math.max(summary.lastMjd, group.mjdEnd ?? group.mjdStart)
  }
  const mjdMin = Math.min(...observations.map((o) => o.mjdStart))
  const mjdMax = Math.max(...observations.map((o) => o.mjdEnd ?? o.mjdStart))
  return {
    items: observations.length,
    groups: groups.length,
    channels: [...byChannel.values()].sort((a, b) => Number(a.channel.slice(1)) - Number(b.channel.slice(1))),
    surveyPasses: [...new Set(observations.map((o) => o.surveyPass))].sort(),
    collections: [...new Set(observations.map((o) => o.collection))].sort(),
    releases: [...new Set(observations.map((o) => o.release))].sort(),
    timeSpanMjd: observations.length ? [mjdMin, mjdMax] : null,
    wavelength: observations.reduce((acc, o) => {
      if (o.wavelengthTier === 'wcs-wave') acc.tierWcsWave += 1
      else acc.tierPlaneBounds += 1
      if (o.wavelengthBoundsUm) acc.withBounds += 1
      return acc
    }, { tierPlaneBounds: 0, tierWcsWave: 0, withBounds: 0 }),
  }
}

export const MJD_MS_EPOCH = 40587 * 86400000

/**
 * Metadata frames for `capabilitiesFor`: one entry per footprint+channel group,
 * using the best available processing release of that group (later collections
 * win, then the latest release within the collection).
 */
export function framesFromGroups(groups: ObservationGroup[]): ObservationMetadata[] {
  return groups.map((group) => {
    const preferred = group.releases[0]
    const mjdMid = preferred.mjdEnd !== null ? (preferred.mjdStart + preferred.mjdEnd) / 2 : preferred.mjdStart
    return {
      band: group.channel,
      release: `${group.surveyWeek}/${preferred.collection}/${preferred.release}`,
      time: (mjdMid - 40587) * 86400000,
    }
  }).sort((a, b) => a.time - b.time || a.band.localeCompare(b.band))
}

/* --------------------------------------------------- manifest verification */

interface ManifestEpochLike {
  obsId?: string
  band?: string
  wavelengthAtTargetUm?: number | null
  wavelengthVerified?: boolean | null
}

/**
 * Fills `wavelengthAtTargetUm` on observations whose cutout wavelength was
 * evaluated at the target pixel (Astropy WCS-WAVE via scripts/fetch-spherex.py).
 * Only pixel-level values may set the `wcs-wave` tier; plane-level bounds stay
 * coarse. Mutates and returns the observations.
 */
export function applyManifestWavelengths<T extends { obsId: string; band: string; wavelengthTier?: 'plane-bounds' | 'wcs-wave'; wavelengthAtTargetUm?: number | null }>(
  observations: T[],
  manifestTiles: Record<string, { epochs?: { a?: ManifestEpochLike; b?: ManifestEpochLike } }>,
): T[] {
  for (const observation of observations) {
    observation.wavelengthTier = 'plane-bounds'
    observation.wavelengthAtTargetUm = null
  }
  for (const tile of Object.values(manifestTiles ?? {})) {
    for (const epoch of [tile?.epochs?.a, tile?.epochs?.b]) {
      if (!epoch?.obsId || !epoch.band || !Number.isFinite(epoch.wavelengthAtTargetUm)) continue
      for (const observation of observations) {
        if (observation.obsId === epoch.obsId && observation.band === epoch.band) {
          observation.wavelengthAtTargetUm = epoch.wavelengthAtTargetUm as number
          observation.wavelengthTier = 'wcs-wave'
        }
      }
    }
  }
  return observations
}

export interface WavelengthVerifiedObservation extends RegistryObservation {
  wavelengthTier: 'plane-bounds' | 'wcs-wave'
  wavelengthAtTargetUm: number | null
}

/**
 * Registry observations carry the wavelength tier: 'plane-bounds' until a
 * pixel-level WCS-WAVE evaluation exists for that exposure, 'wcs-wave' after.
 */
export type SourceObservation = RegistryObservation & {
  wavelengthTier?: WavelengthVerifiedObservation['wavelengthTier']
  wavelengthAtTargetUm?: number | null
}

/* ------------------------------------------------------------ registry move */

export function buildRegistryTarget(
  meta: RegistryTargetMeta,
  rows: TapRow[],
  manifestTiles?: Record<string, unknown>,
): RegistryTarget {
  const observations = parseSnapshot(rows)
  if (manifestTiles) applyManifestWavelengths(observations, manifestTiles as never)
  const groups = groupObservations(observations)
  const summary = summarizeTarget(observations, groups)
  const verified = observations.filter((observation) => observation.wavelengthTier === 'wcs-wave' && Number.isFinite(observation.wavelengthAtTargetUm))
  return {
    meta,
    truncated: false,
    observations,
    groups,
    summary,
    wavelengthAtTargetUm: verified.length ? Math.min(...verified.map((o) => o.wavelengthAtTargetUm!)) : null,
    wavelengthTier: verified.length ? 'wcs-wave' : 'plane-bounds',
  }
}

/** Given manually verified pixel observations */
export function wavelengthTierFor(observations: SourceObservation[]): 'plane-bounds' | 'wcs-wave' {
  return observations.some((observation) => observation.wavelengthTier === 'wcs-wave' && Number.isFinite(observation.wavelengthAtTargetUm)) ? 'wcs-wave' : 'plane-bounds'
}
