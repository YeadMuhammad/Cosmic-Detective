"""Versioned SPHEREx processing cache keys (canonical implementation).

Both the Python worker and the Netlify orchestration function MUST build
identical keys for identical inputs, so this module and netlify/lib/processing.mjs
are locked together by the shared golden cases in worker/cache_key_cases.json.
Do not change key semantics without bumping KEY_VERSION and regenerating the
goldens — keys are object-storage paths, and an unprefixed change would make
the cache lie about which product parameters produced a file.

Key layout (URL-safe, filesystem-safe, slash-joined):

    spherex/{keyVersion}/{product}/{collection}/{obsId}/{detector}/{release}/{geo}/{paramsHash}

.PIPE-separated? No — release and obsId already contain underscores/dots that are
safe for both POSIX paths and Supabase Storage object keys. Never URL-encode
anything; storage paths are plain strings.

Components:
  keyVersion   KEY_VERSION string ('v1'); bump when semantics change.
  product      pipeline name, e.g. 'cutout-render', 'photometry'.
  collection   IRSA collection ('qr2' | 'qr3'); new releases add new values,
               the schema is never hard-coded to a fixed list.
  obsId        SPHEREx file obs id, e.g. '2025W35_1A_0658_1'.
  detector     detector channel, 'D1'..'D6'.
  release      L2B processing release, e.g. 'l2b-v20-2025-240'.
  geo          fixed-decimal cutout geometry: ra{ra:.6f}-dec{dec:.6f}-s{size:.4f}.
  paramsHash   12-hex SHA-256 of canonical_params(product, params) — the last
               defence against cache collisions across processing parameters.

canonical_params dumps JSON with sorted keys and (',',':') separators; flat
primitive params only — floats and nested structures are rejected because
Python (recursive sort_keys) and JavaScript (insertion order) would otherwise
canonicalize them differently.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Mapping

KEY_VERSION = "v1"

_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def check_segment(component: str, name: str) -> str:
    """Rejects empty or path-hostile key components (no traversal, no separators)."""
    if not isinstance(component, str) or not _SAFE_SEGMENT.match(component):
        raise ValueError(f"unsafe {name} cache-key component: {component!r}")
    return component


def fixed(value: Any, decimals: int, name: str) -> str:
    """Non-negative finite float rendered with fixed decimals inside the geo segment."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} is not a number: {value!r}") from None
    if number != number or number in (float("inf"), float("-inf")):
        raise ValueError(f"{name} is not finite: {value!r}")
    return f"{number:.{decimals}f}"


def canonical_params(product: str, params: Mapping[str, Any]) -> str:
    """Stable canonical JSON of the processing parameters for a product.

    Params must be flat (string, int, bool or None) — no floats and no nested
    structures, because Python (recursive sort_keys) and JavaScript (insertion
    order) would otherwise canonicalize them differently.
    """
    merged = {"product": product}
    for key, value in (params or {}).items():
        if isinstance(value, (dict, list, tuple)) or isinstance(value, float):
            raise ValueError(f"params[{key}] must be a flat string, int, bool or None")
        if value is not None and not isinstance(value, (str, int, bool)):
            raise ValueError(f"params[{key}] must be a flat string, int, bool or None")
        if key == "product":
            raise ValueError("params must not override 'product'")
        merged[key] = value
    return json.dumps(merged, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def params_hash(product: str, params: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_params(product, params).encode("utf-8")).hexdigest()[:12]


def cache_key(
    product: str,
    *,
    collection: str,
    obs_id: str,
    detector: str,
    release: str,
    ra: Any,
    dec: Any,
    size_deg: Any,
    params: Mapping[str, Any] | None = None,
) -> str:
    """One cache/object key per product input set, versioned end to end."""
    segments = (
        "spherex",
        KEY_VERSION,
        check_segment(product, "product"),
        check_segment(collection, "collection"),
        check_segment(obs_id, "obs_id"),
        check_segment(detector, "detector"),
        check_segment(release, "release"),
        f"ra{fixed(ra, 6, 'ra')}-dec{fixed(dec, 6, 'dec')}-s{fixed(size_deg, 4, 'size_deg')}",
        params_hash(product, params),
    )
    return "/".join(segments)


def upload_path(cache_key_value: str, suffix: str) -> str:
    """Object-storage path for a product file derived from its cache key."""
    if not suffix or not re.match(r"^\.[A-Za-z0-9]+$", suffix):
        raise ValueError(f"unsafe product suffix: {suffix!r}")
    return f"{cache_key_value}{suffix}"
