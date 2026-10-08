# Cosmic Detective — GDD Traceability

> Maps every requirement in [game-design.md](./game-design.md) to what the code in `src/` does today.
> Companions: [`architecture.md`](./architecture.md) (risk IDs **R#**), [`contracts.md`](./contracts.md) (gap IDs **G#**).
>
> **Basis:** static reading of the source, `PLAN.md` and `README.md`. Nothing here comes from
> running the app, so items marked "needs playthrough" should be confirmed by hand.
> **Date of assessment:** 8 Oct 2026.

## How to read this

| Status | Meaning |
|---|---|
| **Done** | Behaviour matches the GDD requirement |
| **Partial** | Present, but incomplete or approximated |
| **Diverges** | Present, but contradicts the GDD |
| **Missing** | No implementation |
| **Beyond GDD** | Implemented, but the GDD says nothing about it |

Requirement IDs look like `§5.3-b`: GDD section, then a letter assigned here (the GDD itself
has no requirement numbers). Use these IDs in tickets and in `PLAN.md`.

---

## 0. Scoreboard

| GDD section | Done | Partial | Diverges | Missing |
|---|---|---|---|---|
| §1 Vision | 1 | 1 | 0 | 1 |
| §2 Pillars | 1 | 3 | 1 | 0 |
| §3 Scope / non-goals | 8 | 2 | 0 | 1 |
| §4 Core loop | 4 | 1 | 0 | 0 |
| §5 Mechanics | 5 | 6 | 0 | 4 |
| §6 Progression | 2 | 1 | 1 | 0 |
| §7 Narrative | 3 | 1 | 0 | 0 |
| §8 Onboarding | 7 | 2 | 2 | 0 |
| §9 Accessibility | 2 | 1 | 0 | 0 |
| §10 Content | 0 | 2 | 0 | 4 |
| §11 Systems | 1 | 0 | 0 | 3 |
| §12 Success criteria | 3 | 0 | 0 | 2 |

**Headline:** the *experience* layer (client, tools 1–2, verification UI, tutorial, accessibility)
is largely built. The *truth* layer is not: no SPHEREx data, no real verification, no real
consensus, no server. Two GDD §12 criteria are not met, and one of those (tutorial completion)
is likely blocked by a bug.

---

## 1. §1 Vision

| ID | GDD requirement | Status | Evidence / notes |
|---|---|---|---|
| §1-a | Built on **SPHEREx** survey data | **Missing** | All 12 tiles are DSS1/DSS2 plates from SkyView (`fetch-sky.mjs`). SPHEREx appears only in copy (Archive, `PLAN.md`). |
| §1-b | Detective story first, data task second | **Done** | Case folder, CLASSIFIED stamp, briefing text, guide character, case notes (`CaseScreen`). |
| §1-c | Each mechanic is a reskin of a real verification step | **Partial** | Blink = real. Difference = a CSS blend approximation (`mix-blend-mode: difference` + contrast filter), not a computed subtraction. Verification checks are scripted from `Tile.kind`, not computed from pixels. |

## 2. §2 Design pillars

| ID | Pillar | Status | Evidence / notes |
|---|---|---|---|
| §2-a | Real data first: "nothing generated or faked" | **Diverges** | Images and coordinates are real (DSS), but the weighted-consensus numbers are fabricated (`verify()`, R6/G13) and leaderboard/community figures are fixtures (labelled as demo in the UI). Real-vs-SPHEREx also open (§1-a). |
| §2-b | Evidence before reward | **Partial** | XP only flows through a `Result`, which is good. But `verify()` and the answer key (`kind`, `a`, `b`) run in the browser, and rewards can be re-collected or collected without solving (R2, R3, R4). |
| §2-c | Accessible to everyone | **Partial** | Three display modes, icon-per-status, reduced-motion handling. Marker placement is mouse-only (R11/G11) and the tutorial overlay covers the toggles (§8.2-c). |
| §2-d | Mastery through progression | **Partial** | Tools gated by rank *and* chapter; lesson card shown before Difference Imaging. Rank 2 is not reachable through normal play (see §6.1). |
| §2-e | No false discoveries | **Done** | Verdict set has `known` and `candidate`, no "confirmed". Copy audited: "confirmed" appears in the Archive (as a rule being stated) and in a catalogue note about Lalande 21185's already-known planets. No "Planet X" anywhere in the files read. |

---

## 3. §3 Scope and non-goals

### 3.1 In scope for first build

| ID | GDD requirement | Status | Evidence / notes |
|---|---|---|---|
| §3.1-a | One verified SPHEREx pair, months apart | **Missing** | DSS pair ~40 years apart. See "Data implications" below. |
| §3.1-b | Briefing → scan → mandatory target → bonus | **Done** | `CaseScreen` phases; "File report" disabled until `solved`. |
| §3.1-c | Blink Comparator + Difference Imaging | **Done** | `TileViewer` modes `blink`/`diff`; diff gated at rank ≥ 2 and chapter ≥ 2. |
| §3.1-d | Rank 1 and Rank 2 | **Partial** | All five ranks exist, but the Rank 2 threshold is probably mis-set (§6.1). |
| §3.1-e | Stationary check + known-object cross-match | **Partial** | Present and visible, but simulated client-side. The blend/halo check and consensus are also present (beyond first-build scope). |
| §3.1-f | Dark, light, colour-blind modes + guided tutorial | **Done** | `DisplayToggles`, `data-theme`/`data-cb`, `Guide`. |

### 3.2 Non-goals (must NOT be present)

| ID | Non-goal | Status | Notes |
|---|---|---|---|
| §3.2-a | Claiming a confirmed discovery | **Done** (absent) | See §2-e. |
| §3.2-b | Simulated/generated sky images | **Done** (absent) | Plates are real. Chapter art is AI-generated (README) but is illustration, not sky data. |
| §3.2-c | Full-sky coverage | **Done** (absent) | 12 tiles. |
| §3.2-d | Monetisation | **Done** (absent) | |
| §3.2-e | Chat / social features | **Done** (absent) | But a leaderboard, "Team Pleiades" tab and season countdown exist (**Beyond GDD**, see §13). |

---

## 4. §4 Core gameplay loop

| ID | GDD requirement | Status | Evidence / notes |
|---|---|---|---|
| §4.1-a | Case briefing with narrative and target coordinate grid | **Partial** | Narrative folder is there. There is no "coordinate grid" in the briefing; coordinates appear only in the per-tile metadata panel. |
| §4.1-b | Scan a batch of 10–15 tiles | **Done** | 12 tiles per case (`order()`), but always the same 12 (R10). |
| §4.1-c | Mandatory target must be flagged to advance | **Done** | `solved` gates "File report"; Debrief marks case complete. Can be bypassed by direct URL (R4) and un-solved by a later wrong flag (R3). |
| §4.1-d | Bonus inspection for XP, tools, rank | **Done** | Non-target results carry XP (15 / 60 / 10 / 5). |
| §4.2-a | 50 levels in 5 chapters, a few minutes each | **Done** (structure) | Map shows 50 nodes in 5 chapters. Only 5 are authored (see §10.2). |

---

## 5. §5 Game mechanics

### 5.1 Tools

| ID | Tool | Status | Evidence / notes |
|---|---|---|---|
| §5.1-a | Blink Comparator | **Done** | Adjustable rate, Space shortcut, tick sound. |
| §5.1-b | Difference Imaging | **Partial** | Works visually (CSS blend). Not a true registered-frame subtraction on data; fine for the presentation, to be revisited with SPHEREx data. |
| §5.1-c | Sector Map & Multi-Band Compositor | **Partial** | Only a **preview** on the Dossier (six fixed Barnard bands). No sector map, no free coordinates. |
| §5.1-d | Light Curve Analyzer | **Missing** | Locked placeholder button only. |
| §5.1-e | Full Research Suite + export | **Missing** | Tool metadata only. |

### 5.2 Tile inspection

| ID | GDD requirement | Status | Evidence / notes |
|---|---|---|---|
| §5.2-a | Each tile carries its own dates, detector, wavelength, PSF; always visible | **Partial** | The panel exists and shows RA/Dec per tile, but epoch dates, instrument, wavelength and PSF are **identical hard-coded strings for every tile** (`CaseScreen` metadata `<dl>`). Not visible until a tile is selected. |

### 5.3 Verification pipeline

| ID | Check | Status | Evidence / notes |
|---|---|---|---|
| §5.3-a | Stationary source check | **Done** (simulated) | Rejection reason shown. Result derives from `Tile.kind`. |
| §5.3-b | Blend and halo check | **Done** (simulated) | Only fails for `halo`/`blend` tiles; for movers the "no bright neighbour" note is always a pass. |
| §5.3-c | Catalog cross-match → "known object" with catalogue name | **Partial** | Name, alias, proper motion, distance shown, but from a hand-written `catalog` record in the fixture, not a lookup. |
| §5.3-d | No remaining match → "candidate for follow-up" | **Missing** | `candidate` verdict has a chip but is never emitted. |
| §5.3-e | Results shown to the player, including rejections | **Done** | Staged reveal with per-check notes. |

### 5.4 Scoring and weighted consensus

| ID | Chapter | Status | Evidence / notes |
|---|---|---|---|
| §5.4-a | Ch 1: known answer only | **Done** | Answer-key scoring; copy says "Known answer key". |
| §5.4-b | Ch 2: combined answers of many previous players | **Partial** | A "Weighted consensus" row appears, using constants (0.62 / 0.91) and an analyst count derived from the tile code. Results can end as `pending` with no resolution path. |
| §5.4-c | Ch 3–4: high-rank flags count more | **Partial** | `RANKS[].weight` exists and is displayed (Rankings, rank-up card, check note), but is **not used in any computation**. |
| §5.4-d | Ch 5: expert consensus + full pipeline for follow-up | **Missing** | |

---

## 6. §6 Progression

### 6.1 Ranks — needs a decision

| ID | GDD requirement | Status | Evidence / notes |
|---|---|---|---|
| §6.1-a | Rank titles and level of unlock | **Done** | Titles and levels 1/11/21/31/41 match `RANKS`. |
| §6.1-b | "Cumulative tiles reviewed" column | **Diverges** (probable) | See analysis below. |

**Why the thresholds are probably wrong.** The GDD column reads 100–120 / 200–250 / 320–380 / 420–480 / 500+.
The code uses `0 / 200 / 320 / 420 / 500`, i.e. it treats each row's number as the tiles needed to *reach*
that rank. Test that against the rest of the GDD:

| Reading | Rank 2 (Level 11) | Rank 3 (Level 21) | Consistent with 10–15 tiles per level? |
|---|---|---|---|
| **A (code today):** value = tiles needed to enter the rank | 200–250 tiles | 320–380 tiles | **No.** Levels 1–10 hold only 100–150 tiles, so Rank 2 is unreachable by completing Chapter 1. |
| **B:** value = cumulative tiles when the rank is *completed* | 100–120 tiles | 200–250 tiles | **Yes.** 10 levels × 10–12 ≈ 100–120; 20 levels ≈ 200–250; 50 levels ≈ "upward of five hundred" (§10.2). |

Reading B fits every other number in the GDD, so it is the likely intent. Under B the thresholds
would be roughly **0 / 110 / 225 / 350 / 450** (range midpoints), with 500+ as the full-campaign total.
That is a **proposal**, not a GDD value; the owner should pick exact numbers.
Consequences if changed: update `RANKS`, `DEMO_SAVE` (189 tiles), the Title button label
("11 tiles from promotion"), the Presenter "Unlock Chapter 2" helper, and the Rank ladder copy.

### 6.2 Experience and unlocks

| ID | GDD requirement | Status | Evidence / notes |
|---|---|---|---|
| §6.2-a | XP from bonus inspection, never from the mandatory target alone | **Done** | Target `known` awards 0 XP. Tutorial adds +50 "training reward" and a clean-case bonus adds +40 (**Beyond GDD**; see §13). |
| §6.2-b | Tools unlock at the start of a chapter, after a short guided lesson | **Partial** | Unlock is rank-gated, with a lesson **card** in the briefing for chapter ≥ 2. The Rank-up card promises "a short guided lesson", which today is that card, not a Guide-led walkthrough. |

---

## 7. §7 Narrative

| ID | GDD requirement | Status | Evidence / notes |
|---|---|---|---|
| §7.1-a | Detective hired to investigate survey irregularities | **Done** | Copy in briefings and Archive. |
| §7.2-a | Five chapter titles and arcs | **Done** | `CHAPTERS` mirrors the GDD synopses. |
| §7.2-b | Chapter 3 payoff (identify the cold companion) | **Partial** | `cold-hand` badge defined, never awarded; no ch 3 content. |
| §7.3-a | Measured field-report tone; rejection = progress | **Done** | e.g. "A dismissed lead is still progress…" |

---

## 8. §8 Onboarding

### 8.1 Guided tutorial steps

| GDD step | Player must | Code step | Status | Notes |
|---|---|---|---|---|
| 1 | Read first case, tap continue | 1 | **Done** | "Begin Investigation" button. |
| 2 | Open the tile | 2 | **Done** | Target thumbnail pulses and is spotlighted. |
| 3 | Toggle blink at least once | 3 | **Partial** | Code requires **two** blink ticks (the player must see it flip), slightly stricter than the GDD. |
| 4 | Flag the tile the guide points to | 4 | **Partial** | Code spotlights the whole inspect area (not the flag button) and the player must also **place a marker** first. The GDD sequence has no marker step. Hint rings reveal the answer on purpose. |
| 5 | View result and why | 5 | **Done** | Verification panel is spotlighted; manual "File the report". |
| 6 | Collect XP reward, see progress to Rank 2 | 6 | **Diverges** | Soft-lock: spotlight resolves to the HUD XP bar, which blocks "Collect reward"; no manual button (R1/G1). Needs playthrough. |
| 7 | Confirm next level unlocked | 7 | **Done** | Case 2 node spotlighted; "Got it" or click the node. |

### 8.2 Content rules

| ID | GDD requirement | Status | Notes |
|---|---|---|---|
| §8.2-a | Tutorial uses a guaranteed-correct tile | **Done** | Barnard's Star (a deterministic mover). |
| §8.2-b | Cannot skip ahead of the current step; can skip the whole tutorial any time | **Done** | Click-blockers + "Skip tutorial" link. |
| §8.2-c | Guide never blocks the colour-blind toggle | **Diverges** | `.guide-layer` (z 80) blockers cover the HUD (z 50) in all spotlight steps; the toggles are unreachable until the tutorial ends or is skipped. They *are* reachable on the Title screen, which precedes the tutorial. |
| §8.2-d | Replayable from settings | **Done** | Settings → Replay. |

---

## 9. §9 Accessibility

| ID | GDD requirement | Status | Evidence / notes |
|---|---|---|---|
| §9.1-a | Three modes from the first screen, before login | **Done** | Toggles on the Title screen. There is no login yet (PLAN item 3). |
| §9.1-b | Switching never changes game logic | **Done** | Only `data-theme` / `data-cb` attributes and CSS. |
| §9.2-a | Okabe–Ito colours for every meaning-bearing colour | **Partial** | See palette check below. |

### 9.2 Palette check (colour-blind mode)

| GDD colour | Hex | GDD meaning | Code token | Matches? |
|---|---|---|---|---|
| Orange | E69F00 | Rank / XP | `--rank` | Yes |
| Sky blue | 56B4E9 | Known object | `--known` | Yes (dark). Light + cb overrides to `#2a8bc4` for contrast. |
| Bluish green | 009E73 | Accepted / passed | `--ok` | Yes |
| Yellow | F0E442 | Pending | `--pending` | Yes (dark). Light + cb overrides to `#8f8500`. |
| Blue | 0072B2 | Info / metadata | `--info` | Yes |
| Vermillion | D55E00 | Rejected | `--bad` | Yes |
| Reddish purple | CC79A7 | Candidate | `--cand` | Yes |
| Black | 000000 | Default text | `--text` | **No.** Text keeps the theme colour (near-white on dark). Black on the dark theme would be unreadable, so this is a sensible deviation but should be recorded in the GDD. |

Also: `--rank-deep` in cb mode (`#9c6b00`) is a derived shade, not a palette colour. Status is never colour-only (each verdict has its own icon), which satisfies the intent.

---

## 10. §10 Content plan

| ID | GDD requirement | Status | Evidence / notes |
|---|---|---|---|
| §10.1-a | SPHEREx Level 2 spectral images as tiles | **Missing** | See §1-a. |
| §10.1-b | SPHEREx spectral mosaic tool for multi-band views | **Missing** | Dossier uses SkyView DSS / 2MASS / WISE as a stand-in. |
| §10.1-c | SPHEREx spectrophotometry tool for light curves | **Missing** | |
| §10.1-d | Public star/small-body catalogues for cross-match and the tutorial tile | **Partial** | Five star records hand-typed in fixtures. No small-body (asteroid/comet) records at all. |
| §10.2-a | 50 levels × 10–15 tiles, 500+ distinct tiles reviewed | **Partial** | 5 of 50 levels authored (cases 1–4, 11); **12 distinct tiles total**, reused by every case. |
| §10.3-a | Chapter 5 live, unreviewed real tiles | **Missing** | |

---

## 11. §11 Systems overview

| ID | System | Status | Where it lives today |
|---|---|---|---|
| §11-a | Client | **Done** | `src/` |
| §11-b | Verification service | **Missing** | `verify()` in `CaseScreen.tsx` (PLAN item 4) |
| §11-c | Progress & consensus service | **Missing** | `localStorage` via `store.tsx` (PLAN items 3, 5) |
| §11-d | Data service | **Missing** | `fixtures.ts` + `/public/sky` (PLAN item 2) |

---

## 12. §12 Success criteria

| ID | Criterion | Status | Why |
|---|---|---|---|
| §12-a | New player finishes tutorial and level 1 unaided | **Missing** (likely blocked) | Step 6 soft-lock (R1). Needs a playthrough to confirm. |
| §12-b | One full chapter playable on real, registered SPHEREx data | **Missing** | Real DSS, not SPHEREx; chapter 1 has 4 of 10 cases. |
| §12-c | Every flag returns a visible, correct verification result incl. rejections | **Done** (client-side) | "Correct" is defined by fixtures. |
| §12-d | Three modes functional and reachable before login | **Done** | |
| §12-e | No text claims a confirmed discovery or names Planet X | **Done** | Verified by search of the files read; add a CI grep to keep it true (see §14). |

---

## 13. Beyond the GDD (implemented, not specified)

These need either a GDD entry or a deliberate removal.

| Feature | Where | Note |
|---|---|---|
| XP values (15 clear / 60 known / 10 artifact / 5 stationary), +50 tutorial, +40 clean-case | `verify()`, `summary` | GDD gives no numbers |
| Hit radius of 8 % of plate for a correct flag | `verify()` | Needs justification against the real PSF/pixel scale |
| Consensus **weights** 1.0 / 1.4 / 2.1 / 2.9 / 4.0 | `RANKS` | Not derived in GDD §5.4 |
| Rankings, podium, four tabs, season countdown, "Team Pleiades" | `Rankings.tsx` | GDD only forbids chat/social; leaderboards are an open product decision |
| Badges (9 defined, 7 awarded), case history, streak | `fixtures.ts`, `Dossier.tsx` | |
| Callsign sign-in (no account) | `Title.tsx` | Precursor to PLAN item 3 |
| Presenter panel, demo save | `Chrome.tsx`, `store.tsx` | Demo-only |
| Loupe, keyboard shortcuts, sound effects, starfield | various | Polish |
| "Mission" briefing/Archive screen with credits | `Archive.tsx` | Useful for attribution; not in GDD |

---

## 14. GDD problems and open questions

Issues in the GDD itself that the code cannot resolve.

| # | Issue | Suggested resolution |
|---|---|---|
| Q1 | §6.1 rank table is ambiguous (analysis in §6.1 above) | Owner picks reading B and exact thresholds |
| Q2 | §3.1 says one SPHEREx pair, but §10.2 needs 500+ distinct tiles and §12 needs a full chapter | Decide how many distinct tiles one region/pair supplies and what the minimum authored set is |
| Q3 | §6.2 says XP never comes from the target alone, yet §8.1 step 6 has the player collect an XP reward on a target-only tutorial case | Document the +50 training reward as the explicit exception |
| Q4 | §8.1 step 4 omits marker placement | Add it, or make flagging a tile not require a marker |
| Q5 | §5.4 gives no consensus parameters (reviewers needed, agreement threshold, weight curve) | Specify before PLAN item 5 |
| Q6 | §9.2 assigns Black to default text | Clarify behaviour per theme |
| Q7 | §9.1 mentions "login", but accounts are not in scope until later | Reword or schedule |
| Q8 | Title says "Team Pleadies" (code and README use "Pleiades") | Fix spelling |
| Q9 | SPHEREx pixel scale and revisit cadence vs proper motion of nearby stars | Spike needed: Barnard's Star (≈10″/yr) may not shift visibly across SPHEREx epochs a few months apart, so the guaranteed tutorial tile will probably need a solar-system mover with a small-body catalogue record. Confirm against real SPHEREx specs before authoring. |

## 15. Data implications of moving to SPHEREx (summary)

Everything below is hard-coded to POSS/DSS today and will need to become per-tile data:

- Epoch tags in `TileViewer` ("EPOCH A · POSS-I · 1950s" / "EPOCH B · POSS-II · ~1990").
- The metadata `<dl>` in `CaseScreen` (instrument, wavelength, PSF, source).
- Catalogue record shape (`pm`, `distance` suit stars; asteroids/comets need designation, orbit/ephemeris).
- Archive copy about Barnard's Star "about four arcminutes between two Palomar plates".
- `fetch-sky.mjs` and the 512 px / arcsec-per-pixel maths.
- The 8 % hit-radius rule and the `a`/`b` pixel positions.

## 16. Keeping this document current

- When a requirement changes status, edit its row and the scoreboard counts in §0.
- Add new GDD requirements as new IDs; never renumber existing ones.
- Suggested CI check for §2-e / §12-e: fail the build if `src/**` contains `Planet X`, or the word `confirmed` outside an allow-list (Archive rule text, catalogue notes).
- Cross-reference IDs in `PLAN.md` exit criteria, e.g. "milestone 2 is done when §3.1-a, §10.1-a, §5.2-a are Done".