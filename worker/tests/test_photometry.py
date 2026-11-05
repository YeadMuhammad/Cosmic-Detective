"""Synthetic FITS tests for native-pixel photometry."""
from __future__ import annotations

from io import BytesIO
import pathlib
import sys
import unittest

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from lib.photometry import PhotometryError, extract_source_photometry  # noqa: E402


def _cutout(include_spectral_wcs: bool = True, include_psf: bool = False, psf_cube: bool = False) -> bytes:
    size = 11
    image = np.full((size, size), 10.0)
    image[5, 5] = 110.0
    variance = np.ones_like(image)
    flags = np.zeros_like(image, dtype=np.int16)
    flags[4, 5] = 1
    header = fits.Header()
    header["NAXIS"] = 3 if include_spectral_wcs else 2
    header["NAXIS1"] = size
    header["NAXIS2"] = size
    header["CRPIX1"] = 6
    header["CRPIX2"] = 6
    header["CRVAL1"] = 10.0
    header["CRVAL2"] = 20.0
    header["CDELT1"] = -0.001
    header["CDELT2"] = 0.001
    header["CTYPE1"] = "RA---TAN"
    header["CTYPE2"] = "DEC--TAN"
    header["CUNIT1"] = "deg"
    header["CUNIT2"] = "deg"
    if include_spectral_wcs:
        header["NAXIS3"] = 1
        header["CRPIX3"] = 1
        header["CRVAL3"] = 1.5
        header["CDELT3"] = 0.001
        header["CTYPE3"] = "WAVE"
        header["CUNIT3"] = "um"
    extensions = [
        fits.PrimaryHDU(),
        fits.ImageHDU(image, header=header, name="IMAGE"),
        fits.ImageHDU(flags, name="FLAGS"),
        fits.ImageHDU(variance, name="VARIANCE"),
        fits.ImageHDU(np.full_like(image, 99.0), name="ZODI"),
    ]
    if include_psf:
        if psf_cube:
            psf = np.zeros((3, 5, 5))
            psf[0, 2, 2] = 1.0
            psf_header = fits.Header({"CRVAL3": 1.5, "CDELT3": 0.1, "CUNIT3": "um"})
            extensions.append(fits.ImageHDU(psf, header=psf_header, name="PSF"))
        else:
            psf = np.zeros_like(image)
            psf[5, 5] = 1.0
            extensions.append(fits.ImageHDU(psf, name="PSF"))
    hdulist = fits.HDUList(extensions)
    stream = BytesIO()
    hdulist.writeto(stream)
    return stream.getvalue()


class NativePhotometryTests(unittest.TestCase):
    def test_extracts_wavelength_and_uncertainty_without_subtracting_zodi(self) -> None:
        result = extract_source_photometry(_cutout(), 10.0, 20.0, {"calibrationFraction": 0.02})
        self.assertEqual(result["dataOrigin"], "live")
        self.assertEqual(result["method"], "aperture")
        self.assertAlmostEqual(result["wavelengthMicrons"], 1.5)
        self.assertGreater(result["fluxMjy"], 0)
        self.assertLess(result["fluxMjy"], 1e-6)
        self.assertGreater(result["uncertaintyMjy"], 0)
        self.assertNotIn("zodi", " ".join(result["quality"]["warnings"]).lower())
        self.assertIn("calibrationMjy", result["uncertainty"])

    def test_flagged_pixels_are_excluded_and_reported(self) -> None:
        result = extract_source_photometry(_cutout(), 10.0, 20.0)
        self.assertTrue(result["quality"]["usable"])
        self.assertIn("flagged pixels were excluded", result["quality"]["warnings"])

    def test_valid_psf_plane_uses_weighted_native_fit(self) -> None:
        result = extract_source_photometry(_cutout(include_psf=True), 10.0, 20.0)
        self.assertEqual(result["method"], "psf")
        self.assertNotIn("valid PSF plane unavailable", result["quality"]["warnings"])

    def test_wavelength_matched_psf_cube_uses_weighted_native_fit(self) -> None:
        result = extract_source_photometry(_cutout(include_psf=True, psf_cube=True), 10.0, 20.0)
        self.assertEqual(result["method"], "psf")

    def test_missing_spectral_wcs_is_unavailable(self) -> None:
        with self.assertRaisesRegex(PhotometryError, "spectral WCS"):
            extract_source_photometry(_cutout(False), 10.0, 20.0)


if __name__ == "__main__":
    unittest.main()
