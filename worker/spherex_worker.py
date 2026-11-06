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
  SUPABASE_SERVICE_ROLE_KEY service_role key (required; the worker is trusted)
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
from pathlib import Path
import urllib.request
from urllib.error import HTTPError, URLError
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


def process_job(job, jobs: Jobs, supabase_url: str, deps_status=None) -> str:
    """Runs one claimed job end to end; returns the uploaded object path.

    Any failure path raises; the caller records it as the job's reason.
    """
    if deps_status is None:
        deps_status = products.detect_dependencies()
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

    # 1. Verify cutout support FIRST — never accept a 'cutout' that is a full MEF.
    if product == "blink-pair":
        params = job.get("params") or {}
        reference_url = str(params.get("referenceCutoutUrl") or "")
        if not reference_url:
            raise RuntimeError("blink-pair job is missing its reference cutout")
        body, verified = cutouts.download_verified_cutout(cutout_url)
        raw_candidates = params.get("referenceCandidates")
        candidates = json.loads(raw_candidates) if raw_candidates else []
        if not candidates:
            candidates = [{"cutoutUrl": reference_url, "obsId": params.get("referenceObsId"), "date": None}]
        if not isinstance(candidates, list) or len(candidates) > 8:
            raise RuntimeError("blink-pair job contains an invalid reference candidate list")
    elif product == "band-composite":
        body, verified = cutouts.download_verified_cutout(cutout_url)
        params = job.get("params") or {}
        raw_channels = params.get("channels")
        channels = json.loads(raw_channels) if raw_channels else []
        if not isinstance(channels, list) or len(channels) != 3:
            raise RuntimeError("band-composite job must contain exactly three channels")
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
        for candidate in candidates:
            candidate_url = str(candidate.get("cutoutUrl") or "")
            try:
                reference_body, reference_verified = cutouts.download_verified_cutout(candidate_url)
            except Exception as error:
                failures.append(f"{candidate.get('obsId', 'candidate')}: {type(error).__name__}: {error}")
                continue
            try:
                result = register_blink_pair(
                    body, reference_body, float(job["ra"]), float(job["dec"]),
                    float(job["size_deg"]), params,
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
        if payload_object is None:
            details = " | ".join(failures[-3:])
            raise RuntimeError(f"No matching passband found in {len(candidates)} candidate observations. {details}")
    elif product == "band-composite":
        params = job.get("params") or {}
        channel_blobs = []
        for channel in channels:
            if channel.get("cutoutUrl") == cutout_url:
                channel_body, channel_verified = body, verified
            else:
                channel_body, channel_verified = cutouts.download_verified_cutout(str(channel.get("cutoutUrl") or ""))
            channel_blobs.append({**channel, "fits": channel_body})
        payload_object = compose_band_channels(
            channel_blobs, float(job["ra"]), float(job["dec"]),
            float(job["size_deg"]), float(params.get("pixelScaleArcsec", 6.2)),
        )
        payload_object["cutouts"] = {"channels": [
            {"color": channel["color"], "url": channel["cutoutUrl"]}
            for channel in channels
        ]}
    elif product == "photometry":
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
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
    if not service_key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required to upload worker products")
    url = f"{supabase_url.rstrip('/')}/storage/v1/object/{BUCKET}/{path}"
    request = urllib.request.Request(url, data=payload, method="POST", headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
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
            return 0


if __name__ == "__main__":
    sys.exit(main())
