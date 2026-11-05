"""Supabase-backed job queue client (stdlib only, no supabase-py dependency).

Netlify/Supabase orchestrate; the worker claims queued rows through PostgREST:
  claim : POST /rpc/claim_processing_job   (atomic 'for update skip locked' SQL)
  done  : PATCH processing_jobs?id=eq.     status/result_path
  fail  : PATCH processing_jobs?id=eq.     status='failed', error_reason=...

Pure request builders live here so tests can assert the wire contract without
touching the network; `Jobs.postgrest()/rpc()` wrap them in urllib calls.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Mapping, Optional

QUEUE_TABLE = "processing_jobs"


class RestError(Exception):
    """Non-2xx PostgREST response."""


class ClaimedJob(dict):
    """Claimed queue row plus its id, for typed access in the worker loop."""

    @property
    def job_id(self) -> str:
        return str(self["id"])


def postgrest_patch(job_id: str, fields: Mapping[str, Any]) -> "Request":
    return _build("PATCH", f"{QUEUE_TABLE}?id=eq.{job_id}", fields)


def postgrest_claim(worker_id: str) -> "Request":
    return _build("POST", "rpc/claim_processing_job", {"worker_id": worker_id})


class Request:
    """A PostgREST wire request: method, path, json body."""

    def __init__(self, method: str, path: str, body: Any):
        self.method = method
        self.path = path
        self.body = body


def _build(method: str, path: str, body: Any) -> Request:
    if not path.startswith("/"):
        path = "/" + path
    return Request(method, path, body)


def parse_claim(payload: Any) -> Optional[ClaimedJob]:
    """claim_processing_job returns one row object or null when queue is empty."""
    if payload is None:
        return None
    if isinstance(payload, list):
        payload = payload[0] if payload else None
    if not isinstance(payload, dict) or "id" not in payload or payload.get("status") != "running":
        return None
    return ClaimedJob(payload)


class Jobs:
    """Thin PostgREST client over the processing_jobs queue."""

    def __init__(self, supabase_url: str, service_key: str, timeout: float = 30.0):
        if not supabase_url or not service_key:
            raise ValueError("Supabase URL and service key are required")
        self.rest_root = supabase_url.rstrip("/") + "/rest/v1"
        self.timeout = timeout
        self.headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }

    def send(self, request: Request) -> Any:
        url = self.rest_root + request.path
        data = None if request.body is None else json.dumps(request.body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method=request.method, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                text = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            raise RestError(f"{request.method} {request.path} -> HTTP {error.code} {error.read().decode('utf-8', 'replace')}") from None
        except urllib.error.URLError as error:
            raise RestError(f"{request.method} {request.path} -> {error.reason}") from None
        if not text:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None

    def claim(self, worker_id: str) -> Optional[ClaimedJob]:
        return parse_claim(self.send(postgrest_claim(worker_id)))

    def finish(self, job_id: str, result_path: str) -> None:
        self.send(postgrest_patch(job_id, {
            "status": "completed",
            "result_path": result_path,
            "finished_at": "now()",
        }))

    def fail(self, job_id: str, reason: str) -> None:
        self.send(postgrest_patch(job_id, {
            "status": "failed",
            "error_reason": reason[:500],
            "finished_at": "now()",
        }))


def build_upload_path(cache_key_value: str, suffix: str) -> str:
    from .cache_keys import upload_path
    return upload_path(cache_key_value, suffix)


def storage_object_url(supabase_url: str, bucket: str, path: str) -> str:
    """Public-style storage URL fragment the worker uploads to."""
    return f"{supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{path}"
