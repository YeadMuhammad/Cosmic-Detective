# Cosmic Detective: Roadmap

1. **Presentation front end (done).** Title screen, campaign case board (5 chapters, 50 cases), investigation screen with Blink Comparator and Difference Imaging on real NASA SkyView plates, visible verification pipeline, debrief with XP and rewards, rank-up celebration, rankings, dossier, mission briefing, settings, 7-step guided tutorial on Barnard's Star, dark/light/Okabe–Ito modes, presenter controls (Shift+P).
2. **Data service.** Serve registered SPHEREx Level 2 tile pairs and metadata in place of the DSS fixtures in `src/data/fixtures.ts`.
3. **Player accounts and progress.** Netlify Identity sign-in; move progress from localStorage to Netlify Database.
4. **Verification service.** Server-side stationary, blend/halo and catalogue cross-match checks.
5. **Consensus and live leaderboards.** Weighted agreement per Section 5.4; replace demo players.
6. **Chapters 3–5 tools.** Chapter 3 Multi-band compositor with sector map (case 21, real DSS/2MASS/WISE Barnard's Star sector) and Chapter 4 Light Curve Analyzer (case 31, modelled curves; import real photometry with `scripts/import-lightcurve.mjs`) are in. Remaining: more registered sectors (`scripts/fetch-bands.mjs`), real archival curves, and the Chapter 5 research suite with candidate export.
7. **Authoring the remaining cases** (levels 5–50) and Chapter 5 live tiles.
