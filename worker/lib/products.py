"""Processing-product registry for the SPHEREx worker.

Each product maps a job's requested product name to the pipeline that builds
it. Heavy dependencies (astropy/photutils/reproject via supabase-py storage)
are imported lazily inside the pipeline functions; when they are missing the
worker marks the job failed with a specific reason instead of pretending the
product is unavailable for scientific reasons. Netlify/Supabase orchestrate;
this module never talks to Netlify.
"""
from __future__ import annotations

from typing import Any, Callable, Mapping

try:  # pragma: no cover - exercised implicitly whenever astropy is present
    import astropy  # noqa: F401
    _ASTROPY_OK = True
except Exception:  # pragma: no cover
    _ASTROPY_OK = False


def detect_dependencies() -> dict:
    """Which optional heavy dependencies are importable right now?"""
    status = {}
    for module in ("astropy", "numpy", "photutils", "reproject", "supabase"):
        try:
            __import__(module)
            status[module] = True
        except Exception:
            status[module] = False
    return status


def dependency_reason(status: Mapping[str, bool]) -> str | None:
    """Human-readable failure reason, or None when every dependency is present."""
    missing = sorted(name for name, ok in status.items() if not ok)
    if missing:
        return "worker dependencies unavailable: " + ", ".join(missing)
    return None


def staged_products(product: str, job: Mapping[str, Any]) -> list:
    """The ordered processing stages for one product, as (stage, description)."""
    if product == "cutout-render":
        return [
            ("verify-cutout", "bounded GET of the IRSA cutout, FITS-sniffed and byte-capped"),
            ("read-image", "astropy.io.fits reads the IMAGE extension and pixel flags"),
            ("stretch-render", "same-stretch render, East-left orientation, aligned grid"),
        ]
    if product == "photometry":
        return [
            ("verify-cutout", "bounded GET of the IRSA cutout, FITS-sniffed and byte-capped"),
            ("read-planes", "IMAGE/FLAGS/VARIANCE/ZODI/PSF extensions at the target pixel"),
            ("extract", "PSF/ePSF fit where valid; aperture extraction as documented fallback; ZODI never subtracted twice"),
        ]
    raise KeyError(f"unknown product: {product!r}")


def product_dependencies(product: str) -> list:
    names = ["supabase"]
    if product == "cutout-render":
        names += ["astropy", "numpy"]
    elif product == "photometry":
        names += ["astropy", "numpy", "photutils", "reproject"]
    return sorted(set(names))


def run_stage(stage: str, body: Any) -> Any:  # pragma: no cover - wired in worker main
    """Stage entry point. Real pipelines import astropy lazily and degrade."""
    raise NotImplementedError(f"stage {stage!r} is wired in spherex_worker.py")


# Kept importable so tests can patch runner functions; the worker main loop
# receives a runner mapping of stage -> callable(Callable[..., Any]).
Runner = Callable[[str, Any], Any]
