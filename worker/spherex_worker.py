#!/usr/bin/env python3
"""SPHEREx processing worker (PLAN.md item 2: 'Worker, jobs, and cache').

Runs astropy/Photutils/reproject processing OUTSIDE Netlify Functions. It
polls the Supabase `processing_jobs` queue (claimed atomically with
'for update skip locked'), verifies IRSA cutout support with a bounded GET
before ever accepting a download, produces one product per claimed job,
uploads the artifact to object storage under a versioned cache key, and
records worker failure as the job's reason — which the orchestration layer
exposes as capability 'unavailable: <reason>'.

Env:
  SUPABASE_URL            project URL (required)
  SUPABASE_SERVICE_KEY    service_role key (required; the worker is trusted)
  SPHEREX_BUCKET          storage bucket for products (default 'spherex-products')
  WORKER_POLL_SECONDS     poll interval (default 5)
  WORKER_ID               identity for claim bookkeeping (default host-pid)

Never runs inside a Netlify Function; deploy near IRSA (see worker/README.md).
Photometry jobs currently fail closed: the worker does not yet load the
detector solid-angle map, science-grade CWAVE/CBAND calibration, or validated
spatial PSF/ePSF fits required to produce a scientific measurement.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import time
import urllib.request
from urllib.error import HTTPError, URLError

from lib import cutouts, products
from lib.cache_keys import upload_path
from lib.jobs import Jobs, RestError
from lib.cutouts import NotFits, PayloadTooLarge
from lib.photometry import PhotometryError, extract_source_photometry

BUCKET = os.environ.get("SPHEREX_BUCKET", "spherex-products")
POLL_SECONDS = float(os.environ.get("WORKER_POLL_SECONDS", "5"))
WORKER_ID = os.environ.get("WORKER_ID", f"{socket.gethostname()}-{os.getpid()}")


def process_job(job, jobs: Jobs, supabase_url: str, deps_status=None) -> str:
    """Runs one claimed job end to end; returns the uploaded object path.

    Any failure path raises; the caller records it as the job's reason.
    """
    if deps_status is None:
        deps_status = products.detect_dependencies()
    if not isinstance(job.get("params", {}), dict):
        raise ValueError("job params must be an object")
    product = str(job.get("product") or "")
    if product not in ("cutout-render", "photometry"):
        raise ValueError(f"unsupported product: {product!r}")
    if product == "cutout-render":
        raise RuntimeError("cutout-render not implemented")

    missing = products.dependency_reason({name: deps_status.get(name, False) for name in products.product_dependencies(product)})
    if missing:
        raise RuntimeError(missing)

    cache_key_value = str(job.get("cache_key") or "")
    cutout_url = str(job.get("cutout_url") or "")
    if not cache_key_value or not cutout_url:
        raise RuntimeError("job is missing cache_key or cutout_url")

    # 1. Verify cutout support FIRST — never accept a 'cutout' that is a full MEF.
    if product == "photometry":
        body, verified = cutouts.download_verified_cutout(cutout_url)
    else:
        body = None
        verified = cutouts.verify_cutout_support(cutout_url)
    print(f"  {job.get('id', '?')}: cutout verified ({verified['bytes']} bytes, {verified['headerKeywords']})")

    # 2. Build the product only after the bounded cutout has been verified.
    if product == "photometry":
        payload_object = extract_source_photometry(
            body,
            float(job["ra"]),
            float(job["dec"]),
            job.get("params") or {},
        )
    else:  # guarded above; keep a defensive failure if a new product is added
        raise RuntimeError(f"{product} not implemented")
    payload_object.update({"product": product, "cacheKey": cache_key_value, "cutout": verified})
    suffix = ".json"
    payload = json.dumps({
        **payload_object,
        "worker": WORKER_ID,
        "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }, indent=2).encode("utf-8")

    path = upload_path(cache_key_value, suffix)
    upload_product(supabase_url, path, payload)
    return path


def upload_product(supabase_url: str, path: str, payload: bytes) -> None:
    """Uploads one product artifact to Supabase Storage (service key auth)."""
    url = f"{supabase_url.rstrip('/')}/storage/v1/object/{BUCKET}/{path}"
    request = urllib.request.Request(url, data=payload, method="POST", headers={
        "apikey": os.environ["SUPABASE_SERVICE_KEY"],
        "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_KEY']}",
        "Content-Type": "application/json",
        "x-upsert": "true",
        "User-Agent": cutouts.USER_AGENT,
    })
    try:
        with cutouts.urllib.request.urlopen(request, timeout=60.0) as response:
            response.read()
    except HTTPError as error:
        raise RuntimeError(f"storage upload failed: HTTP {error.code}") from None
    except URLError as error:
        raise RuntimeError(f"storage unreachable: {error.reason}") from None


def main() -> int:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not supabase_url or not service_key:
        print("SUPABASE_URL and SUPABASE_SERVICE_KEY are required", file=sys.stderr)
        return 2
    jobs = Jobs(supabase_url, service_key)
    print(f"worker {WORKER_ID} polling {supabase_url} every {POLL_SECONDS}s (bucket {BUCKET})")
    while True:
        try:
            job = jobs.claim(WORKER_ID)
            if job is None:
                time.sleep(POLL_SECONDS)
                continue
            try:
                path = process_job(job, jobs, supabase_url)
            except Exception as error:
                reason = f"{type(error).__name__}: {error}"
                print(f"  job {job.get('id', '?')}: FAILED — {reason}")
                jobs.fail(job.job_id, reason)
            else:
                print(f"  job {job.get('id', '?')}: completed -> {path}")
                jobs.finish(job.job_id, path)
        except RestError as error:
            print(f"queue unreachable: {error}", file=sys.stderr)
            time.sleep(min(60.0, POLL_SECONDS * 6))
        except KeyboardInterrupt:
            return 0


if __name__ == "__main__":
    sys.exit(main())
