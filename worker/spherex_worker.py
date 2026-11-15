#!/usr/bin/env python3
"""SPHEREx processing worker (PLAN.md item 2: 'Worker, jobs, and cache').

Runs astropy/Photutils/reproject processing OUTSIDE Netlify Functions. It
polls the Supabase `processing_jobs` queue (claimed atomically with
'for update skip locked'), verifies IRSA cutout support with a bounded GET
before ever accepting a download, produces one product per claimed job,
uploads the artifact to object storage under a versioned cache key, and
records worker failure as the job's reason — which the orchestration layer
exposes as capability 'unavailable: <reason>'.

Speed. Job time is dominated by IRSA latency, not CPU (reproject + PNG is
~0.3 s per image at the 512 px cap). So all downloads ride one shared,
long-lived thread pool over warm keep-alive connections (lib/cutouts.py), and
blink-pair submits the target plus every reference candidate at once: the UI
sorts candidates by time, not wavelength, and the default passband tolerance
is 0.00, so the first candidate often fails the passband match and the old
serial loop paid one full download per rejected candidate. The pool is bounded
and FIFO, so IRSA never sees more than WORKER_DOWNLOAD_CONCURRENCY requests at
once from this worker, candidates still start in order, and candidates that
have not started yet are cancelled as soon as a job no longer needs them.

Env:
  SUPABASE_URL              project URL (required)
  SUPABASE_SERVICE_ROLE_KEY service_role key (required; the worker is trusted)
  SPHEREX_BUCKET            storage bucket for products (default 'spherex-products')
  WORKER_POLL_SECONDS       poll interval (default 5)
  WORKER_ID                 identity for claim bookkeeping (default host-pid)
  WORKER_DOWNLOAD_CONCURRENCY  simultaneous IRSA downloads (default 6, the usual
                            browser per-host limit; lower it on small machines,
                            each in-flight cutout is held in memory)

Never runs inside a Netlify Function; deploy near IRSA (see worker/README.md).
Photometry jobs currently fail closed: the worker does not yet load the
detector solid-angle map, science-grade CWAVE/CBAND calibration, or validated
spatial PSF/ePSF fits required to produce a scientific measurement.
"""
from __future__ import annotations

import http.client
import json
import os
import socket
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# TLS trust: verify certificates against the OS trust store. On Windows, Python
# only sees roots/intermediates already installed there, so IRSA downloads could
# fail with "[SSL: CERTIFICATE_VERIFY_FAILED] unable to get local issuer
# certificate" (surfaced as the job's failure reason). Must run before any HTTPS
# request. Optional: without truststore (or on Python < 3.10) the default certs /
# SSL_CERT_FILE are used, as before.
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

from dotenv import load_dotenv

# Load the ignored project-root .env for local runs; real environment secrets win.
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)

from lib import cutouts, products
from lib.cache_keys import upload_path
from lib.jobs import Jobs, RestError
from lib.cutouts import NotFits, PayloadTooLarge
from lib.photometry import PhotometryError, extract_source_photometry
from lib.blink import BlinkError, compose_band_channels, register_blink_pair

BUCKET = os.environ.get("SPHEREX_BUCKET", "spherex-products")
POLL_SECONDS = float(os.environ.get("WORKER_POLL_SECONDS", "5"))
WORKER_ID = os.environ.get("WORKER_ID", f"{socket.gethostname()}-{os.getpid()}")


def _download_pool_size() -> int:
    try:
        return max(1, int(os.environ.get("WORKER_DOWNLOAD_CONCURRENCY", "6")))
    except ValueError:
        return 6


# One long-lived download pool for the whole process. Threads are created
# lazily by submit() and reused across jobs, so no job pays thread spin-up and
# each thread keeps its warm keep-alive connections. The queue is FIFO. Downloads
# never submit back into this pool, so waiting on a future from a job cannot
# starve it. A failure never blocks on joining survivors (the cost of a
# per-call 'with ThreadPoolExecutor(...)').
DOWNLOAD_POOL = ThreadPoolExecutor(max_workers=_download_pool_size(), thread_name_prefix="cutout")

_DEPS_STATUS: dict | None = None


def _dependency_status() -> dict:
    """detect_dependencies() cannot change inside one process; probe it once."""
    global _DEPS_STATUS
    if _DEPS_STATUS is None:
        _DEPS_STATUS = products.detect_dependencies()
    return _DEPS_STATUS


def _cancel_pending(futures) -> None:
    """Drops downloads that have not started; running ones finish and are discarded."""
    for future in futures:
        future.cancel()


def _download_all(urls: list[str]) -> list:
    """Downloads cutouts concurrently, returning results in input order.

    Raises the first failure to COMPLETE (wall-clock order) instead of the
    first in input order: the job fails either way, but as early as possible.
    Futures that have not started yet are cancelled on the way out.
    """
    futures = {DOWNLOAD_POOL.submit(cutouts.download_verified_cutout, url): index
               for index, url in enumerate(urls)}
    results: list = [None] * len(urls)
    try:
        for done in as_completed(futures):
            results[futures[done]] = done.result()
        return results
    except BaseException:
        _cancel_pending(futures)
        raise


def process_job(job, jobs: Jobs, supabase_url: str, deps_status=None) -> str:
    """Runs one claimed job end to end; returns the uploaded object path.

    Any failure path raises; the caller records it as the job's reason.
    """
    if deps_status is None:
        deps_status = _dependency_status()
    if not isinstance(job.get("params", {}), dict):
        raise ValueError("job params must be an object")
    product = str(job.get("product") or "")
    if product not in ("cutout-render", "photometry", "blink-pair", "band-composite"):
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
    ra = float(job["ra"])
    dec = float(job["dec"])

    # 1. Verify cutout support FIRST — never accept a 'cutout' that is a full MEF.
    if product == "blink-pair":
        params = job.get("params") or {}
        reference_url = str(params.get("referenceCutoutUrl") or "")
        if not reference_url:
            raise RuntimeError("blink-pair job is missing its reference cutout")
        raw_candidates = params.get("referenceCandidates")
        candidates = json.loads(raw_candidates) if raw_candidates else []
        if not candidates:
            candidates = [{"cutoutUrl": reference_url, "obsId": params.get("referenceObsId"), "date": None}]
        if (not isinstance(candidates, list) or len(candidates) > 8
                or not all(isinstance(candidate, dict) for candidate in candidates)):
            raise RuntimeError("blink-pair job contains an invalid reference candidate list")
        # Start the target and EVERY candidate now; candidate downloads queue FIFO
        # behind the bounded pool, so a candidate is already downloaded (or in
        # flight) by the time registration needs it, and registration (~0.3 s of
        # numpy/reproject, which releases the GIL) overlaps the remaining downloads.
        target_future = DOWNLOAD_POOL.submit(cutouts.download_verified_cutout, cutout_url)
        candidate_futures = [
            DOWNLOAD_POOL.submit(cutouts.download_verified_cutout, str(candidate.get("cutoutUrl") or ""))
            for candidate in candidates
        ]
        try:
            body, verified = target_future.result()  # target failure raises immediately
        except BaseException:
            _cancel_pending(candidate_futures)
            raise
    elif product == "band-composite":
        params = job.get("params") or {}
        raw_channels = params.get("channels")
        channels = json.loads(raw_channels) if raw_channels else []
        if not isinstance(channels, list) or len(channels) != 3:
            raise RuntimeError("band-composite job must contain exactly three channels")
        # Target + three channel cutouts are independent: download them concurrently
        # (the target is normally one of the channels, so duplicates are fetched once).
        channel_urls = list(dict.fromkeys(
            [cutout_url, *(str(channel.get("cutoutUrl") or "") for channel in channels)]))
        downloaded = dict(zip(channel_urls, _download_all(channel_urls)))
        body, verified = downloaded[cutout_url]
    elif product == "photometry":
        body, verified = cutouts.download_verified_cutout(cutout_url)
    else:
        body = None
        verified = cutouts.verify_cutout_support(cutout_url)
    print(f"  {job.get('id', '?')}: cutout verified ({verified['bytes']} bytes, {verified['headerKeywords']})")

    # 2. Build the product only after the bounded cutout has been verified.
    if product == "blink-pair":
        params = job.get("params") or {}
        failures = []
        payload_object = None
        try:
            for index, candidate in enumerate(candidates):
                try:
                    reference_body, reference_verified = candidate_futures[index].result()
                except Exception as error:
                    failures.append(f"{candidate.get('obsId', 'candidate')}: {type(error).__name__}: {error}")
                    continue
                try:
                    result = register_blink_pair(
                        body, reference_body, ra, dec, float(job["size_deg"]), params,
                    )
                except BlinkError as error:
                    if not str(error).startswith("Observations do not meet the configured target-pixel passband match:"):
                        raise
                    failures.append(f"{candidate.get('obsId', 'candidate')}: {error}")
                    continue
                result["matchedReference"] = {"obsId": candidate.get("obsId"), "date": candidate.get("date")}
                result["candidateAttempts"] = len(failures) + 1
                result["cutouts"] = {"first": verified, "second": reference_verified}
                payload_object = result
                break
        finally:
            _cancel_pending(candidate_futures)  # candidates this job no longer needs
        if payload_object is None:
            details = " | ".join(failures[-3:])
            raise RuntimeError(f"No matching passband found in {len(candidates)} candidate observations. {details}")
    elif product == "band-composite":
        params = job.get("params") or {}
        channel_blobs = []
        for channel in channels:
            channel_body, _channel_verified = downloaded[str(channel.get("cutoutUrl") or "")]
            channel_blobs.append({**channel, "fits": channel_body})
        payload_object = compose_band_channels(
            channel_blobs, ra, dec, float(job["size_deg"]),
            float(params.get("pixelScaleArcsec", 6.2)),
        )
        payload_object["cutouts"] = {"channels": [
            {"color": channel["color"], "url": channel["cutoutUrl"]}
            for channel in channels
        ]}
    elif product == "photometry":
        payload_object = extract_source_photometry(body, ra, dec, job.get("params") or {})
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
    """Uploads one product artifact to Supabase Storage (service key auth).

    Rides the same keep-alive layer as cutout downloads (cutouts.post_bytes),
    so the storage host's TCP + TLS setup is paid once per worker thread, not
    once per job. Upload is x-upsert to a deterministic path, so a transparent
    re-send after a stale-connection reconnect is idempotent.
    """
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not service_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required to upload worker products")
    url = f"{supabase_url.rstrip('/')}/storage/v1/object/{BUCKET}/{path}"
    try:
        status, _headers, _body = cutouts.post_bytes(url, payload, headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "x-upsert": "true",
            "User-Agent": cutouts.USER_AGENT,
        })
    except (http.client.HTTPException, OSError) as error:
        raise RuntimeError(f"storage unreachable: {error}") from None
    if not 200 <= status < 300:
        raise RuntimeError(f"storage upload failed: HTTP {status}")


def main() -> int:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not supabase_url or not service_key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required", file=sys.stderr)
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
            DOWNLOAD_POOL.shutdown(wait=False, cancel_futures=True)  # don't wait on queued downloads
            return 0


if __name__ == "__main__":
    sys.exit(main())