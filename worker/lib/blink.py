"""WCS-register a matched SPHEREx image pair for visual blinking.

This is deliberately a display product, not calibrated difference imaging. It
reprojects IMAGE surface-brightness planes onto one TAN grid, uses one shared
stretch for the pair, and rejects pairs whose target-pixel WCS-WAVE differs.
It does not infer transient significance or hide image quality flags.
"""
from __future__ import annotations

import base64
import binascii
import io
import math
import struct
import zlib
from typing import Any, Mapping


class BlinkError(ValueError):
    """The observations cannot be shown as a matched blink pair."""


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    crc = binascii.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)


def _gray_png(values, footprint, low: float, high: float) -> str:
    import numpy as np

    valid = np.isfinite(values) & (footprint > 0)
    gray = np.zeros(values.shape, dtype=np.uint8)
    if high > low:
        gray[valid] = np.clip((values[valid] - low) * (255.0 / (high - low)), 0, 255).astype(np.uint8)
    height, width = gray.shape
    rgba = np.empty((height, width, 4), dtype=np.uint8)
    rgba[:, :, :3] = gray[:, :, None]
    rgba[:, :, 3] = np.where(valid, 255, 0).astype(np.uint8)
    rows = bytearray()
    for y in range(height):
        rows.append(0)  # PNG filter: None
        rows.extend(rgba[y].tobytes())
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", header)
    png += _png_chunk(b"IDAT", zlib.compress(bytes(rows), level=6)) + _png_chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _read_plane(blob: bytes, ra: float, dec: float):
    import astropy.units as u
    import numpy as np
    from astropy.coordinates import SkyCoord
    from astropy.io import fits
    from astropy.wcs import WCS

    with fits.open(io.BytesIO(blob), memmap=False) as hdus:
        try:
            image = hdus["IMAGE"]
            wave_wcs = WCS(image.header, fobj=hdus, key="W")
            wave_wcs.sip = None
            celestial = WCS(image.header, fobj=hdus).celestial
            source = np.asarray(image.data, dtype=np.float32)
        except Exception as error:
            raise BlinkError(f"FITS cutout is missing a usable IMAGE/WCS-WAVE plane: {error}") from None
        if source.ndim != 2 or not source.size:
            raise BlinkError("FITS IMAGE plane must be a non-empty 2D array.")
        x, y = celestial.world_to_pixel(SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs"))
        if not (math.isfinite(float(x)) and math.isfinite(float(y))
                and 0 <= x < source.shape[1] and 0 <= y < source.shape[0]):
            raise BlinkError("Requested target is outside this cutout's IMAGE footprint.")
        try:
            wavelength, bandwidth = wave_wcs.pixel_to_world(float(x), float(y))
            wavelength_um = float(wavelength.to_value(u.um))
            bandwidth_um = float(bandwidth.to_value(u.um))
        except Exception as error:
            raise BlinkError(f"Could not evaluate WCS-WAVE at the requested target: {error}") from None
        if not (math.isfinite(wavelength_um) and wavelength_um > 0
                and math.isfinite(bandwidth_um) and bandwidth_um > 0):
            raise BlinkError("Target-pixel wavelength or bandwidth is invalid.")
        return source, celestial, wavelength_um, bandwidth_um


def register_blink_pair(first_fits: bytes, second_fits: bytes, ra: float, dec: float,
                        size_deg: float, params: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Reproject a same-channel pair to a common sky grid and return two PNGs."""
    import numpy as np
    from astropy.wcs import WCS
    from reproject import reproject_interp

    params = params or {}
    pixel_scale_arcsec = float(params.get("pixelScaleArcsec", 6.2))
    max_passband_mismatch = float(params.get("maxPassbandMismatchFraction", 0.0))
    if not (0.1 <= pixel_scale_arcsec <= 60):
        raise BlinkError("Requested blink pixel scale is outside supported bounds.")
    if not (0 <= max_passband_mismatch <= 1):
        raise BlinkError("Passband mismatch tolerance must be between 0.00 and 1.00.")

    first, first_wcs, first_wave, first_width = _read_plane(first_fits, ra, dec)
    second, second_wcs, second_wave, second_width = _read_plane(second_fits, ra, dec)
    wave_delta = abs(first_wave - second_wave)
    wave_fraction = wave_delta / ((first_wave + second_wave) / 2)
    width_fraction = abs(first_width - second_width) / max(first_width, second_width)
    max_wavelength_delta_um = max_passband_mismatch * ((first_wave + second_wave) / 2)
    max_bandwidth_fraction = max_passband_mismatch
    if wave_fraction > max_passband_mismatch or width_fraction > max_passband_mismatch:
        raise BlinkError(
            "Observations do not meet the configured target-pixel passband match: "
            f"|Δλ|={wave_delta:.6g} µm (limit {max_wavelength_delta_um:.6g}), "
            f"relative bandwidth difference={width_fraction:.6g} (limit {max_bandwidth_fraction:.6g})."
        )

    width = max(16, min(512, math.ceil(size_deg * 3600 / pixel_scale_arcsec)))
    height = width
    target_wcs = WCS(naxis=2)
    target_wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    target_wcs.wcs.cunit = ["deg", "deg"]
    target_wcs.wcs.crval = [ra, dec]
    target_wcs.wcs.crpix = [(width + 1) / 2, (height + 1) / 2]
    scale_deg = pixel_scale_arcsec / 3600
    target_wcs.wcs.cd = [[-scale_deg, 0], [0, scale_deg]]

    registered = []
    for source, source_wcs in ((first, first_wcs), (second, second_wcs)):
        values, footprint = reproject_interp(
            (source, source_wcs), target_wcs, shape_out=(height, width),
            order="bilinear", return_footprint=True,
        )
        valid = np.isfinite(values) & (footprint > 0)
        if valid.sum() < max(16, width * height // 100):
            raise BlinkError("Too little common sky footprint remains after WCS reprojection.")
        registered.append((values, footprint))

    finite = np.concatenate([values[footprint > 0].astype(np.float64) for values, footprint in registered])
    finite = finite[np.isfinite(finite)]
    if not finite.size:
        raise BlinkError("Registered images contain no finite pixels.")
    low, high = (float(value) for value in np.percentile(finite, [2, 99.5]))
    return {
        "firstPng": _gray_png(*registered[0], low, high),
        "secondPng": _gray_png(*registered[1], low, high),
        "width": width,
        "height": height,
        "pixelScaleArcsec": pixel_scale_arcsec,
        "sharedStretch": {"lowMJySr": low, "highMJySr": high, "percentiles": [2, 99.5]},
        "targetPassband": {
            "firstWavelengthUm": first_wave, "secondWavelengthUm": second_wave,
            "firstBandwidthUm": first_width, "secondBandwidthUm": second_width,
            "wavelengthDeltaUm": wave_delta, "relativeWavelengthDifference": wave_fraction,
            "relativeBandwidthDifference": width_fraction,
            "allowedMismatchFraction": max_passband_mismatch,
        },
        "semantics": "visual-blink-only; passband mismatches are user-tolerated and may change apparent brightness; pixel flags are not overlaid; not a calibrated difference or detection",
    }


def compose_band_channels(channels: list[dict[str, Any]], ra: float, dec: float,
                          size_deg: float, pixel_scale_arcsec: float = 6.2) -> dict[str, Any]:
    """Make a false-color display from three independently stretched channels.

    This is for qualitative exploration only: each RGB channel has its own
    display stretch, so colors are not calibrated colors or source SED data.
    """
    import numpy as np
    from astropy.wcs import WCS
    from reproject import reproject_interp

    if len(channels) != 3 or {str(item.get("color")) for item in channels} != {"R", "G", "B"}:
        raise BlinkError("A band composite requires exactly one R, G, and B input.")
    if not (0.1 <= pixel_scale_arcsec <= 60):
        raise BlinkError("Requested composite pixel scale is outside supported bounds.")

    width = max(16, min(512, math.ceil(size_deg * 3600 / pixel_scale_arcsec)))
    height = width
    target_wcs = WCS(naxis=2)
    target_wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    target_wcs.wcs.cunit = ["deg", "deg"]
    target_wcs.wcs.crval = [ra, dec]
    target_wcs.wcs.crpix = [(width + 1) / 2, (height + 1) / 2]
    scale_deg = pixel_scale_arcsec / 3600
    target_wcs.wcs.cd = [[-scale_deg, 0], [0, scale_deg]]

    projected = {}
    metadata = []
    for item in channels:
        color = str(item["color"])
        source, source_wcs, wavelength_um, bandwidth_um = _read_plane(item["fits"], ra, dec)
        values, footprint = reproject_interp(
            (source, source_wcs), target_wcs, shape_out=(height, width),
            order="bilinear", return_footprint=True,
        )
        valid = np.isfinite(values) & (footprint > 0)
        if valid.sum() < max(16, width * height // 100):
            raise BlinkError(f"Too little common footprint remains in the {color} channel.")
        projected[color] = (values, valid)
        metadata.append({
            "color": color, "detector": item["detector"], "obsId": item["obsId"],
            "date": item.get("date"), "wavelengthUm": wavelength_um,
            "bandwidthUm": bandwidth_um,
        })

    common = projected["R"][1] & projected["G"][1] & projected["B"][1]
    if common.sum() < max(16, width * height // 100):
        raise BlinkError("Too little common sky area remains across the three bands.")
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    stretches = {}
    for index, color in enumerate(("R", "G", "B")):
        values = projected[color][0]
        sample = values[common].astype(np.float64)
        low, high = (float(value) for value in np.percentile(sample, [2, 99.5]))
        stretches[color] = [low, high]
        if high > low:
            rgb[:, :, index] = np.clip((values - low) * (255.0 / (high - low)), 0, 255).astype(np.uint8)

    rgba = np.empty((height, width, 4), dtype=np.uint8)
    rgba[:, :, :3] = rgb
    rgba[:, :, 3] = np.where(common, 255, 0).astype(np.uint8)
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        rows.extend(rgba[y].tobytes())
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", header)
    png += _png_chunk(b"IDAT", zlib.compress(bytes(rows), level=6)) + _png_chunk(b"IEND", b"")
    return {
        "png": "data:image/png;base64," + base64.b64encode(png).decode("ascii"),
        "width": width, "height": height, "pixelScaleArcsec": pixel_scale_arcsec,
        "channels": metadata, "displayStretch": stretches,
        "semantics": "false-color visual composite; independently stretched channels; zodiacal light is not subtracted; pixel flags are not masked or overlaid; not calibrated color, source photometry, or a spectrum",
    }
