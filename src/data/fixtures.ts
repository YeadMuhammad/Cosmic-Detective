// All demo content lives here. Sky tiles are REAL archival images fetched from
// NASA SkyView (see scripts/fetch-sky.mjs). Leaderboard players and community
// totals are illustrative demo fixtures and are labelled as such in the UI.
// A later milestone swaps these for the data, verification and consensus services.

export type TileKind = 'mover' | 'stationary' | 'halo' | 'blend' | 'galaxy' | 'cluster'

export interface Tile {
  id: string
  code: string
  name: string // field label shown after review
  kind: TileKind
  ra: number // tile centre, degrees J2000
  dec: number
  size: number // field of view, degrees
  /** normalised pixel position of the moving source in epoch A / epoch B */
  a?: [number, number]
  b?: [number, number]
  catalog?: { name: string; alias: string; pm: string; distance: string; note: string }
  rejectNote?: string
}

const p = (x: number, y: number): [number, number] => [x / 512, y / 512]

export const TILES: Record<string, Tile> = {
  barnard: {
    id: 'barnard', code: 'OPH-0417', name: "Barnard's Star field", kind: 'mover', ra: 269.4587, dec: 4.609, size: 0.25,
    a: p(247, 372), b: p(266, 132),
    catalog: { name: "Barnard's Star", alias: 'Gliese 699 · HIP 87937', pm: '10.39″ / yr', distance: '5.96 light-years', note: 'Highest known proper motion of any star seen from Earth. A red dwarf, catalogued by E. E. Barnard in 1916.' },
  },
  groombridge1830: {
    id: 'groombridge1830', code: 'UMA-1182', name: 'Groombridge 1830 field', kind: 'mover', ra: 178.2041, dec: 37.7654, size: 0.16,
    a: p(328, 152), b: p(163, 390),
    catalog: { name: 'Groombridge 1830', alias: 'HD 103095 · Gliese 451', pm: '7.06″ / yr', distance: '29.9 light-years', note: 'A fast-moving, metal-poor halo star passing through the solar neighbourhood.' },
  },
  lalande21185: {
    id: 'lalande21185', code: 'UMA-1103', name: 'Lalande 21185 field', kind: 'mover', ra: 165.8404, dec: 36.0083, size: 0.12,
    a: p(243, 155), b: p(271, 374),
    catalog: { name: 'Lalande 21185', alias: 'Gliese 411 · HD 95735', pm: '4.80″ / yr', distance: '8.3 light-years', note: 'One of the brightest red dwarfs in the northern sky. Hosts confirmed planets found by radial velocity.' },
  },
  wolf359: {
    id: 'wolf359', code: 'LEO-1056', name: 'Wolf 359 field', kind: 'mover', ra: 164.1516, dec: 7.0367, size: 0.12,
    a: p(174, 199), b: p(366, 333),
    catalog: { name: 'Wolf 359', alias: 'Gliese 406 · CN Leonis', pm: '4.70″ / yr', distance: '7.9 light-years', note: 'A faint flare star and one of the nearest stars to the Sun. Too dim to see without a telescope.' },
  },
  vanmaanen2: {
    id: 'vanmaanen2', code: 'PSC-0049', name: "van Maanen's Star field", kind: 'mover', ra: 12.2813, dec: 5.4104, size: 0.08,
    a: p(293, 171), b: p(205, 368),
    catalog: { name: "van Maanen's Star", alias: 'van Maanen 2 · Gliese 35', pm: '2.98″ / yr', distance: '14.1 light-years', note: 'The closest known solitary white dwarf, discovered by Adriaan van Maanen in 1917.' },
  },
  'field-oph': { id: 'field-oph', code: 'OPH-0442', name: 'Ophiuchus star field', kind: 'stationary', ra: 270.62, dec: 5.02, size: 0.15, rejectNote: 'Same source in both epochs. No real motion detected.' },
  'field-aql': { id: 'field-aql', code: 'AQL-1900', name: 'Aquila Milky Way field', kind: 'stationary', ra: 285.0, dec: 5.0, size: 0.15, rejectNote: 'Dense field, but every source holds its position. Brightness differences come from the plate emulsion, not motion.' },
  'field-leo': { id: 'field-leo', code: 'LEO-1002', name: 'Leo high-latitude field', kind: 'stationary', ra: 150.5, dec: 20.2, size: 0.15, rejectNote: 'Sparse field with no displaced sources. A clean tile.' },
  m13: { id: 'm13', code: 'HER-1641', name: 'Messier 13 (globular cluster)', kind: 'cluster', ra: 250.4235, dec: 36.4613, size: 0.2, rejectNote: 'Hundreds of thousands of stars blended into one glow. Crowding changes between plates, but nothing moved.' },
  m51: { id: 'm51', code: 'CVN-1329', name: 'Messier 51 (Whirlpool Galaxy)', kind: 'galaxy', ra: 202.4696, dec: 47.1952, size: 0.2, rejectNote: 'An extended galaxy 31 million light-years away. Far too distant to show motion across decades.' },
  vega: { id: 'vega', code: 'LYR-1836', name: 'Vega (saturated plate)', kind: 'halo', ra: 279.2347, dec: 38.7837, size: 0.2, rejectNote: 'Glow from a very bright star saturated the early plate. Image artifact, not a real object.' },
  albireo: { id: 'albireo', code: 'CYG-1930', name: 'Albireo (bright double)', kind: 'blend', ra: 292.6804, dec: 27.9597, size: 0.06, rejectNote: 'Two overlapping bright sources plus diffraction spikes. Blend and halo, not a real change.' },
}

export const TILE_IMG = (id: string, epoch: 'a' | 'b') => `/sky/${id}-${epoch}.jpg`

export const BARNARD_BANDS = [
  { key: 'dss1b', label: 'DSS1 Blue', wl: '0.45 µm', era: '1950s', file: '/sky/barnard-dss1b.jpg', tint: '#7fb7ff' },
  { key: 'dss2r', label: 'DSS2 Red', wl: '0.65 µm', era: '1990s', file: '/sky/barnard-dss2r.jpg', tint: '#ff8a6b' },
  { key: '2massj', label: '2MASS J', wl: '1.25 µm', era: '1998–2000', file: '/sky/barnard-2massj.jpg', tint: '#ffc56b' },
  { key: '2massk', label: '2MASS Ks', wl: '2.16 µm', era: '1998–2000', file: '/sky/barnard-2massk.jpg', tint: '#ff9f40' },
  { key: 'w1', label: 'WISE W1', wl: '3.4 µm', era: '2010', file: '/sky/barnard-w1.jpg', tint: '#e58ad6' },
  { key: 'w2', label: 'WISE W2', wl: '4.6 µm', era: '2010', file: '/sky/barnard-w2.jpg', tint: '#c06bff' },
]

// ---------------------------------------------------------------- ranks
export interface Rank { n: number; title: string; tiles: number; weight: number; level: number }
export const RANKS: Rank[] = [
  { n: 1, title: 'Learner', tiles: 0, weight: 1.0, level: 1 },
  { n: 2, title: 'Field Analyst', tiles: 200, weight: 1.4, level: 11 },
  { n: 3, title: 'Sky Inspector', tiles: 320, weight: 2.1, level: 21 },
  { n: 4, title: 'Deep Space Lead', tiles: 420, weight: 2.9, level: 31 },
  { n: 5, title: 'Master Investigator', tiles: 500, weight: 4.0, level: 41 },
]
export const rankFor = (tiles: number) => [...RANKS].reverse().find((r) => tiles >= r.tiles)!
export const nextRank = (tiles: number) => RANKS.find((r) => r.tiles > tiles)

// ---------------------------------------------------------------- tools
export type ToolId = 'blink' | 'diff' | 'bands' | 'lightcurve' | 'suite'
export const TOOLS: { id: ToolId; name: string; chapter: number; blurb: string; real: string }[] = [
  { id: 'blink', name: 'Blink Comparator', chapter: 1, blurb: 'Toggle between two exposures. A moving object appears to jump.', real: 'Alternates two registered, wavelength-matched images.' },
  { id: 'diff', name: 'Difference Imaging', chapter: 2, blurb: 'One image showing only what changed between exposures.', real: 'Subtracts one registered frame from another.' },
  { id: 'bands', name: 'Sector Map & Multi-Band Compositor', chapter: 3, blurb: 'Choose your own coordinates and view them across spectral channels.', real: 'Renders a sky position across multiple wavelength bands.' },
  { id: 'lightcurve', name: 'Light Curve Analyzer', chapter: 4, blurb: 'Plot brightness over time to separate real signals from noise.', real: 'Reads photometry from the mission spectrophotometry tool.' },
  { id: 'suite', name: 'Full Research Suite', chapter: 5, blurb: 'Every tool plus export of a candidate file for professionals.', real: 'Runs the full verification pipeline and prepares a candidate file.' },
]

// ---------------------------------------------------------------- campaign
export interface Chapter { n: number; title: string; arc: string; art: string; tool: ToolId; accent: string }
export const CHAPTERS: Chapter[] = [
  { n: 1, title: 'The Training Grounds', arc: 'Hired to review archived telemetry, you learn to spot genuine moving objects while filtering out noise and artifacts.', art: '/img/ch1.png', tool: 'blink', accent: '#f2a93b' },
  { n: 2, title: 'The Phantom Orbit', arc: 'An anomalous signal near a dense star field. Learn frame subtraction to cancel out the static stars.', art: '/img/ch2.png', tool: 'diff', accent: '#5fc4e8' },
  { n: 3, title: 'The Cold Companion', arc: 'Tracking an object that emits almost no visible light. Choose your own sky sectors and compare bands.', art: '/img/ch3.png', tool: 'bands', accent: '#e58ad6' },
  { n: 4, title: 'The Shattered Record', arc: 'A scattered debris field points to a massive, unseen body. Read brightness over time.', art: '/img/ch4.png', tool: 'lightcurve', accent: '#3ccf91' },
  { n: 5, title: 'Open Sky Research Portal', arc: 'The story concludes. Pick coordinates freely and contribute to the live, ongoing review effort.', art: '/img/ch5.png', tool: 'suite', accent: '#ffd84a' },
]

export interface Level {
  n: number
  chapter: number
  title: string
  briefing: string
  target: string // mandatory tile id
  tiles: string[]
  tutorial?: boolean
}

const ALL = Object.keys(TILES)
const order = (target: string, seed: number) => {
  const rest = ALL.filter((t) => t !== target)
  const out: string[] = []
  let s = seed
  while (rest.length) { s = (s * 9301 + 49297) % 233280; out.push(rest.splice(s % rest.length, 1)[0]) }
  out.splice((seed * 5) % 12, 0, target)
  return out
}

export const PLAYABLE: Level[] = [
  { n: 1, chapter: 1, title: 'A Light That Will Not Stay Still', tutorial: true, target: 'barnard', tiles: order('barnard', 3),
    briefing: 'Archive telemetry has flagged a possible moving source in Ophiuchus. Two photographic plates of the same patch of sky, exposed roughly forty years apart, disagree about one point of light. Dr. Varga will walk you through your first tile.' },
  { n: 2, chapter: 1, title: 'The Bright Deceivers', target: 'groombridge1830', tiles: order('groombridge1830', 7),
    briefing: 'A field in Ursa Major shows one blazing source that is not where the old plate left it. Bright stars lie, though: halos and spikes can fake a change. Trust the evidence, not the first impression.' },
  { n: 3, chapter: 1, title: "Lalande's Drift", target: 'lalande21185', tiles: order('lalande21185', 11),
    briefing: 'The reviewers before you left a note: “something slid south.” Find the source that drifted, and rule out the impostors before you sign your name to it.' },
  { n: 4, chapter: 1, title: 'The Quiet Ember', target: 'vanmaanen2', tiles: order('vanmaanen2', 17),
    briefing: 'A dim source in Pisces. Its motion is small, only a few arcseconds a year, and it hides among faint neighbours. Look closely, then look again.' },
  { n: 11, chapter: 2, title: 'The Phantom Orbit', target: 'wolf359', tiles: order('wolf359', 23),
    briefing: 'An anomalous signal near Leo. Blinking is not enough when the field is busy. Subtract one frame from the other, and let the static stars cancel themselves out.' },
]
export const getLevel = (n: number) => PLAYABLE.find((l) => l.n === n)

export const LEVEL_NAMES: Record<number, string> = {
  5: 'Plate Noise', 6: 'Spikes and Shadows', 7: 'The Faded Emulsion', 8: 'Two Lights, One Star', 9: 'A Crowd in Hercules', 10: 'Graduation Night',
  12: 'Residuals', 13: 'The Galactic Bulge', 14: 'Ghost in the Subtraction', 15: 'Second Witness', 16: 'Registration Error', 17: 'The Long Exposure', 18: 'Against the Grain', 19: 'Echo Track', 20: 'Phantom Unmasked',
  21: 'Below the Red', 22: 'Infrared Whispers', 23: 'Cold Light', 24: 'Brown Ember', 25: 'Spectral Fingerprint', 26: 'Twin Signatures', 27: 'The Dim Partner', 28: 'Band Gap', 29: 'Methane Sky', 30: 'Companion Found',
  31: 'Debris Field', 32: 'Flicker', 33: 'The Steady Pulse', 34: 'Occultation', 35: 'Record Fragments', 36: 'Periodic', 37: 'Noise Floor', 38: 'The Heavy Silence', 39: 'Pull of the Unseen', 40: 'The Record Restored',
  41: 'Open Sky', 42: 'Live Tiles', 43: 'Consensus', 44: 'The Many Eyes', 45: 'Uncharted Sector', 46: 'Weighted Witness', 47: 'Follow-Up Queue', 48: 'Expert Review', 49: 'Night Shift', 50: 'Beyond the Archive',
}

// ---------------------------------------------------------------- verification
export type Verdict = 'accepted' | 'known' | 'rejected-stationary' | 'rejected-halo' | 'pending' | 'candidate' | 'clear' | 'missed'

// ---------------------------------------------------------------- badges
export const BADGES = [
  { id: 'first-flag', name: 'First Witness', desc: 'Submit your first verified flag.' },
  { id: 'barnard', name: 'Runaway Star', desc: "Track Barnard's Star across forty years of plates." },
  { id: 'skeptic', name: 'Healthy Skeptic', desc: 'Clear five tiles with no anomaly.' },
  { id: 'artifact', name: 'Artifact Hunter', desc: 'Have a halo or blend explained by the pipeline.' },
  { id: 'clean-case', name: 'Clean Case', desc: 'Close a case with every tile reviewed.' },
  { id: 'field-analyst', name: 'Field Analyst', desc: 'Reach Rank 2.' },
  { id: 'subtractor', name: 'Subtractor', desc: 'Solve a case using Difference Imaging.' },
  { id: 'cold-hand', name: 'Cold Hand', desc: 'Identify a cold companion in the infrared. (Chapter 3)' },
  { id: 'many-eyes', name: 'Many Eyes', desc: 'Agree with expert consensus on 50 live tiles. (Chapter 5)' },
]

// ---------------------------------------------------------------- leaderboard (demo fixtures)
export interface Player { callsign: string; country: string; tiles: number; accuracy: number; xp: number; streak: number; team?: string }
export const PLAYERS: Player[] = [
  { callsign: 'Tombaughs_Heir', country: 'US', tiles: 1847, accuracy: 97.3, xp: 64210, streak: 41 },
  { callsign: 'Ifeoma.Adeyemi', country: 'NG', tiles: 1612, accuracy: 98.1, xp: 59874, streak: 63, team: 'Pleiades' },
  { callsign: 'platehunter_77', country: 'DE', tiles: 1538, accuracy: 95.6, xp: 52119, streak: 12 },
  { callsign: 'Kenji Ishikawa', country: 'JP', tiles: 1401, accuracy: 96.8, xp: 48302, streak: 28 },
  { callsign: 'redshift_rafa', country: 'BR', tiles: 1265, accuracy: 93.9, xp: 41877, streak: 9 },
  { callsign: 'Lyra Vasquez', country: 'MX', tiles: 1144, accuracy: 97.9, xp: 40055, streak: 35, team: 'Pleiades' },
  { callsign: 'the_blinker', country: 'GB', tiles: 1092, accuracy: 91.2, xp: 36420, streak: 4 },
  { callsign: 'Anouk.V', country: 'NL', tiles: 987, accuracy: 96.1, xp: 33918, streak: 22 },
  { callsign: 'astro_priya', country: 'IN', tiles: 941, accuracy: 94.7, xp: 31266, streak: 17, team: 'Pleiades' },
  { callsign: 'dustlane', country: 'CA', tiles: 866, accuracy: 92.4, xp: 28703, streak: 6 },
  { callsign: 'Sven Lindqvist', country: 'SE', tiles: 812, accuracy: 95.0, xp: 27111, streak: 19 },
  { callsign: 'Halleys_Ghost', country: 'AU', tiles: 774, accuracy: 89.8, xp: 24480, streak: 2 },
  { callsign: 'marisol.dz', country: 'AR', tiles: 703, accuracy: 96.5, xp: 23356, streak: 31 },
  { callsign: 'Bodhi_K', country: 'NP', tiles: 655, accuracy: 93.1, xp: 21094, streak: 8, team: 'Pleiades' },
  { callsign: 'gravlens', country: 'FR', tiles: 612, accuracy: 90.7, xp: 19620, streak: 3 },
  { callsign: 'Mateus Rocha', country: 'PT', tiles: 571, accuracy: 94.2, xp: 18332, streak: 14 },
  { callsign: 'QuasarQuinn', country: 'IE', tiles: 523, accuracy: 88.6, xp: 16041, streak: 1 },
  { callsign: 'Wren Hollis', country: 'NZ', tiles: 488, accuracy: 95.8, xp: 15570, streak: 26 },
  { callsign: 'nebula_noor', country: 'EG', tiles: 437, accuracy: 92.9, xp: 13802, streak: 10, team: 'Pleiades' },
  { callsign: 'Tomas.Hruska', country: 'CZ', tiles: 401, accuracy: 91.5, xp: 12395, streak: 7 },
  { callsign: 'kilonova_kai', country: 'KR', tiles: 356, accuracy: 89.1, xp: 10882, streak: 5 },
  { callsign: 'Amara Osei', country: 'GH', tiles: 312, accuracy: 94.4, xp: 9741, streak: 18 },
  { callsign: 'parallax_pat', country: 'US', tiles: 268, accuracy: 87.3, xp: 8017, streak: 2 },
  { callsign: 'Ruslan.B', country: 'KZ', tiles: 231, accuracy: 90.2, xp: 6930, streak: 4 },
  { callsign: 'Ines Carvalho', country: 'PT', tiles: 194, accuracy: 92.6, xp: 5884, streak: 9, team: 'Pleiades' },
  { callsign: 'zodiacal_zoe', country: 'ZA', tiles: 158, accuracy: 86.4, xp: 4413, streak: 1 },
  { callsign: 'Oskar Wnuk', country: 'PL', tiles: 121, accuracy: 89.9, xp: 3302, streak: 3 },
  { callsign: 'firstlight_fin', country: 'FI', tiles: 76, accuracy: 84.2, xp: 1917, streak: 2 },
]

export const COMMUNITY = { tiles: 1284617, known: 38402, rejected: 216930, candidates: 211, detectives: 9318 }

export const GUIDE = { name: 'Dr. Edda Varga', role: 'Survey Lead · Case Supervisor', img: '/img/guide.png' }
