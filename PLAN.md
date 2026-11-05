# Cosmic Detective: Roadmap

1. **Presentation front end (done).** Title screen, campaign case board (5 chapters, 50 cases), investigation screen with Blink Comparator and Difference Imaging on real NASA SkyView plates, visible verification pipeline, debrief with XP and rewards, rank-up celebration, rankings, dossier, mission briefing, settings, 7-step guided tutorial on Barnard's Star, dark/light/Okabe–Ito modes, presenter controls (Shift+P).
2. **SPHEREx live-data foundation.** Milestones, in order:
   - [x] **Step 0 — CORS and cutout spike.** A real QR2 MEF cutout responds to GET and includes the required extensions. Direct browser CORS is not relied upon; the existing Netlify proxy is extended for restricted cutout access, and FITS processing stays out of the archive function.
   - [x] **Browse viewer (public, display-only).** Guest users can enter RA/Dec and FOV, persist URL state (`?ra=&dec=&fov=`), render FITS IMAGE cutouts, and play returned observations. Frames retain date, detector, release, and band labels; scientific comparison tools remain disabled. `frame-ancestors` headers allow approved Netlify embeds. Squads remain optional.
   - [x] **Metadata capability contract.** The portal derives `available | unavailable | computing`-shaped capability records and reason codes from returned observation metadata for Blink, Difference, Light Curve, Phase fold, and Spectrum. Same-channel time-series requirements remain separate from cross-channel spectrum metadata, and browse mode keeps scientific comparison tools disabled.
   - [x] **Metadata registry and acceptance fixtures.** Extend the IRSA adapter to group observations by footprint, detector, channel, processing release, survey pass, and time; evaluate wavelength at the target pixel; and generate a registry from timestamped archive metadata snapshots, seeded with deep fields, ecliptic-pole regions, and Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, and R Draconis. Add per-target acceptance fixtures whose expected capabilities are derived from the snapshot, not hand-asserted.
   - [x] **Explicit cached snapshot mode.** Users can select `Cached snapshot (date)` explicitly, with a persistent `provenance.origin: 'cached-live'` banner and timestamp. It never automatically replaces unavailable live data or generated images.
   - [x] **Cached snapshot demo path.** Presenter controls include an explicit cached SPHEREx demo route with `source=cached`; it does not alter live mode or silently fall back.
   - [x] **Worker, jobs, and cache.** Run Astropy/Photutils/reproject processing outside Netlify Functions; Netlify/Supabase orchestrate jobs, rate-limit coordinate queries, and expose `computing`. Use a Python worker and object storage near IRSA. Verify cutout support before downloading full MEFs. Version cache keys by release, observation, detector, cutout geometry, and processing parameters. Worker failure becomes `unavailable` with a reason.
   - [x] **Native-pixel forced photometry.** Use IMAGE/FLAGS/VARIANCE/ZODI/PSF and spectral WCS at the target pixel. The current Level 2 documentation says IMAGE is not zodi-subtracted and ZODI is the modeled background; verify this per release and never subtract ZODI twice. Fit PSF/ePSF where valid, including wavelength-selected PSF cubes, and use aperture extraction only as a documented fallback. Propagate pixel, background, calibration, and extraction uncertainties; reject or annotate flagged, saturated, contaminated, low-S/N, or invalid-PSF points. Synthetic injection/quality tests pass, and every point preserves live-data and ZODI provenance.
   - [x] **Light Curve and Spectrum.** Build a time series only from quality-approved live measurements of the same channel; present measured cross-channel points as a spectrum/SED. The shared validators require minimum usable points, a positive baseline, and per-point uncertainties. Unusable or simulated points cannot enable either capability; upper-limit metadata is preserved for future rendering, especially for WISE 0855.
   - [x] **Phase fold.** Require a validated live series, positive trial period, enough cycles, uncertainty-weighted binning, and null-model comparison. Report folded-model improvement without implying a false-alarm probability. Outputs are labeled periodic signal candidates, never confirmed discoveries; capability remains unavailable until a trial period is supplied.
   - [x] **Image comparison (experimental).** The comparison contract requires same detector/channel/release, overlap, valid pixels, and catalog-verified astrometric residuals; it supports motion-aware offsets for Barnard's Star and WISE 0855 while keeping native-pixel photometry primary. Difference significance includes registration noise `(sigma_reg * local_gradient)^2`; invalid pairs return reasons and remain hidden. Stacking repeated same-channel observations may improve S/N; combining the six detector arrays is a spectral combination, not an automatic S/N stack.
   - [ ] **Archive validation and extensibility.** Add contamination/quality metadata, optional Gaia/WISE overlays, on-demand spectra, and release adapters without hard-coded collections. Rank gates progression and rewards only; scientific availability always comes from the capability response.
3. **Player accounts and progress.** Supabase Auth and Postgres/RLS cloud saves are implemented; retain guest localStorage play and document account work as maintenance/expansion rather than a Netlify migration.
4. **Verification service.** Server-side stationary, blend/halo and catalogue cross-match checks.
5. **Consensus and live leaderboards.** Weighted agreement per Section 5.4; replace demo players.
6. **Chapters 3–5 tools.** Chapter 3 Multi-band compositor with sector map (case 21, real DSS/2MASS/WISE Barnard's Star sector) and Chapter 4 Light Curve Analyzer (case 31, modelled curves; import real photometry with `scripts/import-lightcurve.mjs`) are in. Remaining: more registered sectors (`scripts/fetch-bands.mjs`), real archival curves, and the Chapter 5 research suite with candidate export; live SPHEREx capabilities are tracked in item 2.
7. **Authoring the remaining cases** (levels 5–50) and Chapter 5 live tiles.

## SPHEREx scope traceability

| Requirement | Milestone |
|---|---|
| Public mode, no login/rank, free RA/Dec | Browse viewer |
| Render chosen patch, FOV control, URL embedding | Browse viewer |
| Blink/play the returned series | Browse viewer; validated Blink later |
| Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis | Metadata registry and per-target acceptance fixtures |
| CORS, alignment, proper motion checks | Step 0; experimental image comparison |
| Contamination flags and metadata | Native photometry; archive validation |
| Add/subtract images | Experimental image comparison |
| Same-channel S/N stacking | Native photometry and worker cache; experimental image comparison |
| Spectra on demand | Metadata capabilities; Light Curve and Spectrum |
| Gaia/WISE overlays | Archive validation and extensibility |
| New data releases without hard-coded collections | Archive validation and extensibility |
| Optional squads | Browse viewer and explicit public-mode policy |
| Demo script and slow-archive fallback | Explicit cached demo snapshot; cached mode requires explicit user selection and never automatically replaces unavailable live data |
| Five-target acceptance test | Metadata registry and photometry validation |
