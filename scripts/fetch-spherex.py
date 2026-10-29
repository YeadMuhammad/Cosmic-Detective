#!/usr/bin/env python3
"""Find and download SPHEREx Level 2 spectral-image CUTOUTS for the game's tiles
from NASA/IPAC IRSA, and write a manifest with the per-tile metadata the GDD asks
for (observation dates, detector band, wavelength range).

Python twin of scripts/fetch-spherex.mjs: same CLI flags, same cache layout, same
manifest.json shape, so either script can resume the other's work.

Per tile (id, RA, Dec, size):
  1. Ask IRSA's TAP service which SPHEREx spectral-image MEFs cover the position
     (ADQL over spherex.artifact JOIN spherex.plane, as in IRSA's own
     "Download a collection of SPHEREx Spectral Image cutouts" tutorial).
  2. Rank epoch pairs: same detector band, observed --min-gap-days..--max-gap-days
     apart. Earlier = epoch A.
  3. Download a small FITS cutout of each epoch. Full spectral-image MEFs are
     hundreds of MB, so any response larger than --max-mb is aborted: that is the
     tell-tale sign a server ignored the cutout parameters.
  4. (needs astropy) Read the cutout's WCS-WAVE lookup table and compute the TRUE
     wavelength at the target pixel for both epochs. If they differ by more than
     --wl-tol-um, try the next-best pair, up to --max-probe pairs.
  5. Record everything in data/spherex/manifest.json.

WHY THIS VERSION CHANGED
The previous version found images through the SIA2 service and appended
`center=ra,dec&size=deg` to the returned access_url (then tried guessed URL forms).
Every attempt came back HTTP 503. IRSA's current cutout tutorial
(https://caltech-ipac.github.io/irsa-tutorials/spherex/, updated 5 Mar 2026) uses a
different, documented recipe, which this script follows:
    TAP:  SELECT a.uri, p.time_bounds_lower, ... FROM spherex.artifact a
          JOIN spherex.plane p ON a.planeid = p.planeid
          WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), p.poly)
    URL:  https://irsa.ipac.caltech.edu/<a.uri>?center=<ra>,<dec>d&size=<deg>
Note the `d` unit suffix on the center and that the URL is built from the TAP
artifact uri. TAP also sees new data right after weekly ingestion, without the
~1 day lag of SIA. The URL form that actually worked is recorded in
manifest.options.preferredStrategy and tried first on later runs. Every failed
attempt is logged with its status and a snippet of the server's reply.

If every request answers 503, the data service itself is unavailable (IRSA
announces maintenance windows). Re-run later: finished tiles are skipped and TAP
lookups are cached under <out>/cache/. --force re-does everything.

The script is polite to IRSA: downloads run one at a time with --delay-ms between
them; 5xx/429 answers back off for tens of seconds (Retry-After honoured); and
after several consecutive 5xx files the run stops early.

WAVELENGTH MATCHING
SPHEREx uses linear variable filters, so the wavelength at a given sky position
changes from exposure to exposure. Plane-level energy bounds describe the whole
detector band, not the target, so they are only a coarse filter. The real check is
the per-target wavelength from the cutout's WCS-WAVE table, which needs astropy
(`pip install astropy numpy`). Without astropy (or with --skip-wcs-check) the
manifest records wavelengthVerified = null, meaning "not checked". Each probed pair
costs two cutout downloads (roughly 5 MB each: the PSF cube is included), so
--max-probe bounds the traffic per tile.

What it does NOT do: convert FITS to the JPEGs the game displays, measure the moving
source's a/b pixel positions, or verify registration (see "Next steps").

Requirements: Python 3.9+. Network code is stdlib only. The network side still
needs a live check: run --dry-run, then a single --tile, before a full run.

Usage:
  python scripts/fetch-spherex.py --list
  python scripts/fetch-spherex.py --dry-run                  # query + show pairs, download nothing
  python scripts/fetch-spherex.py --tile barnard             # one tile (repeatable)
  python scripts/fetch-spherex.py                            # every tile in fixtures.ts
  python scripts/fetch-spherex.py --force                    # ignore manifest/cache, refetch all
  python scripts/fetch-spherex.py --id test --ra 164.15 --dec 7.04 --size 0.1   # ad hoc

Env: IRSA_ROOT overrides https://irsa.ipac.caltech.edu/ (testing / mirrors).
"""
from __future__ import annotations

import argparse
import csv
import http.client
import importlib.util
import io
import json
import os
import random
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

IRSA_ROOT = os.environ.get("IRSA_ROOT", "https://irsa.ipac.caltech.edu/").rstrip("/") + "/"
TAP_ENDPOINT = IRSA_ROOT + "TAP/sync"
DEFAULT_FIXTURES = Path(__file__).resolve().parent.parent / "src" / "data" / "fixtures.ts"
BANDS = ["D1", "D2", "D3", "D4", "D5", "D6"]
SAFE_TILE_ID = re.compile(r"^[A-Za-z0-9._-]+$")
RESERVED_TILE_IDS = {"__proto__", "constructor", "prototype"}
USER_AGENT = "cosmic-detective/0.1 (+https://github.com/YeadMuhammad/Cosmic-Detective)"
NO_RETRY_STATUS = {400, 401, 403, 404, 405, 410, 451}
FIXTURE_RE = re.compile(
    r"\bid:\s*'([^']+)'[^}]*?\bra:\s*(-?[\d.]+),\s*dec:\s*(-?[\d.]+),\s*size:\s*([\d.]+)"
)


def is_safe_tile_id(tile_id) -> bool:
    return isinstance(tile_id, str) and bool(SAFE_TILE_ID.match(tile_id)) and tile_id not in RESERVED_TILE_IDS


# ---------------------------------------------------------------- pure helpers

def parse_fixture_tiles(source: str) -> list[dict]:
    """id/ra/dec/size for every tile in src/data/fixtures.ts: coordinates have ONE source of truth."""
    return [
        {"id": m[1], "ra": float(m[2]), "dec": float(m[3]), "size": float(m[4])}
        for m in FIXTURE_RE.finditer(source)
    ]


def parse_csv(text: str) -> list[dict]:
    """CSV text -> list of row dicts keyed by lower-case header."""
    reader = csv.reader(io.StringIO(text))
    rows = [r for r in reader if r and not (len(r) == 1 and r[0] == "")]
    if not rows:
        return []
    head = [h.strip().lower() for h in rows[0]]
    return [{h: (r[i] if i < len(r) else "") for i, h in enumerate(head)} for r in rows[1:]]


def build_coverage_query(ra, dec, band, cols=None) -> str:
    """ADQL for every SPHEREx spectral image covering (ra, dec), oldest first.

    `cols` names optional spherex.plane columns found via TAP_SCHEMA; only columns that
    exist are selected, so a schema difference cannot break the query."""
    cols = cols or {}
    sel = ["a.uri AS uri", "p.time_bounds_lower AS t_lo", "p.energy_bandpassname AS band"]
    if cols.get("tHi"):
        sel.append(f"p.{cols['tHi']} AS t_hi")
    if cols.get("eLo"):
        sel.append(f"p.{cols['eLo']} AS e_lo")
    if cols.get("eHi"):
        sel.append(f"p.{cols['eHi']} AS e_hi")
    where = [f"1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly)"]
    if band:
        where.append(f"p.energy_bandpassname = 'SPHEREx-{band}'")
    return (
        f"SELECT TOP 5000 {', '.join(sel)} FROM spherex.artifact a "
        f"JOIN spherex.plane p ON a.planeid = p.planeid "
        f"WHERE {' AND '.join(where)} ORDER BY p.time_bounds_lower"
    )


def build_tap_url(adql: str) -> str:
    q = urllib.parse.urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql})
    return f"{TAP_ENDPOINT}?{q}"


def mjd_to_iso(mjd: float) -> str:
    return (datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(days=mjd - 40587)).date().isoformat()


def absolute_url(uri: str) -> str:
    return uri if re.match(r"^https?://", uri, re.I) else IRSA_ROOT + uri.lstrip("/")


def _to_um(x):
    try:
        n = float(x)
    except (TypeError, ValueError):
        return None
    if n != n or n in (float("inf"), float("-inf")):
        return None
    return n * 1e6 if n < 1e-3 else n  # CAOM energy bounds are metres; tolerate microns


def _float_or_none(x):
    try:
        n = float(x)
    except (TypeError, ValueError):
        return None
    return n if n == n and n not in (float("inf"), float("-inf")) else None


def to_observation(r: dict):
    """One TAP row -> observation record, or None if unusable."""
    uri = (r.get("uri") or "").strip()
    if not uri or not re.search(r"\.fits", uri, re.I):
        return None
    t_lo = _float_or_none(r.get("t_lo"))
    if t_lo is None:
        return None
    t_hi = _float_or_none(r.get("t_hi"))
    mjd = (t_lo + t_hi) / 2 if t_hi is not None else t_lo
    wl_min, wl_max = _to_um(r.get("e_lo")), _to_um(r.get("e_hi"))
    file = uri.split("?")[0].rsplit("/", 1)[-1]
    return {
        "obsId": re.sub(r"\.fits.*$", "", file, flags=re.I),
        "band": re.sub(r"^SPHEREx-", "", (r.get("band") or "").strip(), flags=re.I),
        "mjd": mjd,
        "date": mjd_to_iso(mjd),
        "wlMin": wl_min,
        "wlMax": wl_max,
        "wlMid": (wl_min + wl_max) / 2 if wl_min is not None and wl_max is not None else None,
        "uri": uri,
    }


def pick_pairs(obs: list[dict], min_gap_days: float, max_gap_days: float, wl_tol_um: float) -> list[dict]:
    """Rank every acceptable epoch pair, best first: same band, gap within limits, and (when
    plane-level wavelengths are known) midpoint difference <= wl_tol_um. Smaller wavelength
    mismatch wins, then the larger time gap. Plane-level bounds are coarse: the per-target
    wavelength is checked later from the cutout's WCS-WAVE table."""
    pool = sorted(obs, key=lambda o: o["mjd"])
    pairs = []
    for i, a in enumerate(pool):
        for b in pool[i + 1:]:
            if a["obsId"] == b["obsId"] or a["band"] != b["band"]:
                continue
            gap = b["mjd"] - a["mjd"]
            if gap < min_gap_days or gap > max_gap_days:
                continue
            known = a["wlMid"] is not None and b["wlMid"] is not None
            d_wl = abs(a["wlMid"] - b["wlMid"]) if known else None
            if known and d_wl > wl_tol_um:
                continue
            pairs.append({"a": a, "b": b, "gapDays": gap, "dWlUm": d_wl})
    pairs.sort(key=lambda p: ((p["dWlUm"] or 0.0), -p["gapDays"]))
    return pairs


def cutout_candidates(uri: str, ra, dec, size_deg, preferred=None) -> list[dict]:
    """Cutout URL forms for a TAP artifact uri, most-likely first. The first is the exact
    form from IRSA's SPHEREx cutout tutorial. `preferred` (a form that already worked on a
    previous run) is moved to the front."""
    base = absolute_url(uri).split("?")[0]

    def make(center):
        return f"{base}?center={center}&size={size_deg}"

    lst = [
        {"name": "tap-uri?center=ra,decd&size", "url": make(f"{ra},{dec}d")},
        {"name": "tap-uri?center=ra,dec&size", "url": make(f"{ra},{dec}")},
    ]
    if preferred:
        for i, c in enumerate(lst):
            if c["name"] == preferred and i > 0:
                lst.insert(0, lst.pop(i))
                break
    return lst


def is_fits(buf: bytes) -> bool:
    return len(buf) > 2880 and buf[:9] == b"SIMPLE  ="


# ---------------------------------------------------------------- network

class FetchError(Exception):
    def __init__(self, msg, status=None, retry_after=None, no_retry=False):
        super().__init__(msg)
        self.status = status
        self.retry_after = retry_after
        self.no_retry = no_retry
        self.had_5xx = False


def strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", s)).strip()


def http_open(url: str, accept: str, timeout: float):
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": USER_AGENT})
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        try:
            detail = strip_tags(e.read(4000).decode("utf-8", "replace"))[:200]
        except Exception:
            detail = ""
        ra = None
        raw = (e.headers.get("Retry-After") or "").strip() if e.headers else ""
        if raw.isdigit():
            ra = float(raw)
        raise FetchError(
            f"HTTP {e.code} {e.reason}" + (f" — {detail}" if detail else ""),
            status=e.code, retry_after=ra, no_retry=e.code in NO_RETRY_STATUS,
        ) from None
    except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException, OSError) as e:
        raise FetchError(f"network error: {getattr(e, 'reason', e)}") from None


def with_retry(label, fn, tries=3, base_s=2.0, server_s=30.0):
    """Run fn up to `tries` times. Back off linearly for ordinary errors and by tens of
    seconds for 5xx/429 (or the server's Retry-After). no_retry errors raise at once."""
    for i in range(1, tries + 1):
        try:
            return fn()
        except FetchError as e:
            if e.no_retry:
                print(f"  {label}: {e} (not retryable)")
                raise
            if i == tries:
                print(f"  giving up on {label}: {e}")
                raise
            unit = server_s if (e.status and (e.status >= 500 or e.status == 429)) else base_s
            wait = e.retry_after if e.retry_after is not None else round(unit * i * (0.75 + 0.5 * random.random()))
            wait = min(300, wait)
            print(f"  retry {i}/{tries} {label}: {e} — waiting {round(wait)}s")
            time.sleep(wait)
    raise RuntimeError("unreachable")


def read_capped(resp, cap: int) -> bytes:
    declared = resp.headers.get("Content-Length")
    if declared and declared.isdigit() and int(declared) > cap:
        raise FetchError(
            f"body is {declared} bytes > cap {cap} — server ignored the cutout parameters and is sending the whole MEF",
            no_retry=True)
    chunks, total = [], 0
    try:
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > cap:
                raise FetchError(
                    f"body exceeded cap {cap} — server ignored the cutout parameters and is sending the whole MEF",
                    no_retry=True)
            chunks.append(chunk)
    except (TimeoutError, ConnectionError, http.client.HTTPException, OSError) as e:
        raise FetchError(f"read error: {e}") from None
    return b"".join(chunks)


def attempt_fetch(url: str, cap: int, timeout: float = 180) -> bytes:
    """One GET that only accepts a small FITS payload."""
    resp = http_open(url, "application/fits, */*;q=0.8", timeout)
    with resp:
        buf = read_capped(resp, cap)
        if not is_fits(buf):
            ct = resp.headers.get("Content-Type") or "unknown content-type"
            head = re.sub(r"[^\x20-\x7e]", "·", buf[:16].decode("ascii", "replace"))
            raise FetchError(f'response is not FITS ({ct}, {len(buf)} bytes, starts "{head}")', no_retry=True)
    return buf


def tap_csv(adql: str, tries: int = 3) -> str:
    def go():
        resp = http_open(build_tap_url(adql), "text/csv, */*;q=0.5", 120)
        with resp:
            try:
                text = resp.read().decode("utf-8", "replace")
            except (TimeoutError, ConnectionError, http.client.HTTPException, OSError) as e:
                raise FetchError(f"read error: {e}") from None
        if re.match(r"^\s*(<\?xml|<VOTABLE)", text[:200], re.I):
            raise FetchError(f"TAP returned XML instead of CSV — {strip_tags(text)[:200]}", no_retry=True)
        return text
    return with_retry("TAP query", go, tries=tries)


def detect_plane_columns(cache_file: Path, use_cache: bool) -> dict:
    """Which optional spherex.plane columns exist? Cached in <out>/cache/plane-columns.json."""
    if use_cache:
        try:
            return json.loads(cache_file.read_text())
        except Exception:
            pass
    try:
        csv_text = tap_csv("SELECT column_name FROM TAP_SCHEMA.columns WHERE table_name = 'spherex.plane'")
        names = {(r.get("column_name") or "").lower() for r in parse_csv(csv_text)}
        has = lambda n: n if n in names else None  # noqa: E731
        cols = {"tHi": has("time_bounds_upper"), "eLo": has("energy_bounds_lower"),
                "eHi": has("energy_bounds_upper"), "seen": len(names)}
        if names:
            try:
                cache_file.write_text(json.dumps(cols))
            except OSError:
                pass
        else:
            print("  TAP_SCHEMA listed no spherex.plane columns; using time_bounds_lower only (wavelength bounds unavailable)")
        return cols
    except FetchError as e:
        print(f"  could not read the TAP schema ({e}); using time_bounds_lower only (wavelength bounds unavailable)")
        return {"seen": 0}


def query_coverage(ra, dec, band, cols) -> list[dict]:
    rows = parse_csv(tap_csv(build_coverage_query(ra, dec, band, cols), tries=4))
    seen, out = set(), []
    for r in rows:
        o = to_observation(r)
        if o and (not band or o["band"] == band) and o["obsId"] not in seen:
            seen.add(o["obsId"])
            out.append(o)
    return out


def download_cutout(candidates, dest: Path, tries: int, max_bytes: int) -> dict:
    """Try each cutout URL form until one returns a real FITS cutout, then write it
    (to a .part file first, so an interrupted run never leaves a half-written .fits)."""
    failures, last = [], None
    for cand in candidates:
        try:
            buf = with_retry(f"{dest.name} via {cand['name']}",
                             lambda c=cand: attempt_fetch(c["url"], max_bytes), tries=tries, server_s=45)
            part = dest.with_name(dest.name + ".part")
            part.write_bytes(buf)
            os.replace(part, dest)
            return {"bytes": len(buf), "via": cand["name"], "url": cand["url"]}
        except FetchError as e:
            failures.append(e)
            last = e
            print(f"  {dest.name}: {cand['name']} → {e}")
    if last is not None and any((f.status or 0) >= 500 for f in failures):
        last.had_5xx = True
    raise last


# ---------------------------------------------------------------- wavelength at the target

ASTROPY_AVAILABLE = importlib.util.find_spec("astropy") is not None


def target_wavelength(path: Path, ra: float, dec: float) -> dict:
    """True wavelength at (ra, dec) from the cutout's WCS-WAVE lookup table (as in IRSA's tutorial).
    Returns {'wavelengthUm', 'bandwidthUm', 'pixel', 'inCutout'} or {'error': ...}."""
    try:
        import logging
        import astropy.units as u
        from astropy.coordinates import SkyCoord
        from astropy.io import fits
        from astropy.wcs import WCS
        logging.getLogger("astropy").setLevel(logging.ERROR)  # alternate-WCS notices are noisy
        with fits.open(path) as hdul:
            header = hdul["IMAGE"].header
            x, y = WCS(header).world_to_pixel(SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs"))
            swcs = WCS(header, fobj=hdul, key="W")
            swcs.sip = None  # the wavelength lookup is independent of optical distortion
            wl, bw = swcs.pixel_to_world(x, y)
            nx, ny = header.get("NAXIS1"), header.get("NAXIS2")
            x, y = float(x), float(y)
            return {
                "wavelengthUm": float(wl.to(u.um).value),
                "bandwidthUm": float(bw.to(u.um).value),
                "pixel": [round(x, 2), round(y, 2)],
                "inCutout": bool(nx and ny and 0 <= x < nx and 0 <= y < ny),
            }
    except Exception as e:  # noqa: BLE001 - report, never crash the run on one bad file
        return {"error": f"{type(e).__name__}: {e}"}


# ---------------------------------------------------------------- main

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="fetch-spherex.py",
        description="Download SPHEREx spectral-image cutouts for the game's tiles from IRSA.")
    p.add_argument("--list", action="store_true", help="print the tiles that would be processed and exit")
    p.add_argument("--dry-run", action="store_true", help="query IRSA and show chosen pairs; download nothing")
    p.add_argument("--tile", action="append", help="only this tile id from fixtures.ts (repeatable)")
    p.add_argument("--id"); p.add_argument("--ra"); p.add_argument("--dec")
    p.add_argument("--fixtures", help="fixtures file to read tiles from (default src/data/fixtures.ts)")
    p.add_argument("--size", help="cutout size in degrees (override for all tiles; default: each tile's own size)")
    p.add_argument("--band", help="restrict to one SPHEREx detector band (D1..D6)")
    p.add_argument("--min-gap-days", default="60", help="minimum time between epochs (default 60)")
    p.add_argument("--max-gap-days", default="400", help="maximum time between epochs (default 400)")
    p.add_argument("--wl-tol-um", default="0.02",
                   help="max wavelength difference in microns, at plane level and at the target (default 0.02)")
    p.add_argument("--max-probe", default="4",
                   help="candidate pairs to download-and-verify per tile when astropy is available (default 4)")
    p.add_argument("--skip-wcs-check", action="store_true", help="do not verify the wavelength at the target")
    p.add_argument("--out", default="data/spherex", help="output directory (default data/spherex)")
    p.add_argument("--concurrency", default="3", help="parallel TAP lookups (default 3; downloads are always serial)")
    p.add_argument("--tries", default="2", help="download attempts per cutout URL form (default 2)")
    p.add_argument("--delay-ms", default="1000", help="pause between downloads, be nice to IRSA (default 1000)")
    p.add_argument("--max-mb", default="64", help='reject any "cutout" bigger than this, i.e. a full MEF (default 64)')
    p.add_argument("--force", action="store_true", help="re-query and re-download even if manifest + files look complete")
    p.add_argument("--no-cache", action="store_true", help="ignore the cached TAP responses in <out>/cache/")
    return p


def main(argv=None) -> int:
    v = build_parser().parse_args(argv)

    def num(name, x):
        try:
            n = float(x)
        except (TypeError, ValueError):
            raise SystemExit(f"error: --{name} must be a number") from None
        if n != n or n in (float("inf"), float("-inf")):
            raise SystemExit(f"error: --{name} must be a number")
        return n

    if v.band and v.band not in BANDS:
        raise SystemExit(f"error: --band must be one of {', '.join(BANDS)}")
    min_gap, max_gap, wl_tol = num("min-gap-days", v.min_gap_days), num("max-gap-days", v.max_gap_days), num("wl-tol-um", v.wl_tol_um)
    if min_gap > max_gap:
        raise SystemExit("error: --min-gap-days must not exceed --max-gap-days")
    if wl_tol < 0:
        raise SystemExit("error: --wl-tol-um must not be negative")
    tries = max(1, round(num("tries", v.tries)))
    delay_s = max(0, round(num("delay-ms", v.delay_ms))) / 1000
    max_bytes = max(1, round(num("max-mb", v.max_mb))) * 1024 * 1024
    max_probe = max(1, round(num("max-probe", v.max_probe)))

    def validate_tile(t):
        if not is_safe_tile_id(t["id"]):
            raise SystemExit(f'error: Invalid tile id "{t["id"]}": use only safe filename characters and not a reserved object key')
        if not t["size"] > 0:
            raise SystemExit(f'error: --size must be positive for tile "{t["id"]}"')
        if not (0 <= t["ra"] <= 360 and -90 <= t["dec"] <= 90):
            raise SystemExit(f'error: Tile "{t["id"]}" has out-of-range coordinates (RA {t["ra"]}, Dec {t["dec"]})')
        return t

    # Targets
    if v.ra or v.dec or v.id:
        if not (v.ra and v.dec and v.id):
            raise SystemExit("error: Ad hoc mode needs --id, --ra and --dec together")
        tiles = [validate_tile({"id": v.id, "ra": num("ra", v.ra), "dec": num("dec", v.dec), "size": num("size", v.size or "0.1")})]
    else:
        fixtures = Path(v.fixtures) if v.fixtures else DEFAULT_FIXTURES
        tiles = [validate_tile(t) for t in parse_fixture_tiles(fixtures.read_text(encoding="utf-8"))]
        if not tiles:
            raise SystemExit("error: Found no tiles in the fixtures file; has its format changed?")
        if v.tile:
            missing = [t for t in v.tile if not any(x["id"] == t for x in tiles)]
            if missing:
                raise SystemExit(f"error: Unknown tile id(s): {', '.join(missing)}")
            tiles = [t for t in tiles if t["id"] in v.tile]
        if v.size:
            tiles = [validate_tile({**t, "size": num("size", v.size)}) for t in tiles]

    if v.list:
        for t in tiles:
            print(f"{t['id']:<18} RA {t['ra']}  Dec {t['dec']}  size {t['size']}°")
        return 0

    out_dir = Path(v.out).resolve()
    raw_dir, cache_dir = out_dir / "raw", out_dir / "cache"
    manifest_path = out_dir / "manifest.json"
    cache_dir.mkdir(parents=True, exist_ok=True)
    if not v.dry_run:
        raw_dir.mkdir(parents=True, exist_ok=True)

    prior_tiles, preferred = {}, [None]  # preferred is a 1-element list so threads share it
    try:
        previous = json.loads(manifest_path.read_text())
        if isinstance(previous.get("tiles"), dict):
            prior_tiles = {k: x for k, x in previous["tiles"].items() if is_safe_tile_id(k)}
        if isinstance((previous.get("options") or {}).get("preferredStrategy"), str):
            preferred[0] = previous["options"]["preferredStrategy"]
    except Exception:
        pass  # first run or unreadable prior manifest

    verify = ASTROPY_AVAILABLE and not v.skip_wcs_check and not v.dry_run
    if not v.skip_wcs_check and not v.dry_run and not ASTROPY_AVAILABLE:
        print("note: astropy is not installed, so the wavelength at the target is NOT verified "
              "(wavelengthVerified will be null). pip install astropy numpy")
    probes_allowed = max_probe if verify else 1

    manifest = {
        "generatedAt": None,
        "source": "IRSA TAP spherex.artifact + spherex.plane (SPHEREx Level 2 spectral-image MEF cutouts)",
        "options": {"minGapDays": min_gap, "maxGapDays": max_gap, "wlTolUm": wl_tol, "band": v.band,
                    "tries": tries, "delayMs": round(delay_s * 1000), "maxMb": max_bytes / 1048576,
                    "preferredStrategy": None},
        "tiles": prior_tiles,
    }
    # Parameters that decide WHICH pair is chosen; a reused manifest entry must match them.
    params = {"band": v.band, "minGapDays": min_gap, "maxGapDays": max_gap, "wlTolUm": wl_tol}

    def same_params(p):
        return isinstance(p, dict) and all(p.get(k) == val for k, val in params.items())

    use_cache = not (v.force or v.no_cache)

    def tap_cache_path(t):
        return cache_dir / f"tap-{v.band or 'all'}-{t['id']}.json"

    def read_tap_cache(t):
        if not use_cache:
            return None
        try:
            parsed = json.loads(tap_cache_path(t).read_text())
            if parsed.get("ra") == t["ra"] and parsed.get("dec") == t["dec"] and isinstance(parsed.get("obs"), list):
                return parsed["obs"]
        except Exception:
            pass
        return None

    def write_tap_cache(t, obs):
        try:
            tap_cache_path(t).write_text(json.dumps({"ra": t["ra"], "dec": t["dec"], "obs": obs}))
        except OSError:
            pass

    cols_lock, cols_box = threading.Lock(), []

    def get_cols():
        with cols_lock:
            if not cols_box:
                cols_box.append(detect_plane_columns(cache_dir / "plane-columns.json", use_cache))
            return cols_box[0]

    def file_ok(rel_or_path) -> int:
        """Byte count if the file is a valid FITS file, else 0."""
        try:
            if not rel_or_path:
                return 0
            p = Path(rel_or_path)
            p = p if p.is_absolute() else out_dir / p
            with open(p, "rb") as f:
                head = f.read(2881)
            return p.stat().st_size if is_fits(head) else 0
        except OSError:
            return 0

    breaker = {"failures": 0, "limit": 3, "tripped": False}
    breaker_lock = threading.Lock()
    download_lock = threading.Lock()
    results, results_lock = [], threading.Lock()
    cached_count = [0]

    def gated(fn):
        """Serialise downloads with a pause between them: IRSA asks for gentle scripted access."""
        with download_lock:
            try:
                return fn()
            finally:
                time.sleep(delay_s)

    def record(tile_id, entry):
        manifest["tiles"][tile_id] = entry
        with results_lock:
            results.append((tile_id, entry))

    def run_tile(t):
        entry = {"ra": t["ra"], "dec": t["dec"], "sizeDeg": t["size"], "params": params, "status": "pending", "covering": 0}
        try:
            prior = manifest["tiles"].get(t["id"])
            if (not v.force and prior and prior.get("status") == "ok" and prior.get("epochs")
                    and prior.get("ra") == t["ra"] and prior.get("dec") == t["dec"]
                    and prior.get("sizeDeg") == t["size"] and same_params(prior.get("params"))):
                if file_ok(prior["epochs"].get("a", {}).get("file")) and file_ok(prior["epochs"].get("b", {}).get("file")):
                    cached_count[0] += 1
                    with results_lock:
                        results.append((t["id"], prior))
                    print(f"{t['id']:<18} {'cached':<12} covering={prior.get('covering', '?')}  (manifest + files ok; --force refetches)")
                    return
            if breaker["tripped"]:
                entry["status"] = "skipped"
                entry["error"] = "cutout service unreachable earlier in this run (persistent 5xx) — re-run later; finished tiles are kept"
                record(t["id"], entry)
                print(f"{t['id']:<18} skipped     {entry['error']}")
                return

            obs = read_tap_cache(t)
            if obs is not None:
                print(f"{t['id']:<18} using cached TAP lookup ({len(obs)} rows)")
            else:
                obs = query_coverage(t["ra"], t["dec"], v.band, get_cols())
                write_tap_cache(t, obs)
            entry["covering"] = len(obs)

            if not obs:
                entry["status"] = "no-coverage"
            else:
                pairs = pick_pairs(obs, min_gap, max_gap, wl_tol)
                if not pairs:
                    entry["status"] = "no-pair"
                elif v.dry_run:
                    fill_entry(entry, t, pairs[0], None, None)
                    entry["status"] = "dry-run"
                else:
                    probe_tile(entry, t, pairs, prior)
        except FetchError as e:
            entry["status"], entry["error"] = "failed", str(e)
            if e.had_5xx or (e.status or 0) >= 500:
                with breaker_lock:
                    breaker["failures"] += 1
                    if breaker["failures"] >= breaker["limit"] and not breaker["tripped"]:
                        breaker["tripped"] = True
                        print(f"\n  ! {breaker['failures']} files in a row failed with 5xx — treating the service as down; remaining tiles will be skipped.\n")
        except Exception as e:  # noqa: BLE001 - one bad tile must not kill the run
            entry["status"], entry["error"] = "failed", f"{type(e).__name__}: {e}"
        if entry["status"] in ("ok", "wl-mismatch"):
            with breaker_lock:
                breaker["failures"] = 0
        record(t["id"], entry)
        ep = entry.get("epochs")
        line = f"{t['id']:<18} {entry['status']:<12} covering={entry['covering']}"
        if ep:
            line += f"  {ep['a']['band']}  {ep['a']['date']} → {ep['b']['date']}  ({entry['gapDays']} d"
            if entry.get("dWavelengthTargetUm") is not None:
                line += f", Δλ at target {entry['dWavelengthTargetUm']} µm"
            elif entry.get("dWavelengthUm") is not None:
                line += f", plane Δλ {entry['dWavelengthUm']} µm"
            line += ")"
            if ep["a"].get("via"):
                line += f"  via {ep['a']['via']}"
        if entry.get("error"):
            line += f"  {entry['error']}"
        print(line)

    def fill_entry(entry, t, pair, got, verified):
        """Write the pair's metadata (and, once downloaded, file/size/verification) into the entry."""
        epochs = {}
        for k, o in (("a", pair["a"]), ("b", pair["b"])):
            g = (got or {}).get(k)
            wl_t = g["wcs"].get("wavelengthUm") if g and g.get("wcs") else None
            epochs[k] = {
                "obsId": o["obsId"], "band": o["band"], "date": o["date"], "mjd": round(o["mjd"], 4),
                "wavelengthUm": [round(o["wlMin"], 4), round(o["wlMax"], 4)] if o["wlMin"] is not None and o["wlMax"] is not None else None,
                "wavelengthAtTargetUm": round(wl_t, 4) if wl_t is not None else None,
                "targetPixel": g["wcs"].get("pixel") if g and g.get("wcs") else None,
                "sourceUrl": absolute_url(o["uri"]),
                "cutoutUrl": g["url"] if g else cutout_candidates(o["uri"], t["ra"], t["dec"], t["size"])[0]["url"],
                "file": f"raw/{t['id']}-{k}.fits",
                "bytes": g["bytes"] if g else None,
            }
            if g:
                epochs[k]["via"] = g["via"]
        entry["gapDays"] = round(pair["gapDays"], 1)
        entry["dWavelengthUm"] = round(pair["dWlUm"], 4) if pair["dWlUm"] is not None else None
        wa, wb = epochs["a"]["wavelengthAtTargetUm"], epochs["b"]["wavelengthAtTargetUm"]
        entry["dWavelengthTargetUm"] = round(abs(wa - wb), 4) if wa is not None and wb is not None else None
        entry["wavelengthVerified"] = verified
        entry["epochs"] = epochs

    def probe_tile(entry, t, pairs, prior):
        """Download the best pair; when astropy is available, verify the true wavelength at the target
        and fall through to the next-best pair (up to --max-probe) until one matches."""
        probe_dir = raw_dir / f".probe-{t['id']}"
        probe_dir.mkdir(parents=True, exist_ok=True)
        memo = {}  # obsId -> download/measure result, shared by every probe of this tile

        def get_epoch(o):
            if o["obsId"] in memo:
                return memo[o["obsId"]]
            got = None
            if not v.force and prior:  # reuse a file only if the manifest says it holds THIS observation
                for kk in ("a", "b"):
                    pe = (prior.get("epochs") or {}).get(kk) or {}
                    size = file_ok(pe.get("file")) if pe.get("obsId") == o["obsId"] else 0
                    if size:
                        print(f"  {t['id']}-{kk}.fits: already on disk and valid ({size} bytes)")
                        got = {"path": out_dir / pe["file"], "bytes": size, "via": "existing file",
                               "url": pe.get("cutoutUrl") or cutout_candidates(o["uri"], t["ra"], t["dec"], t["size"])[0]["url"]}
                        break
            if got is None:
                dest = probe_dir / f"{o['obsId']}.fits"
                cands = cutout_candidates(o["uri"], t["ra"], t["dec"], t["size"], preferred[0])
                r = gated(lambda: download_cutout(cands, dest, tries, max_bytes))
                if preferred[0] is None:
                    preferred[0] = r["via"]
                got = {"path": dest, "bytes": r["bytes"], "via": r["via"], "url": r["url"]}
            got["wcs"] = target_wavelength(got["path"], t["ra"], t["dec"]) if verify else None
            memo[o["obsId"]] = got
            return got

        chosen = best = None
        try:
            for rank, pair in enumerate(pairs[:probes_allowed]):
                got = {"a": get_epoch(pair["a"]), "b": get_epoch(pair["b"])}
                if not verify:
                    chosen = (pair, got, None)
                    break
                wa = (got["a"]["wcs"] or {}).get("wavelengthUm")
                wb = (got["b"]["wcs"] or {}).get("wavelengthUm")
                if wa is None or wb is None:
                    errs = {k: (got[k]["wcs"] or {}).get("error") for k in ("a", "b")}
                    print(f"  {t['id']}: could not read wavelength at target (a: {errs['a']}; b: {errs['b']})")
                    best = best or (float("inf"), pair, got)
                    continue
                d = abs(wa - wb)
                print(f"  {t['id']}: pair {rank + 1}/{min(len(pairs), probes_allowed)}  λ@target {wa:.4f} vs {wb:.4f} µm (Δ {d:.4f})")
                if d <= wl_tol:
                    chosen = (pair, got, True)
                    break
                if best is None or d < best[0]:
                    best = (d, pair, got)
            if chosen:
                pair, got, verified = chosen
            elif best:
                d, pair, got = best
                verified = False if d != float("inf") else None
            else:  # pragma: no cover - pairs is never empty here
                raise FetchError("no pair could be probed")
            fill_entry(entry, t, pair, got, verified)
            # Move the winning files into place (copy to .tmp first: source and destination may overlap).
            tmps = []
            for k in ("a", "b"):
                dst = out_dir / entry["epochs"][k]["file"]
                tmp = dst.with_name(dst.name + ".tmp")
                shutil.copyfile(got[k]["path"], tmp)
                tmps.append((tmp, dst))
            for tmp, dst in tmps:
                os.replace(tmp, dst)
            if verified is False:
                entry["status"] = "wl-mismatch"
                entry["error"] = (f"no probed pair matched within {wl_tol} µm at the target "
                                  f"(best Δ {entry['dWavelengthTargetUm']} µm after {min(len(pairs), probes_allowed)} pair(s)); "
                                  "raise --max-probe or --wl-tol-um")
            else:
                entry["status"] = "ok"
                for k in ("a", "b"):
                    w = got[k].get("wcs") or {}
                    if w.get("inCutout") is False:
                        print(f"  {t['id']}: WARNING epoch {k}: target pixel {w.get('pixel')} is outside the cutout")
        finally:
            shutil.rmtree(probe_dir, ignore_errors=True)

    workers = max(1, min(8, round(num("concurrency", v.concurrency))))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(run_tile, tiles))

    if not v.dry_run:
        manifest["generatedAt"] = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        manifest["options"]["preferredStrategy"] = preferred[0]
        tmp = manifest_path.with_name(manifest_path.name + ".tmp")
        tmp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, manifest_path)
        print(f"\nManifest: {manifest_path}")

    def count(s):
        return sum(1 for _, e in results if e["status"] == s)

    print(f"\nok {count('ok') + count('dry-run')} ({cached_count[0]} cached)  wl-mismatch {count('wl-mismatch')}  "
          f"no-coverage {count('no-coverage')}  no-pair {count('no-pair')}  failed {count('failed')}  skipped {count('skipped')}")
    print("""
Next steps (not done by this script):
  1. Convert each FITS cutout to the JPEGs the game shows (stretch, orientation East-left, same size for A and B).
  2. Check the cutouts are co-registered.
  3. Measure the moving source's a/b pixel positions for any mover tile, then update fixtures.ts.
  4. Fill the per-tile metadata panel from manifest.json instead of the hard-coded POSS text.""")
    return 1 if (count("failed") or count("skipped")) else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)