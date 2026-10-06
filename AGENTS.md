# Agent notes

- SPA with hash routing (`src/lib/store.tsx` `useRoute`); screens in `src/screens/`, shared UI in `src/components/`.
- All content and demo fixtures (tiles, chapters, ranks, players) live in `src/data/fixtures.ts`. Swap this module for real services later.
- Game state lives in localStorage (`GameProvider`), and is demo-only.
- `verify()` in `CaseScreen.tsx` stands in for the verification service.
- Sky images in `public/sky/` are real data from `scripts/fetch-sky.mjs`. Never use generated sky images (a design pillar). Mover pixel positions are hand-measured on 512px tiles.
- Never claim a "confirmed discovery" in copy.
- Theme via `data-theme` / `data-cb` CSS variables in `src/styles.css`. Okabe–Ito is used in colorblind mode.
- Continue from PLAN.md.
