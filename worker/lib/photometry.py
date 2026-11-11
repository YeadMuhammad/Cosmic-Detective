"""SPHEREx photometry entry point; fail closed until science inputs validate."""
from __future__ import annotations

from typing import Any, Mapping


class PhotometryError(ValueError):
    """The cutout cannot produce a scientifically comparable measurement."""


def extract_source_photometry(
    fits_bytes: bytes,
    ra: float,
    dec: float,
    params: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Reject requests until calibrated SPHEREx measurements are supported.

    The current cutout contract does not load the detector solid-angle map or
    science-grade CWAVE/CBAND calibration products. Display WCS and a nominal
    aperture cannot substitute for those inputs. In particular, PSF cube planes
    are spatial zones, not wavelength samples, and the PSF products are
    oversampled. Returning a flux estimate as usable before those inputs and
    the corresponding extraction are implemented would be misleading.
    """
    del fits_bytes, ra, dec, params
    raise PhotometryError(
        "validated SPHEREx photometry is unavailable: detector solid-angle "
        "map, science-grade CWAVE/CBAND calibration, and validated spatial "
        "PSF/ePSF fitting are not yet supported by this worker"
    )
