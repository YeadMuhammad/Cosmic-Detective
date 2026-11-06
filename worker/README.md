# SPHEREx processing worker

Runs the FITS processing (astropy / Photutils / reproject) that must never run
inside Netlify Functions (PLAN.md item 2, "Worker, jobs, and cache"):

    Netlify (orchestration)  ->  Supabase processing_jobs queue
                             ->  this worker (polls, claims, processes)
                             ->  Supabase Storage products, keyed by versioned
                                 cache keys (worker/cache_key_cases.json)

## Contract

- **Claim atomically.** One job at a time via `POST /rpc/claim_processing_job`
  (SQL `for update skip locked`, see `supabase/migrations/20261105000000_processing_jobs.sql`).
  Apply `supabase/migrations/20261106000000_blink_pair_product.sql` to allow the
  `blink-pair` product before submitting registered comparison jobs.
- **Verify cutout support first.** Every download goes through bounded
  `verify_cutout_support()`; a response bigger than the cap, or anything that
  is not FITS, fails the job with that reason. Full MEFs are never downloaded.
- **Versioned cache keys.** Products upload to
  `spherex/<keyVersion>/<product>/<collection>/<obsId>/<detector>/<release>/<geo>/<paramsHash>`
  — identical strings to `netlify/lib/processing.mjs` (shared goldens in
  `worker/cache_key_cases.json`, locked by both test suites). Bump
  `KEY_VERSION` / `keyVersion` together when semantics change.
- **Failure is data.** Any error records `status: 'failed'` + `error_reason`
  on the job row; orchestration exposes it as `unavailable: <reason>` — never
  a silent fallback.

## Product stages today

- `cutout-render`: verify-cutout → read-image (astropy) → stretch-render.
- `blink-pair`: downloads bounded cutouts and checks target-pixel WCS-WAVE.
  Requests can provide up to 8 same-detector/release reference candidates; the
  worker skips passband mismatches and registers the first candidate within the
  strict wavelength and bandwidth gates. It reprojects the matching IMAGE
  planes to a shared target-centered TAN grid and returns both epochs with a
  shared display stretch. This is visual comparison only: flags are not
  overlaid and it is not a difference or detection product.
- `photometry`: verifies the cutout, then fails closed with the missing science
  calibration requirements. No photometry artifact is currently published.

The earlier prototype incorrectly treated PSF cube planes as wavelength
samples and estimated pixel solid angle from the display WCS. SPHEREx PSF cube
planes are spatial zones and the PSF models are oversampled. Until the worker
loads the detector solid-angle map, science-grade CWAVE/CBAND calibrations, and
fits the correctly selected PSF/ePSF with validated uncertainty propagation,
photometry requests are marked failed and the portal cannot treat them as
available measurements. ZODI is a modeled background and must not be
subtracted twice when extraction is implemented.

## Run

From the repository root, install Python dependencies once, then run Netlify
Dev and the worker together:

    python -m pip install -r worker/requirements.txt
    npm run dev:all

`dev:all` launches Netlify CLI through `npx` and starts the Python worker. The
first launch downloads Netlify CLI if it is not already present in the npm
cache. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the root
`.env` file before starting; the worker loads that file automatically.

For local runs, the worker reads `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` from the ignored root `.env` file. It also accepts
`SUPABASE_SERVICE_KEY` as a legacy name. Deployed workers should receive these
as environment secrets. The worker prints each claimed job and its completion
or failure, so a job that remains queued indicates no worker has claimed it.

    # tests (no network, no Supabase):
    python -m unittest discover -s worker/tests

## Deploy near IRSA

Cutouts come from `irsa.ipac.caltech.edu`; run this worker in a region close
to it (e.g. a small container host in us-west) with an egress allow-list for
`*.ipac.caltech.edu` and your Supabase project. The bundled Dockerfile is the
reference image (Python 3.11 slim + astropy stack, ~1 GB).
