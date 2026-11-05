"""Quality-aware native-pixel photometry for one SPHEREx cutout."""
from __future__ import annotations

from io import BytesIO
from typing import Any, Mapping

import numpy as np
from astropy.io import fits
from astropy import units as u
from astropy.wcs import WCS
from astropy.wcs.utils import proj_plane_pixel_area


class PhotometryError(ValueError):
    """The cutout cannot produce a scientifically comparable measurement."""


def _planes(hdulist) -> dict[str, tuple[np.ndarray, Any]]:
    planes = {}
    for hdu in hdulist:
        name = str(hdu.header.get("EXTNAME", "")).strip().upper()
        if name and hdu.data is not None and name not in planes:
            planes[name] = (np.asarray(hdu.data, dtype=float), hdu.header)
    return planes


def _image_plane(planes: Mapping[str, tuple[np.ndarray, Any]], name: str) -> tuple[np.ndarray, Any]:
    try:
        data, header = planes[name]
    except KeyError as error:
        raise PhotometryError(f"required {name} extension is missing") from error
    if data.ndim != 2:
        raise PhotometryError(f"{name} extension is not a 2-D image")
    return data, header


def _target_pixel(header: Any, ra: float, dec: float, hdulist) -> tuple[float, float, WCS]:
    celestial = WCS(header)
    if not celestial.has_celestial:
        raise PhotometryError("IMAGE has no celestial WCS")
    x, y = celestial.celestial.world_to_pixel_values(float(ra), float(dec))
    if not np.isfinite(x) or not np.isfinite(y):
        raise PhotometryError("target does not map to a finite image pixel")
    height, width = hdulist['IMAGE'].data.shape[-2:]
    if x < 0 or y < 0 or x >= width or y >= height:
        raise PhotometryError("target is outside the cutout")
    try:
        spectral = WCS(header, fobj=hdulist, key="W")
        if not any(value and ("em." in value or "spect" in value or "wave" in value) for value in spectral.world_axis_physical_types):
            spectral = celestial
    except Exception:
        spectral = celestial
    return float(x), float(y), spectral


def _wavelength_microns(wcs: WCS, x: float, y: float) -> float:
    # The alternate WCS-WAVE solution is a lookup table indexed by the two
    # image coordinates; it does not require an invented third pixel axis.
    try:
        world = wcs.pixel_to_world(x, y)
        wavelength = world[0] if isinstance(world, tuple) else world
        value = float(wavelength.to_value(u.um))
        if np.isfinite(value) and value > 0:
            return value
    except Exception:
        pass
    physical = wcs.world_axis_physical_types
    spectral = next(
        (index for index, value in enumerate(physical) if value and ("em." in value or "spect" in value or "wave" in value)),
        None,
    )
    if spectral is None or wcs.pixel_n_dim < 2:
        raise PhotometryError("spectral WCS is missing; wavelength at target is unavailable")
    pixels = [0.0] * wcs.pixel_n_dim
    pixels[0], pixels[1] = x, y
    world = wcs.pixel_to_world_values(*pixels)
    value = float(world[spectral])
    unit = str(wcs.world_axis_units[spectral] or "").lower()
    if "angstrom" in unit or unit in {"a", "aa"}:
        value /= 1e4
    elif unit in {"nm", "nanometer", "nanometers"}:
        value /= 1e3
    elif unit in {"m", "meter", "meters"}:
        value *= 1e6
    if not np.isfinite(value) or value <= 0:
        raise PhotometryError("spectral WCS returned an invalid wavelength")
    return value


def _pixel_area_sr(wcs: WCS) -> float:
    try:
        area = float(proj_plane_pixel_area(wcs.celestial))
        units = wcs.celestial.wcs.cunit
        area *= float((u.Unit(units[0]) * u.Unit(units[1])).to(u.sr))
    except Exception as error:
        raise PhotometryError("celestial WCS has no usable pixel scale") from error
    if not np.isfinite(area) or area <= 0:
        raise PhotometryError("celestial WCS returned an invalid pixel area")
    return area


def _window(center_x: float, center_y: float, shape: tuple[int, int], radius: float, outer: float):
    height, width = shape
    y0 = max(0, int(np.floor(center_y - outer)))
    y1 = min(height, int(np.ceil(center_y + outer + 1)))
    x0 = max(0, int(np.floor(center_x - outer)))
    x1 = min(width, int(np.ceil(center_x + outer + 1)))
    yy, xx = np.mgrid[y0:y1, x0:x1]
    distance = np.hypot(xx - center_x, yy - center_y)
    return (slice(y0, y1), slice(x0, x1)), distance


def _calibration_fraction(image_header: Any, params: Mapping[str, Any]) -> float:
    value = params.get("calibrationFraction", image_header.get("CALFRAC", 0.0))
    try:
        fraction = float(value)
    except (TypeError, ValueError) as error:
        raise PhotometryError("calibration uncertainty is invalid") from error
    if not np.isfinite(fraction) or fraction < 0:
        raise PhotometryError("calibration uncertainty must be non-negative")
    return fraction


def _psf_plane(
    psf_data: np.ndarray,
    psf_header: Any,
    wavelength_microns: float,
    params: Mapping[str, Any],
) -> np.ndarray | None:
    if psf_data.ndim == 2:
        return psf_data
    if psf_data.ndim != 3:
        return None

    plane_index = params.get("psfIndex")
    if plane_index is None:
        crval = psf_header.get("CRVAL3")
        cdelt = psf_header.get("CDELT3")
        cunit = str(psf_header.get("CUNIT3", "um")).lower()
        try:
            if crval is not None and cdelt not in (None, 0):
                scale = 1.0
                if "angstrom" in cunit or cunit in {"a", "aa"}:
                    scale = 1e-4
                elif cunit in {"nm", "nanometer", "nanometers"}:
                    scale = 1e-3
                elif cunit in {"m", "meter", "meters"}:
                    scale = 1e6
                crpix = float(psf_header.get("CRPIX3", 1.0))
                plane_index = round((wavelength_microns / scale - float(crval)) / float(cdelt) + crpix - 1)
        except (TypeError, ValueError):
            plane_index = None
    if plane_index is None:
        plane_index = psf_data.shape[0] // 2
    try:
        index = int(plane_index)
    except (TypeError, ValueError):
        return None
    if not 0 <= index < psf_data.shape[0]:
        return None
    return psf_data[index]


def _psf_values_for_window(
    psf: np.ndarray,
    center_x: float,
    center_y: float,
    slices: tuple[slice, slice],
) -> np.ndarray | None:
    if psf.ndim != 2 or psf.shape[0] < 3 or psf.shape[1] < 3:
        return None
    y_slice, x_slice = slices
    yy, xx = np.mgrid[y_slice, x_slice]
    psf_center_y = (psf.shape[0] - 1) / 2
    psf_center_x = (psf.shape[1] - 1) / 2
    psf_y = np.rint(psf_center_y + yy - center_y).astype(int)
    psf_x = np.rint(psf_center_x + xx - center_x).astype(int)
    inside = (
        (psf_y >= 0)
        & (psf_y < psf.shape[0])
        & (psf_x >= 0)
        & (psf_x < psf.shape[1])
    )
    values = np.full(yy.shape, np.nan, dtype=float)
    values[inside] = psf[psf_y[inside], psf_x[inside]]
    return values


def extract_source_photometry(
    fits_bytes: bytes,
    ra: float,
    dec: float,
    params: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Extract native-pixel flux, uncertainty, wavelength, and quality flags."""
    params = params or {}
    with fits.open(BytesIO(fits_bytes), memmap=False) as hdulist:
        planes = _planes(hdulist)
        image, image_header = _image_plane(planes, "IMAGE")
        flags, _ = _image_plane(planes, "FLAGS")
        variance, _ = _image_plane(planes, "VARIANCE")
        if flags.shape != image.shape or variance.shape != image.shape:
            raise PhotometryError("IMAGE, FLAGS, and VARIANCE shapes do not match")
        x, y, wcs = _target_pixel(image_header, ra, dec, hdulist)
        wavelength = _wavelength_microns(wcs, x, y)
        pixel_area = _pixel_area_sr(wcs)

        source_radius = float(params.get("apertureRadius", 2.0))
        if source_radius <= 0 or not np.isfinite(source_radius):
            raise PhotometryError("apertureRadius must be positive and finite")
        outer_radius = max(6.0, source_radius * 3)
        if x - outer_radius < 0 or y - outer_radius < 0 or x + outer_radius >= image.shape[1] or y + outer_radius >= image.shape[0]:
            raise PhotometryError("aperture or background annulus extends beyond the cutout")
        aperture_slices, distance = _window(x, y, image.shape, source_radius, outer_radius)
        local_image = image[aperture_slices]
        local_variance = variance[aperture_slices]
        local_flags = flags[aperture_slices]
        aperture = distance <= source_radius
        annulus = (distance > source_radius * 2) & (distance <= source_radius * 3)
        valid = np.isfinite(local_image) & np.isfinite(local_variance) & (local_variance >= 0) & (local_flags == 0)
        background_values = local_image[annulus & valid]
        if background_values.size < 3:
            raise PhotometryError("insufficient valid background pixels")
        background = float(np.median(background_values))
        selected = aperture & valid
        if selected.sum() < 3:
            raise PhotometryError("insufficient valid source pixels")

        signal = local_image[selected] - background
        flux_surface = float(signal.sum())
        measurement_variance = float(local_variance[selected].sum())
        method = "aperture"
        psf_warning = "valid PSF plane unavailable; aperture fallback used"
        if "PSF" in planes:
            psf_data, psf_header = planes["PSF"]
            psf = _psf_plane(psf_data, psf_header, wavelength, params)
            local_psf = _psf_values_for_window(psf, x, y, aperture_slices) if psf is not None else None
            if local_psf is not None:
                psf_selected = selected & np.isfinite(local_psf)
                psf_values = local_psf[psf_selected]
                if psf_values.size >= 3 and np.all(psf_values >= 0) and psf_values.sum() > 0:
                    psf_signal = local_image[psf_selected] - background
                    weights = 1.0 / np.maximum(local_variance[psf_selected], np.finfo(float).eps)
                    denominator = float(np.sum(psf_values**2 * weights))
                    if denominator > 0:
                        amplitude = float(np.sum(psf_values * psf_signal * weights) / denominator)
                        if np.isfinite(amplitude) and amplitude > 0:
                            psf_sum = float(psf_values.sum())
                            flux_surface = amplitude * psf_sum
                            measurement_variance = (psf_sum**2) / denominator
                            method = "psf"
                            psf_warning = ""
        background_uncertainty = float(np.std(background_values, ddof=1) * np.sqrt(selected.sum()))
        flux = flux_surface * pixel_area
        measurement_error = np.sqrt(max(measurement_variance, 0.0)) * pixel_area
        background_error = background_uncertainty * pixel_area
        calibration_fraction = _calibration_fraction(image_header, params)
        calibration_error = abs(flux) * calibration_fraction
        total_error = float(np.sqrt(measurement_error**2 + background_error**2 + calibration_error**2))
        warnings = []
        if calibration_fraction == 0:
            warnings.append("calibration uncertainty was not supplied by the release or request")
        if np.any(local_flags[aperture] != 0):
            warnings.append("flagged pixels were excluded")
        if psf_warning:
            warnings.append(psf_warning)
        if not np.isfinite(flux) or not np.isfinite(total_error):
            raise PhotometryError("photometry produced a non-finite result")
        signal_to_noise = abs(flux) / total_error if total_error > 0 else 0.0
        minimum_snr = float(params.get("minimumSNR", 3.0))
        if signal_to_noise < minimum_snr:
            warnings.append(f"low S/N ({signal_to_noise:.2f} < {minimum_snr:.2f})")
        if "ZODI" not in planes:
            warnings.append("ZODI plane is absent; no zodiacal model was subtracted")
        return {
            "dataOrigin": "live",
            "method": method,
            "ra": float(ra),
            "dec": float(dec),
            "pixel": {"x": x, "y": y},
            "wavelengthMicrons": wavelength,
            "fluxMjy": flux,
            "uncertaintyMjy": total_error,
            "signalToNoise": signal_to_noise,
            "uncertainty": {
                "measurementMjy": measurement_error,
                "backgroundMjy": background_error,
                "calibrationMjy": calibration_error,
                "totalMjy": total_error,
            },
            "quality": {
                "usable": True,
                "zodiSubtracted": False,
                "zodiPlanePresent": "ZODI" in planes,
                "sourcePixels": int(selected.sum()),
                "backgroundPixels": int(background_values.size),
                "warnings": warnings,
            },
        }
