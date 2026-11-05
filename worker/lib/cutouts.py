"""Bounded SPHEREx cutout verification and download helpers (stdlib only).

"Verify cutout support before downloading full MEFs" (PLAN.md item 2): the
worker NEVER downloads an unbounded payload. Every download is a cutout
request (?center=x,y&size=deg), read through read_bounded() which enforces a
byte cap both on the declared Content-Length and on the streamed body, and a
verify_fits() sniff that fails fast when a server ignored the cutout
parameters and is returning the whole MEF (hundreds of MB).
"""
from __future__ import annotations

import io
import re
import urllib.error
import urllib.request

FITS_BLOCK = 2880
_HEADER_KEYWORD = re.compile(rb"^([A-Z0-9_]+)(?:=|\s*=\s*)?")

USER_AGENT = "cosmic-detective-worker/0.1 (+https://github.com/YeadMuhammad/Cosmic-Detective)"


class PayloadTooLarge(Exception):
    """The server ignored the cutout parameters and is sending a full MEF."""


class NotFits(Exception):
    """The response body is not a FITS file."""


def verify_fits(head: bytes) -> bool:
    """Cheap FITS sniff on the first 2880-byte header block."""
    if len(head) < FITS_BLOCK:
        return False
    return head[:9] in (b"SIMPLE  =", b"XTENSION") or head[:6] == b"SIMPLE"


def read_bounded(response, cap_bytes: int) -> bytes:
    """Reads a urllib response body, refusing anything bigger than cap_bytes.

    Raises PayloadTooLarge when either the declared Content-Length or the
    streamed body exceeds the cap, so a misbehaving server cannot make the
    worker buffer hundreds of megabytes while 'verifying a cutout'.
    """
    declared = response.headers.get("Content-Length")
    if declared and int(declared) > cap_bytes:
        raise PayloadTooLarge(f"declared {declared} bytes > cap {cap_bytes}")
    chunks, total = [], 0
    while True:
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
    request = urllib.request.Request(url, headers={
        "Accept": "application/fits, */*;q=0.8",
        "User-Agent": USER_AGENT,
    })
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = read_bounded(response, cap_bytes)
            fits_ok = verify_fits(body[:FITS_BLOCK])
            if not fits_ok:
                raise NotFits(f"response is not FITS ({len(body)} bytes)")
            return {
                "url": url,
                "bytes": len(body),
                "cutoutVerified": True,
                "hasPrimaryHeader": True,
                "headerKeywords": _peek_keywords(body[:FITS_BLOCK]),
            }
    except urllib.error.HTTPError as error:
        error.noRetry = 400 <= error.code < 500  # type: ignore[attr-defined]
        raise


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
