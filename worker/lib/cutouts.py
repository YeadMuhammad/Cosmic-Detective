"""Bounded SPHEREx cutout verification and download helpers (stdlib only).

"Verify cutout support before downloading full MEFs" (PLAN.md item 2): the
worker NEVER downloads an unbounded payload. Every download is a cutout
request (?center=x,y&size=deg), read through read_bounded() which enforces a
byte cap both on the declared Content-Length and on the streamed body, and a
verify_fits() sniff that fails fast when a server ignored the cutout
parameters and is returning the whole MEF (hundreds of MB).

Transport. Downloads and uploads ride persistent keep-alive connections
(stdlib http.client, one connection per thread per host). The worker uses a
small set of long-lived pool threads, so after the first request per
thread+host every further request skips TCP + TLS setup. Servers close idle
keep-alive sockets, so a reused connection that died while idle is retried
exactly once on a fresh connection; that reconnect does NOT consume a
retry-loop attempt. If a proxy applies to the host (HTTP(S)_PROXY, NO_PROXY or
the Windows system proxy settings, exactly as urllib resolves them) the request
goes through urllib instead, because raw http.client ignores proxies; that path
is one-shot (no keep-alive) but behaves the same to callers.

Retries. Transient IRSA failures (502/503/504/429, timeouts, dropped
connections) are retried a few times with backoff. Permanent ones (4xx, TLS
certificate errors, NotFits, PayloadTooLarge) fail immediately.
"""
from __future__ import annotations

import functools
import http.client
import io
import re
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

FITS_BLOCK = 2880
_HEADER_KEYWORD = re.compile(rb"^([A-Z0-9_]+)(?:=|\s*=\s*)?")

USER_AGENT = "cosmic-detective-worker/0.1 (+https://github.com/YeadMuhammad/Cosmic-Detective)"

# IRSA's front-end proxy answers 502 "Error reading from remote server" when its
# backend cutout service stalls; these are worth retrying, other statuses are not.
RETRY_STATUSES = frozenset({429, 502, 503, 504})
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 3.0
MAX_RETRY_AFTER_SECONDS = 30.0

_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_MAX_REDIRECTS = 10  # urllib's default redirection budget

# Symptoms of "the server closed this keep-alive connection while it sat idle".
# The first request after an idle gap hits one of these; the correct price is a
# single immediate reconnect. ConnectionError is the common base of reset,
# aborted (the usual Windows symptom: WinError 10053/10054) and broken pipe.
# Certificate errors are deliberately absent: retrying those can never succeed.
_STALE_ERRORS = (
    http.client.NotConnected,
    http.client.RemoteDisconnected,
    http.client.BadStatusLine,
    ConnectionError,
    ssl.SSLEOFError,
    ssl.SSLSyscallError,
)


class PayloadTooLarge(Exception):
    """The server ignored the cutout parameters and is sending a full MEF."""


class NotFits(Exception):
    """The response body is not a FITS file."""


# ---------------------------------------------------------------------------
# Transport: keep-alive connections (one per thread per host) + proxy fallback
# ---------------------------------------------------------------------------

_thread_state = threading.local()


def _thread_cache() -> dict:
    cache = getattr(_thread_state, "cache", None)
    if cache is None:
        cache = {}
        _thread_state.cache = cache
    return cache


def close_connections() -> None:
    """Closes this thread's cached keep-alive connections (tests, clean exits)."""
    cache = _thread_cache()
    for connection, _served in list(cache.values()):
        connection.close()
    cache.clear()


def _connection_key(url: str):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise ValueError(f"unsupported URL scheme: {parts.scheme!r}")
    default_port = 443 if parts.scheme == "https" else 80
    return (parts.scheme, parts.hostname, parts.port or default_port)


def _new_connection(url: str, timeout: float):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme == "https":
        return http.client.HTTPSConnection(parts.hostname, parts.port or 443, timeout=timeout)
    return http.client.HTTPConnection(parts.hostname, parts.port or 80, timeout=timeout)


def _selector(url: str) -> str:
    """Request target (path + query) for an origin-server request."""
    parts = urllib.parse.urlsplit(url)
    path = parts.path or "/"
    return f"{path}?{parts.query}" if parts.query else path


@functools.lru_cache(maxsize=64)
def _proxied(scheme: str, host: str) -> bool:
    """True when urllib would send this scheme+host through a proxy.

    Cached because Windows resolves proxies from the registry on every call;
    proxy settings do not change inside a running worker (tests call
    _proxied.cache_clear()).
    """
    return bool(urllib.request.getproxies().get(scheme)) and not urllib.request.proxy_bypass(host)


def _borrow(url: str, timeout: float) -> list:
    """Returns this thread's [connection, served] entry for url's host.

    Connections are never shared between threads (no locking, no interleaved
    writes) and the worker downloads from a small set of long-lived pool
    threads, so entries persist across jobs: only the first request per
    thread+host pays for TCP + TLS setup. `served` counts fully-completed
    responses; a positive value marks the connection as previously used. The
    per-call timeout is applied to reused connections too, so an upload's 60 s
    never silently inherits a download's 30 s (or the reverse).
    """
    key = _connection_key(url)
    cache = _thread_cache()
    entry = cache.get(key)
    if entry is None:
        entry = cache[key] = [_new_connection(url, timeout), 0]
    else:
        connection = entry[0]
        connection.timeout = timeout
        if connection.sock is not None:
            connection.sock.settimeout(timeout)
    return entry


def _forget(url: str, entry: list) -> None:
    """Closes a connection and drops it from the cache; its state is unknown."""
    cache = _thread_cache()
    key = _connection_key(url)
    if cache.get(key) is entry:
        del cache[key]
    entry[0].close()


class _UrllibResponse:
    """Gives a urllib result the few http.client.HTTPResponse members used here."""

    def __init__(self, raw):
        self._raw = raw
        self.status = getattr(raw, "status", None) or raw.code
        self.reason = getattr(raw, "reason", "") or ""
        self.headers = raw.headers

    def read(self, amt=None):
        return self._raw.read(amt)

    def close(self) -> None:
        self._raw.close()


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, _request, _response, _code, _msg, _headers, _new_url):
        return None


class _Exchange:
    """One request/response, over a keep-alive connection or a one-shot urllib call.

    The caller must finish with exactly one of: release() after reading the
    body to EOF (the connection stays reusable), or discard() when the
    response was not fully read or its state is unknown.
    """

    __slots__ = ("response", "_url", "_entry")

    def __init__(self, response, url: str, entry):
        self.response = response
        self._url = url
        self._entry = entry  # None means a one-shot urllib exchange

    def release(self) -> None:
        if self._entry is None:
            self.response.close()
        else:
            self._entry[1] += 1

    def discard(self) -> None:
        if self._entry is None:
            self.response.close()
        else:
            _forget(self._url, self._entry)


def _send_via_urllib(
    method: str,
    url: str,
    headers: dict,
    body: bytes | None,
    timeout: float,
    follow_redirects: bool = True,
) -> _Exchange:
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        if follow_redirects:
            raw = urllib.request.urlopen(request, timeout=timeout)
        else:
            opener = urllib.request.build_opener(_NoRedirectHandler)
            raw = opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        raw = error  # non-2xx: carries status, headers and body like a response
    return _Exchange(_UrllibResponse(raw), url, None)


def _send(
    method: str,
    url: str,
    headers: dict,
    body: bytes | None,
    timeout: float,
    follow_redirects: bool = True,
) -> _Exchange:
    """Sends one request, preferring this thread's keep-alive connection.

    A reused connection that died while idle is retried exactly once on a
    fresh connection without consuming a retry-loop attempt.
    """
    parts = urllib.parse.urlsplit(url)
    if _proxied(parts.scheme, parts.hostname or ""):
        return _send_via_urllib(method, url, headers, body, timeout, follow_redirects)
    started = time.monotonic()
    for attempt in (0, 1):
        remaining = timeout - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError("request exceeded its deadline")
        entry = _borrow(url, remaining)
        connection, served = entry
        try:
            connection.request(method, _selector(url), headers=headers, body=body)
            response = connection.getresponse()
        except _STALE_ERRORS:
            _forget(url, entry)
            if served and attempt == 0:
                continue  # idle server closed the socket; pay one reconnect
            raise
        except BaseException:
            _forget(url, entry)  # protocol state is now unknown
            raise
        return _Exchange(response, url, entry)
    raise AssertionError("unreachable")


# ---------------------------------------------------------------------------
# Bounded cutout download
# ---------------------------------------------------------------------------

def verify_fits(head: bytes) -> bool:
    """Cheap FITS sniff on the first 2880-byte header block."""
    if len(head) < FITS_BLOCK:
        return False
    return head[:9] in (b"SIMPLE  =", b"XTENSION") or head[:6] == b"SIMPLE"


def _set_response_timeout(response, timeout: float) -> None:
    raw = getattr(response, "_raw", response)
    file_object = getattr(raw, "fp", None)
    raw_file = getattr(file_object, "raw", None)
    socket_object = getattr(raw_file, "_sock", None)
    if socket_object is not None:
        socket_object.settimeout(timeout)


def read_bounded(response, cap_bytes: int, deadline: float | None = None) -> bytes:
    """Reads an HTTP response body, refusing anything bigger than cap_bytes.

    Raises PayloadTooLarge when either the declared Content-Length or the
    streamed body exceeds the cap, so a misbehaving server cannot make the
    worker buffer hundreds of megabytes while 'verifying a cutout'.
    """
    declared = response.headers.get("Content-Length")
    if declared and int(declared) > cap_bytes:
        raise PayloadTooLarge(f"declared {declared} bytes > cap {cap_bytes}")
    chunks, total = [], 0
    while True:
        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("response read exceeded its deadline")
            _set_response_timeout(response, remaining)
        chunk = response.read(65536)
        if not chunk:
            break
        total += len(chunk)
        if total > cap_bytes:
            raise PayloadTooLarge(f"body exceeded cap {cap_bytes} after {total} bytes")
        chunks.append(chunk)
    return b"".join(chunks)


def verify_cutout_support(url: str, cap_bytes: int = 33_554_432, timeout: float = 30.0) -> dict:
    """GETs the cutout once, bounded, and reports what verification found.

    Returns a descriptor the worker can store with the job's result; raises
    PayloadTooLarge / NotFits for unsupported or hostile server behaviour,
    which the worker records as the job's failure reason (never a silent
    fallback to a full-MEF download).
    """
    body, descriptor = download_verified_cutout(url, cap_bytes, timeout)
    del body
    return descriptor


def _download_once(url: str, cap_bytes: int, deadline: float) -> tuple[bytes, dict]:
    """One bounded GET, following redirects; raises HTTPError for statuses."""
    for _hop in range(_MAX_REDIRECTS + 1):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("cutout download exceeded its deadline")
        exchange = _send("GET", url, {
            "Accept": "application/fits, */*;q=0.8",
            "User-Agent": USER_AGENT,
        }, None, remaining)
        response = exchange.response
        location = response.headers.get("Location")
        if response.status in _REDIRECT_STATUSES and location:
            exchange.discard()  # simplest correct behaviour: never reuse across a hop
            url = urllib.parse.urljoin(url, location)
            continue
        if not 200 <= response.status < 300:
            exchange.discard()
            # urllib.error.HTTPError keeps job failure reasons stable
            # ("HTTP Error 502: ...") and carries the response headers so
            # _retry_after_seconds can still honour Retry-After.
            raise urllib.error.HTTPError(url, response.status, response.reason, response.headers, None)
        try:
            body = read_bounded(response, cap_bytes, deadline)
        except BaseException:
            exchange.discard()  # mid-stream abort leaves the connection unusable
            raise
        exchange.release()
        if not verify_fits(body[:FITS_BLOCK]):
            raise NotFits(f"response is not FITS ({len(body)} bytes)")
        return body, {
            "url": url,
            "bytes": len(body),
            "cutoutVerified": True,
            "hasPrimaryHeader": True,
            "headerKeywords": _peek_keywords(body[:FITS_BLOCK]),
        }
    raise urllib.error.HTTPError(url, 310, "max redirects exceeded", None, None)


def _retry_after_seconds(error: urllib.error.HTTPError) -> float | None:
    raw = (error.headers.get("Retry-After") or "").strip() if error.headers else ""
    return min(float(raw), MAX_RETRY_AFTER_SECONDS) if raw.isdigit() else None


def _is_tls_failure(error: BaseException) -> bool:
    """Certificate problems are configuration errors; retrying cannot fix them.

    The error can arrive bare (http.client) or wrapped as URLError.reason
    (urllib proxy path). Note ssl errors also have a *string* .reason such as
    'CERTIFICATE_VERIFY_FAILED', so the exception itself must be checked first.
    """
    if isinstance(error, ssl.SSLCertVerificationError):
        return True
    return isinstance(getattr(error, "reason", None), ssl.SSLCertVerificationError)


def download_verified_cutout(
    url: str,
    cap_bytes: int = 33_554_432,
    timeout: float = 30.0,
    attempts: int = MAX_ATTEMPTS,
    sleep=time.sleep,
) -> tuple[bytes, dict]:
    """Downloads one bounded FITS cutout and returns its bytes plus metadata.

    Retries transient IRSA failures up to `attempts` times with linear backoff
    (honouring a numeric Retry-After, capped). Stale keep-alive reconnects are
    handled inside _send and never consume an attempt. The last error is
    re-raised unchanged so the job's failure reason keeps the real exception
    type. `timeout` is a total deadline across redirects, response reads,
    retries, and backoff.
    """
    deadline = time.monotonic() + timeout
    for attempt in range(1, attempts + 1):
        try:
            return _download_once(url, cap_bytes, deadline)
        except urllib.error.HTTPError as error:  # before OSError: HTTPError is one
            if error.code not in RETRY_STATUSES or attempt == attempts:
                raise
            delay = _retry_after_seconds(error) or BACKOFF_SECONDS * attempt
            why = f"HTTP {error.code}"
        except (OSError, http.client.HTTPException) as error:
            # OSError covers DNS failures, resets, timeouts and TLS problems
            # (http.client raises these directly; urllib wraps them in URLError,
            # which is also an OSError).
            if _is_tls_failure(error) or attempt == attempts:
                raise
            delay = BACKOFF_SECONDS * attempt
            why = type(error).__name__
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("cutout download exceeded its deadline") from error
        print(f"  cutout fetch {attempt}/{attempts} failed ({why}); retrying in {delay:.0f}s")
        sleep(min(delay, remaining))
    raise AssertionError("unreachable")  # loop always returns or raises


def _peek_keywords(block: bytes) -> list:
    """First header keywords, for the job's verification metadata."""
    keywords = []
    for line in block.split(b"\n")[:24]:
        match = _HEADER_KEYWORD.match(line)
        if match:
            keywords.append(match.group(1).decode("ascii", "replace"))
        if len(keywords) >= 4:
            break
    return keywords


def fits_bytes_stream(body: bytes) -> io.BytesIO:
    return io.BytesIO(body)


# ---------------------------------------------------------------------------
# Shared upload path (worker -> Supabase Storage)
# ---------------------------------------------------------------------------

def post_bytes(url: str, payload: bytes, headers: dict[str, str],
               timeout: float = 60.0, cap_bytes: int = 1_048_576
               ) -> tuple[int, http.client.HTTPMessage, bytes]:
    """POSTs payload over this thread's keep-alive connection.

    Returns (status, headers, body); non-2xx statuses are returned, not
    raised, so the caller decides what they mean. Upload redirects are
    returned as-is rather than followed, so POST bodies and credentials never
    cross an origin. Used by the worker for Supabase Storage uploads: the
    storage host shares this warm-connection layer, so an upload costs one
    request, not one TLS handshake + request.
    Safe to re-send after a stale-connection reconnect because callers upload
    with x-upsert to a deterministic object path (idempotent).
    """
    exchange = _send("POST", url, headers, payload, timeout, follow_redirects=False)
    try:
        body = read_bounded(exchange.response, cap_bytes)
    except BaseException:
        exchange.discard()
        raise
    exchange.release()
    return exchange.response.status, exchange.response.headers, body