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

    pip install -r worker/requirements.txt
    set SUPABASE_URL=...
    set SUPABASE_SERVICE_KEY=...        # service_role; worker is trusted infra
    python worker/spherex_worker.py

    # tests (no network, no Supabase):
    python -m unittest discover -s worker/tests

## Deploy near IRSA

Cutouts come from `irsa.ipac.caltech.edu`; run this worker in a region close
to it (e.g. a small container host in us-west) with an egress allow-list for
`*.ipac.caltech.edu` and your Supabase project. The bundled Dockerfile is the
reference image (Python 3.11 slim + astropy stack, ~1 GB).
