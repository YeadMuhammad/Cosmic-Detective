// Acceptance suite for the SPHEREx metadata registry (PLAN.md item 2).
//
// The fixtures (data/spherex/registry/acceptance-fixtures.json) are generated
// by scripts/build-spherex-registry.mjs FROM the archive metadata snapshot —
// their expected capabilities are derived, never hand-asserted. These tests
// close the loop:
//   1. re-derive every target's frames and capabilities from the committed
//      snapshot and require them to match the fixtures exactly;
//   2. require registry.json to agree with the snapshot-derived groups;
//   3. unit-check the adapter's parsing, grouping and wavelength-tier rules.
//
// Run: node --test scripts/acceptance.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  applyManifestWavelengths,
  buildRegistryTarget,
  framesFromGroups,
  groupObservations,
  parseObservation,
  parseSnapshot,
} from '../src/lib/irsa.ts'
import { capabilitiesFor } from '../src/lib/spherex.ts'

const ROOT = new URL('..', import.meta.url)
const readJson = async (rel) => JSON.parse(await readFile(new URL(rel, ROOT), 'utf8'))

const loadEnvironment = async () => {
  const [snapshot, registry, fixtures, manifest] = await Promise.all([
    readJson('data/spherex/registry/snapshot.json'),
    readJson('data/spherex/registry/registry.json'),
    readJson('data/spherex/registry/acceptance-fixtures.json'),
    readJson('data/spherex/manifest.json').catch(() => ({ tiles: {} })),
  ])
  return { snapshot, registry, fixtures, manifestTiles: manifest?.tiles ?? {} }
}

test('fixture expected capabilities are re-derived from the snapshot (not hand-asserted)', async () => {
  const { snapshot, fixtures, manifestTiles } = await loadEnvironment()
  const targetIds = Object.keys(fixtures.targets)
  assert.equal(targetIds.length, 10, 'all ten seed targets must have acceptance fixtures')
  for (const id of ['barnard', 'epsilon-indi-b', 'wise-0855', 'rw-aurigae', 'r-draconis']) {
    assert.ok(fixtures.targets[id], `seed target "${id}" must have acceptance fixtures`)
  }
  for (const [id, fixture] of Object.entries(fixtures.targets)) {
    const snap = snapshot.targets[id]
    assert.ok(snap, `snapshot must cover fixture target "${id}"`)
    const target = buildRegistryTarget(snap.meta, snap.rows, manifestTiles)
    const frames = framesFromGroups(target.groups)
    assert.deepEqual(frames, fixture.frames, `frames for "${id}" must follow ${snapshot.capturedAt} snapshot rows`)
    assert.equal(frames.length, fixture.frames.length)
    assert.deepEqual(capabilitiesFor(frames), fixture.expectedCapabilities, `capabilities for "${id}" must derive from the snapshot`)
    assert.equal(snap.rows.length, fixture.snapshotRows, `snapshot row count for "${id}" must match`)
  }
})

test('registry.json matches snapshot-derived groups and metadata', async () => {
  const { snapshot, registry, manifestTiles } = await loadEnvironment()
  assert.equal(registry.snapshotCapturedAt, snapshot.capturedAt, 'registry must record its snapshot')
  assert.equal(registry.adapter, snapshot.adapter)
  for (const id of Object.keys(snapshot.targets)) {
    const snap = snapshot.targets[id]
    const target = buildRegistryTarget(snap.meta, snap.rows, manifestTiles)
    const stored = registry.targets[id]
    assert.ok(stored, `registry must cover snapshot target "${id}"`)
    assert.deepEqual(stored.groups, target.groups, `groups for "${id}" must be snapshot-derived`)
    assert.equal(stored.truncated, snap.truncated, `truncation for "${id}" must follow the snapshot`)
    assert.equal(stored.summary.groups, target.summary.groups)
    assert.equal(stored.summary.items, target.summary.items)
  }
})

test('adapter parses IRSA artifact URIs into footprint/channel/release/pass/time', () => {
  const uri = 'https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/' +
    '2025W35_1A/l2b-v21-2025-270/2/level2_2025W35_1A_0658_2D1_spx_l2b-v21-2025-270.fits'
  const observation = parseObservation({
    uri,
    t_lo: '60800.1',
    t_hi: '60800.2',
    band: 'SPHEREx-D1',
    e_lo: '7.700000000000000E-7',
    e_hi: '1.100000000000000E-6',
  })
  assert.ok(observation)
  assert.equal(observation.obsId, '2025W35_1A_0658_2')
  assert.equal(observation.band, 'D1')
  assert.equal(observation.collection, 'qr3')
  assert.equal(observation.release, 'l2b-v21-2025-270')
  assert.equal(observation.surveyPass, '1A')
  assert.equal(observation.surveyWeek, '2025W35')
  assert.equal(observation.section, '0658')
  assert.equal(observation.mjdStart, 60800.1)
  assert.deepEqual(observation.wavelengthBoundsUm, [0.77, 1.1], 'CAOM metres convert to microns')
})

test('groups fold reprocessings and prefer the best release', () => {
  const base = {
    uri: 'unused', obsId: '2025W35_1A_0658_1', band: 'D1', surveyPass: '1A', surveyWeek: '2025W35',
    section: '0658', mjdStart: 60800, mjdEnd: 60800.2, mjdMid: 60800.1, wavelengthBoundsUm: null,
  }
  const group = groupObservations([
    { ...base, uri: 'a', collection: 'qr2', release: 'l2b-v20-2025-269' },
    { ...base, uri: 'b', collection: 'qr3', release: 'l2b-v21-2025-270' },
    { ...base, uri: 'c', collection: 'qr3', release: 'l2b-v21-2025-270' },
  ])
  assert.equal(group.length, 1, 'same footprint, channel and exposure fold into one group')
  assert.deepEqual(group[0].releases.map((r) => [r.collection, r.release, r.observations]), [
    ['qr3', 'l2b-v21-2025-270', 2],
    ['qr2', 'l2b-v20-2025-269', 1],
  ], 'later collections and releases are preferred')
  const frames = framesFromGroups(group)
  assert.equal(frames.length, 1)
  assert.match(frames[0].release, /qr3/)
})

test('wavelength at the target pixel comes only from a WCS-WAVE evaluation', () => {
  const observation = parseObservation(TABLE_ROW)
  assert.ok(observation)
  const tagged = applyManifestWavelengths([structuredClone(observation)], {
    tile: { epochs: { a: { obsId: observation.obsId, band: observation.band, wavelengthAtTargetUm: 0.9123 } } },
  })
  assert.equal(tagged[0].wavelengthTier, 'wcs-wave')
  assert.equal(tagged[0].wavelengthAtTargetUm, 0.9123)
  const untagged = applyManifestWavelengths([structuredClone(observation)], {})
  assert.equal(untagged[0].wavelengthTier, 'plane-bounds')
  assert.equal(untagged[0].wavelengthAtTargetUm, null)
  const boundsOnly = applyManifestWavelengths([structuredClone(observation)], {
    tile: { epochs: { a: { obsId: observation.obsId, band: observation.band, wavelengthAtTargetUm: null } } },
  })
  assert.equal(boundsOnly[0].wavelengthTier, 'plane-bounds', 'plane bounds never count as target-pixel values')
})

const TABLE_ROW = {
  uri: 'level2_2025W17_4B_0136_1D2_spx_l2b-v20-2025-240.fits',
  t_lo: '60790.63', t_hi: '60790.64', band: 'SPHEREx-D2', e_lo: '1.10e-6', e_hi: '1.65e-6',
}
