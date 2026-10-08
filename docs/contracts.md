# Cosmic Detective — Contracts

> The rules the code relies on: data shapes, state invariants, function behaviour,
> component props, DOM/CSS hooks, and the seams where services will replace fixtures.
> Companion: [`architecture.md`](./architecture.md).
>
> **Convention:** sections marked **(as implemented)** are read directly from `src/`.
> Sections marked **(proposed)** are *derived* service interfaces that the code comments
> anticipate; they do not exist in the repo yet.

Contents
1. Routing contract
2. Content / data contracts (`fixtures.ts`)
3. Game state contract (`store.tsx`)
4. Verification contract (`verify`)
5. Progression, scoring and reward contracts
6. Component contracts
7. Tutorial (DOM hook) contract
8. Styling / theming contract
9. Service contracts (proposed)
10. Asset contract
11. Invariants checklist
12. Contract gaps

---

## 1. Routing contract (as implemented)

Hash-based. Route string = `location.hash` without `#`, default `/`.
Parsed as `['', base, arg] = route.split('/')`, `n = Number(arg)`.

| Route | `base` | `arg` | Preconditions enforced by | On violation |
|---|---|---|---|---|
| `/` | `''` | – | – | – |
| `/map` | `map` | – | – | – |
| `/case/:n` | `case` | integer case number | `CaseScreen`: `getLevel(n)` exists **and** `levelState(n) ∉ {locked, sealed}` | Renders "Case file sealed" empty state |
| `/debrief/:n` | `debrief` | integer case number | `Debrief`: `state.last?.level === n` | Renders "No report on file" empty state |
| `/ranks` `/dossier` `/archive` `/settings` | same | – | – | – |
| other | – | – | – | Falls to `Title` (HUD still shown) |

Rules:
- `navigate(path)` takes a path **with leading slash** and no `#`.
- Every route change remounts `<main>` (keyed by route) and scrolls to top.
- `HUD` marks a tab active when `route.startsWith(href)`.
- The HUD is hidden only when `base` is falsy.
- `RankUp` is not rendered when `base === 'case'`.
- The "sign your badge" toast shows when `!started && base` is truthy and `base !== 'archive'`.

---

## 2. Content / data contracts (as implemented)

All in `src/data/fixtures.ts`. These are the shapes a data service must eventually satisfy.

### 2.1 Tile

```ts
type TileKind = 'mover' | 'stationary' | 'halo' | 'blend' | 'galaxy' | 'cluster'

interface Tile {
  id: string            // key in TILES; also the image file stem
  code: string          // display code, e.g. 'OPH-0417'
  name: string          // revealed only AFTER review (CaseScreen shows it when `cur` exists)
  kind: TileKind        // ground truth used by verify()
  ra: number            // tile centre, degrees J2000
  dec: number           // degrees
  size: number          // field of view, degrees
  a?: [number, number]  // mover position in epoch A, normalised 0..1 (x/512, y/512)
  b?: [number, number]  // mover position in epoch B, normalised 0..1
  catalog?: { name; alias; pm; distance; note }  // strings, display-ready
  rejectNote?: string   // explanation for non-movers
}
```

Invariants:
- `kind === 'mover'` ⇒ `a`, `b`, `catalog` **must** exist (`verify` uses non-null assertions on `catalog`; `TileViewer` and the hint/reveal overlays require `a`/`b`).
- `kind !== 'mover'` ⇒ `rejectNote` **must** exist (`verify` asserts it for halo/blend and uses it for stationary).
- `a`/`b` are measured in the **displayed image frame**, origin top-left, y down, range 0–1.
- Plates are square (the pixel-scale text uses `size * 3600 / 512` arcsec per px and the 512 divisor in fixtures).
- `ra` increases to the **left** on screen (East-left); `TileViewer.skyAt` implements this.
- Plate files: `/sky/{id}-a.jpg`, `/sky/{id}-b.jpg` via `TILE_IMG(id, 'a'|'b')`.

### 2.2 Rank, tool, chapter, level

```ts
interface Rank    { n: number; title: string; tiles: number; weight: number; level: number }
type ToolId = 'blink' | 'diff' | 'bands' | 'lightcurve' | 'suite'
interface Chapter { n: number; title: string; arc: string; art: string; tool: ToolId; accent: string }
interface Level   { n: number; chapter: number; title: string; briefing: string;
                    target: string; tiles: string[]; tutorial?: boolean }
```

| Constant | Contract |
|---|---|
| `RANKS` | Exactly 5, ascending by `n` and `tiles`. `RANKS[n-1].n === n` (code indexes by `n-1`). `RANKS[0].tiles === 0`. |
| `rankFor(tiles)` | Highest rank with `tiles >= rank.tiles`. Never undefined because rank 1 is 0. |
| `nextRank(tiles)` | First rank with `rank.tiles > tiles`, or `undefined` at max. |
| `TOOLS` | Each `chapter` ∈ 1..5. `TOOLS[1]` is assumed to be Difference Imaging by `CaseScreen`'s lesson card. |
| `CHAPTERS` | Exactly 5; `CHAPTERS[n-1].n === n`; `tool` must be a valid `TOOLS[].id` (`MapScreen` uses `!`). |
| `PLAYABLE` | Authored levels. `chapter === ceil(n/10)`. `target ∈ tiles ⊆ keys(TILES)`. Exactly one `tutorial: true` level (case 1) is assumed. |
| `getLevel(n)` | `PLAYABLE.find(l => l.n === n)`. |
| `LEVEL_NAMES` | Titles for cases without a level; `MapScreen` uses `level.title ?? LEVEL_NAMES[n]`. Case numbers 1–50 should resolve to a title one way or the other. |
| `order(target, seed)` | Deterministic: same inputs ⇒ same order. Output length = `keys(TILES).length` (currently 12), contains every tile exactly once, target at index `(seed*5) % 12`. |

**Case number ⇄ chapter ⇄ rank mapping** (relied on in `levelState`, `MapScreen`):
`chapter = ceil(n/10)`; chapter `c` requires `rankFor(tiles).n >= c`; node index
`n = (chapter-1)*10 + i + 1`. Rank `r` thus gates chapter `r`.

### 2.3 Other fixtures

```ts
type Verdict = 'accepted' | 'known' | 'rejected-stationary' | 'rejected-halo'
             | 'pending' | 'candidate' | 'clear' | 'missed'
interface Player { callsign; country; tiles; accuracy; xp; streak; team? }
BADGES: { id; name; desc }[]
BARNARD_BANDS: { key; label; wl; era; file; tint }[]
COMMUNITY = { tiles; known; rejected; candidates; detectives }   // demo figures
GUIDE = { name; role; img }
```

- `Verdict` values emitted by the current verifier: `known`, `rejected-stationary`,
  `rejected-halo`, `clear`, `pending`, `missed`. `accepted` and `candidate` exist in the
  type and have chip definitions but are **never produced** yet (reserved for later chapters).
- `Player.accuracy` is a percent (0–100), one decimal.
- `Player.team === 'Pleiades'` is the only team filter value used.
- Badge ids referenced in code: `first-flag`, `barnard`, `skeptic`, `artifact`,
  `clean-case`, `field-analyst`, `subtractor`. `cold-hand` and `many-eyes` are defined
  but never awarded.

---

## 3. Game state contract (as implemented)

Persisted under `localStorage['cosmic-detective:v1']`.

```ts
interface GameState {
  callsign: string
  started: boolean
  theme: 'dark' | 'light'
  colorblind: boolean
  sound: boolean
  xp: number            // cumulative XP
  tiles: number         // cumulative tiles reviewed → drives rank
  correct: number       // cumulative correct judgements
  judged: number        // cumulative judgements (accuracy = correct / judged)
  known: number         // cumulative 'known' verdicts
  artifacts: number     // cumulative 'rejected-halo' verdicts
  clears: number        // cumulative 'clear' + 'pending' verdicts
  completed: number[]   // case numbers closed
  badges: string[]      // badge ids, unique
  tutorial: number | null   // active step 1..7, null = off
  tutorialDone: boolean
  history: { level; title; xp; tiles; at /* YYYY-MM-DD */ }[]   // newest first, max 12
  rankUp: number | null     // rank number to celebrate; cleared by overlay
  presenter: boolean
  last: CaseSummary | null  // most recent case, consumed by Debrief
}

interface CaseSummary {
  level: number; title: string; solved: boolean; collected: boolean
  xp: number; tiles: number; correct: number; judged: number
  known: number; artifacts: number; clears: number
  results: { id: string; verdict: string }[]   // verdict may be 'unreviewed'
}
```

### 3.1 Provider API

```ts
useGame(): {
  s: GameState
  set(fn: (s: GameState) => GameState): void
  award(patch: Partial<Pick<GameState,'xp'|'tiles'|'correct'|'judged'|'known'|'artifacts'|'clears'>>): void
  badge(id: string): void
}
```

| Function | Guarantees |
|---|---|
| `set` | Plain functional update; no validation. |
| `award` | **Adds** each patch value to the existing field. If `rankFor(next.tiles).n > rankFor(prev.tiles).n`: sets `rankUp = newRank` and (if new rank ≥ 2 and not already held) appends badge `field-analyst`. Never lowers a counter unless given negatives. |
| `badge` | Idempotent. |

### 3.2 Persistence contract

- Hydrate: `{ ...FRESH, ...parsed }`; parse errors fall back to `FRESH`.
- Write: whole object on every change.
- Side effects of any state change: `<html data-theme>`, `<html data-cb="on|off">`, `setSound(s.sound)`.
- Not versioned beyond the key. Adding a field is safe; changing the type of an existing field is **not**.
- `useRoute()` returns the current hash string and listens to `hashchange`.

### 3.3 Presets

- `FRESH` — clean player.
- `DEMO_SAVE(s)` — keeps current `s`, sets: `callsign` (default `'Det. Nova Reyes'`), `started`, `xp 5240`, `tiles 189`, `correct 171`, `judged 182`, `known 3`, `artifacts 14`, `clears 121`, `completed [1,2,3]`, four badges, `tutorial null`, `tutorialDone true`, three history rows. **Contract:** `tiles` must stay `RANKS[1].tiles − 11` for the Title button text to be true.
- Settings "Reset progress" preserves `theme`, `colorblind`, `presenter` and resets everything else to `FRESH` (so `sound` is reset to `true`).

---

## 4. Verification contract (as implemented)

```ts
verify(tile: Tile,
       marker: [number, number] | null,   // normalised 0..1
       action: 'flag' | 'clear',
       chapter: number,
       weight: number,                    // rank consensus weight
       isTarget: boolean): Result

interface Result {
  verdict: Verdict
  xp: number
  correct: boolean
  checks: { name: string; status: 'wait'|'run'|'pass'|'fail'|'info'; note: string }[]
  marker: [number, number] | null
}
```

Properties: **pure and deterministic**; uses only `tile`, arguments, and constants.
The only non-input dependence is `tile.code.charCodeAt(4)` in the consensus note.

### 4.1 Decision table

| # | Condition (first match wins) | verdict | xp | correct | checks (names) |
|---|---|---|---|---|---|
| 1 | `action = clear` and `kind = mover` | `missed` | 0 | false | Stationary source check (**fail**) |
| 2 | `action = clear` | `clear` (ch 1) / `pending` (ch ≥ 2) | 15 | true | Stationary (**pass**), + Weighted consensus (agree 0.62 → `info`) if ch ≥ 2 |
| 3 | `kind = mover`, marker non-null, `dist(marker, a) < 0.08` or `dist(marker, b) < 0.08` | `known` | **0 if isTarget else 60** | true | Stationary (pass), Blend & halo (pass), Catalog cross-match (info), + consensus (0.91 → `pass`) if ch ≥ 2 |
| 4 | `kind ∈ {halo, blend}` | `rejected-halo` | 10 | false | Stationary (pass), Blend & halo (**fail**, note = `rejectNote`) |
| 5 | otherwise | `rejected-stationary` | 5 | false | Stationary (**fail**) |

`dist` is Euclidean distance in **normalised** coordinates (so tolerance is 8 % of the
plate width/height, not arcseconds).

Other rules:
- Consensus check `status = pass` iff `agree > 0.7`, else `info`. Analyst count shown =
  `9 + (code.charCodeAt(4) % 9)`.
- A `flag` requires a marker (the UI guards this; `verify` would still run row 4/5 with null).
- Flagging a halo/blend tile is "rejected-halo" **regardless of marker position**.
- A `clear` on a halo/blend/stationary/cluster/galaxy tile is the "correct" outcome.
- Arcsecond displacement text = `dist(a,b) * tile.size * 3600`.

### 4.2 Reveal/commit protocol (UI side)

1. `submit()` computes `Result` immediately and sets `running = { id, res, shown: 0 }`.
2. For each check *i*, after `650 ms × (i+1)`: `shown = i+1` and a sound plays
   (`reject` for fail, `pass` for pass, `scan` otherwise).
3. After `650 ms × (checks.length + 1)`: commit to `results[tile.id]` (unless a non-target tile already has a result), play `success` for `known`, and advance tutorial 4→5 if applicable.
4. While `running`, marking and both action buttons are disabled.

A verification service must therefore return the **full ordered list of checks**
(or be adapted to stream them); the UI paces the reveal itself.

---

## 5. Progression, scoring and reward contracts (as implemented)

### 5.1 Case summary derivation (`CaseScreen.summary`)

```
xp        = Σ result.xp + (level.tutorial ? 50 : 0) + (solved && reviewed === level.tiles.length ? 40 : 0)
tiles     = reviewed                                   // number of results
judged    = reviewed
correct   = count(result.correct)
known     = count(verdict = 'known')
artifacts = count(verdict = 'rejected-halo')
clears    = count(verdict ∈ {'clear','pending'})
solved    = results[level.target]?.verdict === 'known'
results[] = level.tiles.map(id => ({ id, verdict: results[id]?.verdict ?? 'unreviewed' }))
```

Notes: `missed` and `rejected-stationary` count toward `judged` but not `correct`; the
mandatory target's `known` is worth **0 XP** (it is "story progress"), but counts as a
reviewed, correct, known tile.

### 5.2 Case lifecycle contract

| Event | Effect on global state |
|---|---|
| Any tile reviewed | `last = summary` (`collected: false`) is rewritten on every `summary` change |
| "File report" pressed (needs `solved`) | `last = summary`, navigate `/debrief/:n` |
| "Collect reward" pressed (once per `last`) | `award({xp,tiles,correct,judged,known,artifacts,clears})`; `last.collected = true`; `completed ∪= {n}`; `history` prepend (slice 12); tutorial 6→7 |
| Collect, badges | `first-flag` always; `barnard` if `level.target === 'barnard'`; `artifact` if `c.artifacts > 0`; `skeptic` if `s.clears + c.clears ≥ 5`; `clean-case` if `c.tiles === level.tiles.length`; `subtractor` if `level.chapter ≥ 2` |
| Collect crosses a rank threshold | `rankUp = newRank` (overlay shown on `/debrief`) |

Debrief reward display contract:
`Bonus inspection = c.xp − (tutorial ? 50 : 0) − (cleanCase ? 40 : 0)`; shown rows are
Training reward (tutorial level only), Bonus inspection, Clean case bonus (if applicable).

### 5.3 Unlock contract: `levelState(n, completed, tiles)`

```
if n ∈ completed                                 → 'done'
if rankFor(tiles).n < ceil(n/10)                 → 'locked'
if getLevel(n) is undefined                      → 'sealed'
if every PLAYABLE l (same chapter, l.n < n) ∈ completed → 'open'
else                                             → 'locked'
```

Order matters: the rank test precedes the "sealed" test. Only **authored** earlier cases
count as prerequisites. `MapScreen.go()` allows navigation for `open` and `done`; others
play `sfx.reject()`.

### 5.4 Tool availability contract (`CaseScreen`)

```
blink       : always
diff        : rank.n >= 2 && chapter >= 2
bands       : false (always locked in case screen)
lightcurve  : false
```

Keyboard `D` and the toolbar button honour `tools.diff`.

### 5.5 Rank thresholds

| Rank | Title | Tiles | Weight | First case |
|---|---|---|---|---|
| 1 | Learner | 0 | 1.0 | 1 |
| 2 | Field Analyst | 200 | 1.4 | 11 |
| 3 | Sky Inspector | 320 | 2.1 | 21 |
| 4 | Deep Space Lead | 420 | 2.9 | 31 |
| 5 | Master Investigator | 500 | 4.0 | 41 |

`XPBar` progress = `(tiles − rank.tiles) / (next.tiles − rank.tiles)`, clamped visually to
at least 2 % fill; max rank shows 100 %. **Rank is driven by tiles, not XP.**

### 5.6 Rankings contract

- Rows = `PLAYERS` + a synthetic "me" row (`country '··'`, `team 'Pleiades'`,
  `streak = history.length`, `accuracy` from state, 0 if nothing judged).
- Sort key: Global = `xp`; Accuracy = `accuracy*1e6 + tiles`; Consensus weight =
  `weight*1e6 + accuracy*1e3`; Team tab filters `team === 'Pleiades'` then sorts by `xp`.
- Podium renders positions `[1, 0, 2]` (visual order 2nd, 1st, 3rd).

---

## 6. Component contracts (as implemented)

### 6.1 `TileViewer`

```ts
type ViewMode = 'a' | 'b' | 'blink' | 'diff'
interface Props {
  tile: Tile
  mode: ViewMode
  speed: number                 // blink interval in ms
  marker: [number, number] | null   // normalised
  onMark?: (p: [number, number]) => void   // omit ⇒ viewer is read-only (cursor not 'markable')
  reveal?: boolean              // draw the true a→b vector (requires tile.a, tile.b)
  hint?: boolean                // pulse rings at a and b (tutorial)
  onBlinkTick?: () => void      // called after each blink flip
}
```

- Marker and cursor positions are always **0–1 relative to the image box**, clamped.
- `onBlinkTick` may change identity freely (held in a ref); `speed` / `mode` changes restart the interval.
- Callers should pass `key={tile.id}` so internal frame/cursor state resets between tiles (CaseScreen does).
- Emits a `data-tut="viewer"` hook on the image container.
- Footer shows RA/Dec under the cursor (or tile centre when not hovering), FOV in arcminutes and arcsec/px (assumes 512 px source).
- `diff` mode hides the loupe and shows the "DIFFERENCE · B − A" tag.
- The loupe samples `A` or `B` according to the current `frame`.

### 6.2 `ui.tsx`

| Export | Props | Contract |
|---|---|---|
| `Starfield` | `density?: number` (default 1) | Fixed canvas; re-seeds on `density` change; honours reduced motion; reads `--star`. |
| `RankEmblem` | `n`, `size?`, `glow?` | Gradient id `eg{n}` is **not unique per instance** — multiple emblems of the same rank share an id (works because the definition is identical). |
| `XPBar` | `compact?` | Reads global state; carries `data-tut="xp"`. |
| `Chip` | `v: Verdict`, `small?` | Total over `Verdict`; each verdict has a distinct icon. |
| `Btn` | `variant?: 'primary'\|'ghost'\|'danger'\|'ok'`, `onClick`, `disabled`, `className`, `...rest` | Plays hover/click sounds; `rest` is spread **after** handlers, so passing `onClick`/`onMouseEnter` via `rest` would override sound handling. |
| `DisplayToggles` | – | Dark / light are mutually exclusive; colour-blind is an independent toggle. |
| `RANK_LIST` | – | Alias of `RANKS`. |

### 6.3 `Chrome.tsx`

| Export | Contract |
|---|---|
| `Logo` | `big?` variant only. |
| `HUD` | `route: string`; hidden on Title by `App`. `NAV` = Campaign `/map`, Rankings `/ranks`, Dossier `/dossier`, Mission `/archive`. |
| `RankUp` | Visible while `state.rankUp` is truthy; clicking backdrop dismisses; "Continue" clears and navigates `/map`. Shows a tool-unlock block only when `TOOLS.find(t => t.chapter === n)` and a matching chapter exist (always for 1–5). Plays `sfx.rankUp()` on change. |
| `Presenter` | Active when `state.presenter`. `Shift+P` toggles. Actions: load demo save, +25 tiles/+400 XP, preview rank-up (cycles up to 5), unlock chapter 2 (`completed=[1,2,3,4]`, `tiles ≥ 205`), start tutorial, reset to fresh (keeps presenter on). |

### 6.4 Screen contracts

| Screen | Props | Reads | Writes |
|---|---|---|---|
| `Title` | – | `callsign`, `started`, `tutorialDone` | `callsign`, `started`, `tutorial`; "presentation save" via `DEMO_SAVE`. Validation: callsign trimmed length ≥ 2, max 24 chars. Navigates to `/case/1` if tutorial not done, else `/map`. |
| `MapScreen` | – | `completed`, `tiles`, `tutorial` | Clears tutorial when step 7 and a node is clicked. Exports `levelState`, `NodeState`. |
| `CaseScreen` | `n: number` | `completed`, `tiles`, `tutorial` | `last`, `tutorial` |
| `Debrief` | `n: number` | `last`, `clears`, `tutorial` | see §5.2 |
| `Rankings` | – | `callsign`, `tiles`, `xp`, `correct`, `judged`, `history` | – |
| `Dossier` | – | most of state | – |
| `Archive` | – | – | – (static copy + blinking Barnard demo at 700 ms) |
| `Settings` | – | `sound`, `presenter`, display flags | `sound`, `presenter`, `tutorial`, full reset |

---

## 7. Tutorial (DOM hook) contract (as implemented)

`Guide` is decoupled from screens through **DOM attributes** and the `state.tutorial` counter.

```ts
interface Step { target: string; title: string; text: string; manual?: string }
TUTORIAL: Record<1..7, Step>
```

Rules:
- A step's `target` must match the value of a `data-tut` attribute that exists in the DOM
  **while that step is active**. If none is found, the guide dims the whole screen
  (`blocker dim`) and still shows the dialog.
- If several elements share the same `data-tut`, the **first in document order** is used
  (`querySelector`). Current duplicates: **`xp`** (HUD `XPBar`, Debrief `.reward`, Debrief `XPBar`).
- While a spotlight is active, everything outside the highlighted rectangle is click-blocked;
  only the guide box (`pointer-events: auto`) and the spotlighted area remain interactive.
  Therefore **every step must either (a) have the required next action inside the spotlight,
  or (b) provide a `manual` button.** Steps 1–4 satisfy (a); steps 5 and 7 satisfy (b);
  step 6 currently satisfies neither (see §12 G1).
- The guide re-measures every 250 ms and on resize and (capturing) scroll.
- Only the owning screen may advance `state.tutorial`. `Guide` itself advances 5→6 and 7→done.
- Keyboard shortcuts in `CaseScreen` are disabled whenever `state.tutorial` is non-null.

Hook inventory:

| `data-tut` | Element | Screen |
|---|---|---|
| `briefing` | Case folder | CaseScreen |
| `tile-target` | Thumbnail of the level's target tile | CaseScreen |
| `tool-blink` | Blink Comparator button | CaseScreen |
| `inspect` | The `.inspect` section (viewer + toolbar + actions) | CaseScreen |
| `viewer` | Image container | TileViewer |
| `flag` | Flag button | CaseScreen |
| `result` | Verification panel | CaseScreen |
| `xp` | `XPBar`; `.reward` panel | ui / Debrief |
| `next-level` | Map node for case 2 | MapScreen |

---

## 8. Styling / theming contract (as implemented)

### 8.1 Document attributes (written by `GameProvider`)

| Attribute | Values | Effect |
|---|---|---|
| `html[data-theme]` | `dark` (default) \| `light` | Swaps neutral and semantic tokens |
| `html[data-cb]` | `on` \| `off` | Swaps semantic tokens to Okabe–Ito |

### 8.2 Tokens

- Neutrals: `--bg --bg-2 --panel --panel-solid --panel-2 --line --line-strong --text --muted --star --shadow --paper --paper-ink`
- Semantic (meaning-bearing, overridden in colour-blind mode): `--rank --rank-deep --ok --known --pending --info --bad --cand`
- Contextual: `--accent` (defaults to `--rank`; set inline per chapter), `--tint` (per band button/image), `--i` (confetti index).

Rule: **colour must never be the only carrier of status.** Verdicts have icons;
completed/locked nodes have check/lock glyphs. New statuses must do the same.

### 8.3 Class vocabulary relied on by TSX

Verdict classes `v-ok v-known v-bad v-pending v-cand v-info`; node states
`done open locked sealed`; check states `wait run pass fail info`; viewer modes
`mode-a|b|blink|diff`, plate class `subtract` (CSS `mix-blend-mode: difference`);
layout classes `screen`, `stage`, `stage title`, `case-grid`, etc. Renaming any of these
requires editing both files.

### 8.4 Layering (z-index)

`starfield 0 < grain 1 < stage 2 < toast 40 < hud 50 < display-toggles 60 <
briefing-overlay 70 < guide-layer 80 < rankup 90 < presenter 95`.

### 8.5 Responsive and motion

Breakpoints: ≤1280, ≤1100, ≤860 px. `prefers-reduced-motion` clamps all animation and
transition durations (and the starfield stops drifting).

---

## 9. Service contracts (proposed)

> Derived from the seams in §2 and §4 and the code comments ("a later milestone swaps
> these for the data, verification and consensus services", "moves this to the progress
> service"). Names, paths and fields are **proposals** chosen to preserve the current UI
> behaviour; adjust to the real service design.

### 9.1 Data service — tiles and batches

```
GET /cases/{n}
→ { level: Omit<Level,'tiles'|'target'> & { tileIds: string[] },   // target id NOT revealed
    tiles: Array<Pick<Tile,'id'|'code'|'ra'|'dec'|'size'> & { imgA: string; imgB: string }> }
```

Requirements to keep the UI working:
- The client currently needs `kind`, `a`, `b`, `catalog`, `rejectNote`, and `name` **only after** verification — a real service must not ship ground truth in the batch response.
- `Level.target` (mandatory tile) is needed to mark the objective and to compute the `solved` flag; the service should return an opaque `targetTileId` or a server-computed `solved`.
- Image URLs must be square plates compatible with `cdn()` or be replaced by direct URLs.

### 9.2 Verification service

```
POST /verify
{ tileId, caseN, action: 'flag' | 'clear',
  marker?: [x, y],            // normalised 0..1, East-left image frame
  clientWeight?: number }     // ignored by server; weight is looked up server-side

→ { verdict: Verdict,
    checks: { name, status: 'pass'|'fail'|'info', note }[],   // ordered
    xp: number,               // server-authoritative
    correct: boolean,
    reveal?: { a: [x,y], b: [x,y], catalog?: CatalogRecord, name?: string, rejectNote?: string } }
```

Requirements:
- Must reproduce the decision table in §4.1 for chapter-1 answer-key scoring.
- For chapter ≥ 2, `Weighted consensus` must be computed from real submissions and return `pending` until resolved; the client then needs a way to **poll or receive** the eventual outcome (today `pending` is terminal in the UI).
- `xp` and `correct` must be server-authoritative so replays and duplicate submissions can be rejected (see §12 G2).
- Idempotency: submission key `(playerId, caseN, tileId)`; non-target tiles one-shot, target retriable only until first `known`.

### 9.3 Consensus service

Inputs: stream of `(playerId, tileId, action, marker, weight)`.
Outputs: per-tile `{ reviewers, agreement, resolution: 'pending'|'known'|'rejected'|'candidate' }`,
and a `candidate` verdict (reserved in `Verdict`) only after full pipeline + expert agreement
(Archive copy: "Never labelled confirmed"). Weights come from `RANKS[].weight`.

### 9.4 Progress service (replaces localStorage)

`PLAN.md` item 3 names the intended stack: **Netlify Identity** for sign-in and
**Netlify Database** for progress. The interface below is stack-agnostic.

```
GET  /me                → GameState-compatible profile (minus UI-only fields: theme, colorblind, sound, presenter, tutorial)
POST /cases/{n}/collect → { awarded: {...}, profile, rankUp?: number, newBadges: string[] }
```

Requirements:
- `collect` must be **idempotent per case-attempt** and compute XP/tiles server-side from verified results, not from a client-supplied `CaseSummary`.
- UI-only preferences (`theme`, `colorblind`, `sound`) may stay in `localStorage`.
- Keep `rankUp` as a response field so the existing overlay still fires.

### 9.5 Leaderboard / community service

`GET /leaderboard?tab=global|team|accuracy|weight` → `Player[]` (server-sorted),
`GET /community` → `typeof COMMUNITY`. Both currently static demo fixtures and labelled
as such in the UI; remove those labels only when real.

---

## 10. Asset contract

### 10.1 Generation contract (`scripts/fetch-sky.mjs`)

For every tile `[id, ra, dec, size]` the script writes `public/sky/{id}-a.jpg`
(survey *DSS1 Red*) and `public/sky/{id}-b.jpg` (survey *DSS2 Red*) using SkyView
`runquery.pl` with `Position=ra,dec`, `Size=size` (degrees), `Pixels=512`,
`Scaling=Log`, `Return=JPEG`. Both epochs are resampled by SkyView onto the same grid, which
is what makes pixel-position comparison between A and B valid. Six extra Barnard band
images are written as `barnard-{dss1b,dss2r,2massj,2massk,w1,w2}.jpg` at Barnard's centre, 0.25°.

**Sync rule:** the `(id, ra, dec, size)` rows in the script **must equal** `TILES[id].ra/dec/size`
in `fixtures.ts`. The mover pixel positions `a`/`b` and the on-screen RA/Dec readout are only
correct if the image was cut at exactly those coordinates and size. Re-fetching with different
parameters requires re-measuring `a` and `b`.

Success criteria: HTTP OK and body > 8,000 bytes; 4 attempts, 150 s timeout, concurrency 4.
The script does not set a non-zero exit code on failure.

### 10.2 Runtime asset table

| Path | Required | Notes |
|---|---|---|
| `/sky/{tileId}-a.jpg`, `-b.jpg` | for every `TILES` key | Square, registered, 512 px source assumed by the pixel-scale math (`size*3600/512` ″/px) |
| `/sky/barnard-{dss1b,dss2r,2massj,2massk,w1,w2}.jpg` | for `BARNARD_BANDS` | Dossier preview only |
| `/img/ch1.png … ch5.png` | for `CHAPTERS[].art` | Map backgrounds |
| `/img/guide.png` | `GUIDE.img` | Dr. Varga portrait; used at 96–200 px |
| `/img/title-key.png` | Title | Background key art |
| `/.netlify/images?url=&w=&fm=webp` | at runtime | Provided by Netlify; not handled by `vite.config.ts` |
| Google Fonts (Big Shoulders Display 600/800/900, Chakra Petch 400–700, JetBrains Mono 400/600) | at runtime | Linked in `index.html`; CSS stacks fall back to system fonts |

---

## 11. Invariants checklist

Use this when changing code or content.

**Content**
- [ ] Every `TILES` key has both plate files.
- [ ] `scripts/fetch-sky.mjs` tile rows match `fixtures.ts` (id, RA, Dec, size) and the plates were regenerated after any change.
- [ ] Every `mover` has `a`, `b`, `catalog`; every non-mover has `rejectNote`.
- [ ] `RANKS` and `CHAPTERS` have exactly 5 entries, indexed by `n-1`.
- [ ] Every `PLAYABLE.target` is in its own `tiles` and in `TILES`.
- [ ] `PLAYABLE[].chapter === ceil(n / 10)`.
- [ ] `DEMO_SAVE.tiles`, Title button text and Presenter helpers agree with `RANKS`.

**State**
- [ ] Only `award()` changes cumulative counters that can cross a rank.
- [ ] `completed` has no duplicates (collect guards with `includes`).
- [ ] `badges` has no duplicates (`badge()` and `award` both guard).
- [ ] `history.length ≤ 12`, newest first.
- [ ] `tutorial ∈ {null, 1..7}`.

**Verification**
- [ ] Target `known` yields 0 XP but counts toward `tiles`, `correct`, `known`.
- [ ] All XP flows through `Result.xp`; the only additive extras are +50 (tutorial) and +40 (clean case).
- [ ] The UI never reveals `Tile.name` or the true vector before a result exists.

**UI**
- [ ] Every new `Verdict` has a chip label, class and icon.
- [ ] Every tutorial step has an in-spotlight action or a manual button.
- [ ] Every `data-tut` value is unique within the DOM at the time its step is active.

---

## 12. Contract gaps (things the current code does *not* guarantee)

| # | Gap | Where | Suggested contract |
|---|---|---|---|
| G1 | Tutorial step 6's target `xp` resolves to the HUD bar (first match), blocking "Collect reward" with no manual button | `Guide`, `ui.tsx`, `Debrief` | Give Debrief's reward panel a unique `data-tut` (e.g. `reward`) and use it for step 6, **or** add `manual: 'Collect reward'` that calls the same handler |
| G2 | Rewards can be collected repeatedly by replaying a completed case | `CaseScreen` writes `last`, `Debrief.collect` awards | A case may award once per attempt; replays award nothing (or reduced) and do not reset `collected` |
| G3 | Debrief does not require `solved` | `Debrief` | Require `last.solved === true` before showing "CASE CLOSED" or enabling Collect |
| G4 | Target tile can be overwritten after `known` | `CaseScreen.submit` | Once the target is `known`, treat it as locked |
| G5 | `Verdict` contains values never emitted (`accepted`, `candidate`) | `fixtures.ts`, `ui.tsx` | Document as reserved, or remove until used |
| G6 | `Btn` spreads `...rest` last | `ui.tsx` | Destructure `onMouseEnter`/`onClick` explicitly or spread `rest` first |
| G7 | `RankEmblem` gradient ids collide across instances | `ui.tsx` | Use `useId()` |
| G8 | `levelState` lives in a screen file | `MapScreen.tsx` | Move to `lib/progress.ts` with `verify` |
| G9 | No state migration | `store.tsx` | Add `version` field and a migrate step |
| G10 | Unknown routes render Title with the HUD | `App.tsx` | Treat unknown `base` as `''` or add a NotFound |
| G11 | Marker placement requires a mouse | `TileViewer` | Support arrow-key nudging and Enter to place |
| G12 | `CaseSummary.results[].verdict` is `string`, not `Verdict \| 'unreviewed'` | `store.tsx`, `Debrief` | Tighten the type; remove the `as Verdict` cast |
| G13 | Consensus note numbers are synthetic | `verify` | Label as simulated in UI or source from the service |
| G14 | Tile coordinates are duplicated in `fetch-sky.mjs` and `fixtures.ts` | both | Single source (e.g. a JSON file imported by both) or a check script |
| G15 | `fetch-sky.mjs` exits 0 on failed downloads | script | `process.exitCode = 1` if any `FAILED` |
| G16 | Epoch labels and instrument metadata are hard-coded to POSS/DSS in views | `TileViewer`, `CaseScreen` metadata panel, Archive | Move to per-tile fields before SPHEREx data lands (PLAN item 2) |