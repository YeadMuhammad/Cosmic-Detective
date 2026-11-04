# Cosmic Detective: Roadmap

1. **Presentation front end (done).** Title screen, campaign case board (5 chapters, 50 cases), investigation screen with Blink Comparator and Difference Imaging on real NASA SkyView plates, visible verification pipeline, debrief with XP and rewards, rank-up celebration, rankings, dossier, mission briefing, settings, 7-step guided tutorial on Barnard's Star, dark/light/Okabe–Ito modes, presenter controls (Shift+P).
2. **SPHEREx live-data foundation.** Milestones, in order:
   - [x] **Step 0 — CORS and cutout spike.** A real QR2 MEF cutout responds to GET and includes the required extensions. Direct browser CORS is not relied upon; the existing Netlify proxy is extended for restricted cutout access, and FITS processing stays out of the archive function.
   - [x] **Browse viewer (public, display-only).** Guest users can enter RA/Dec and FOV, persist URL state (`?ra=&dec=&fov=`), render FITS IMAGE cutouts, and play returned observations. Frames retain date, detector, release, and band labels; scientific comparison tools remain disabled. `frame-ancestors` headers allow approved Netlify embeds. Squads remain optional.
   - [ ] **Metadata capabilities and registry.** Extend the IRSA adapter to group observations by footprint, detector, channel, processing release, survey pass, and time; evaluate wavelength at the target pixel; and return `available | unavailable | computing` plus reason codes for Blink, Difference, Light Curve, Phase fold, and Spectrum. Keep same-channel time series separate from cross-channel spectra. Generate the registry from timestamped archive metadata snapshots, seeded with deep fields, ecliptic-pole regions, and Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, and R Draconis. Add per-target acceptance fixtures whose expected capabilities are derived from the snapshot, not hand-asserted.
   - [ ] **Explicit cached demo snapshot.** Add a user-selected `Cached snapshot (date)` mode for slow or unavailable archives, with a persistent `provenance.origin: 'cached-live'` banner and timestamp. Never automatically replace unavailable live data with cached data or generated images. Add a scripted demo path that selects this mode explicitly.
   - [ ] **Worker, jobs, and cache.** Run Astropy/Photutils/reproject processing outside Netlify Functions; Netlify/Supabase orchestrate jobs, rate-limit coordinate queries, and expose `computing`. Use a Python worker and object storage near IRSA. Verify cutout support before downloading full MEFs. Version cache keys by release, observation, detector, cutout geometry, and processing parameters. Worker failure becomes `unavailable` with a reason.
   - [ ] **Native-pixel forced photometry.** Use IMAGE/FLAGS/VARIANCE/ZODI/PSF and spectral WCS at the target pixel. The current Level 2 documentation says IMAGE is not zodi-subtracted and ZODI is the modeled background; verify this per release and never subtract ZODI twice. Fit PSF/ePSF where valid and use aperture extraction only as a documented fallback. Propagate pixel, background, calibration, and extraction uncertainties; reject or annotate flagged, saturated, contaminated, low-S/N, or invalid-PSF points. Validate with injection-recovery, constant-star chi-square, and bright-star catalog-flux tests. Preserve provenance for every point.
   - [ ] **Light Curve and Spectrum.** Build a time series only from quality-approved measurements of the same channel; present cross-channel measurements as a spectrum/SED. Require minimum usable points, baseline, and per-point uncertainties. Treat nondetections as upper limits where scientifically justified, especially for WISE 0855. Live cases use a `dataOrigin: 'live'` discriminated union and cannot reach generated model data.
   - [ ] **Phase fold.** Require a validated live series, trial period, enough cycles, uncertainty-weighted binning, false-alarm estimate, and null-model comparison. Label outputs as periodic signal candidates, never confirmed discoveries.
   - [ ] **Image comparison (experimental).** For validated Blink, require same detector/channel/release, overlap, valid pixels, and catalog-verified astrometric residuals; use common WCS for presentation and keep native-pixel photometry primary. Enable Difference only after PSF matching, local-background validation, and registration noise `(sigma_reg * local_gradient)^2` are validated. Hide the tool when validation fails. Use motion-aware matching for Barnard's Star and WISE 0855. Stacking repeated same-channel observations may improve S/N; combining the six detector arrays is a spectral combination, not an automatic S/N stack.
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
| CORS, alignment, proper motion checks | Step 0; browse viewer; experimental image comparison |
| Contamination flags and metadata | Native photometry; archive validation |
| Add/subtract images | Experimental image comparison |
| Same-channel S/N stacking | Native photometry and worker cache |
| Spectra on demand | Metadata capabilities; Light Curve and Spectrum |
| Gaia/WISE overlays | Archive validation and extensibility |
| New data releases without hard-coded collections | Archive validation and extensibility |
| Optional squads | Browse viewer and explicit public-mode policy |
| Demo script and slow-archive fallback | Explicit cached demo snapshot |
| Five-target acceptance test | Metadata registry and photometry validation |
