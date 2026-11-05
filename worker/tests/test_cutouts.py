"""Cutout verification + job-queue wire-contract tests (stdlib only)."""
from __future__ import annotations

import pathlib
import sys
import unittest
from urllib.error import HTTPError

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from lib import jobs, products  # noqa: E402
from lib.cutouts import NotFits, PayloadTooLarge, read_bounded, verify_fits  # noqa: E402


class _FakeResponse:
    """Minimal urllib-like response for read_bounded tests."""

    def __init__(self, body: bytes, content_length=None):
        self.body = body
        self.headers = {"Content-Length": content_length} if content_length else {}

    def read(self, amount=-1):
        if amount in (-1, None):
            chunk, self.body = self.body, b""
            return chunk
        chunk, self.body = self.body[:amount], self.body[amount:]
        return chunk


def _fits_block() -> bytes:
    head = b"SIMPLE  =                    T" + b" " * 63 + b"\n"
    head += b"".join((b"KEY%02d   =                    1" % i) + b" " * 55 + b"\n" for i in range(5))
    return (head + b"END" + b" " * 77 + b"\n").ljust(2880, b"\x00")


class CutoutVerification(unittest.TestCase):
    def test_detects_fits_primary_header(self) -> None:
        self.assertTrue(verify_fits(_fits_block()))
        self.assertFalse(verify_fits(b"<html>" + b" " * 2900))
        self.assertFalse(verify_fits(b"SIMPLE  ="))

    def test_read_bounded_accepts_small_bodies(self) -> None:
        body = _fits_block()
        self.assertEqual(read_bounded(_FakeResponse(body, str(len(body))), 1 << 20), body)

    def test_read_bounded_rejects_declared_full_mef(self) -> None:
        with self.assertRaises(PayloadTooLarge):
            read_bounded(_FakeResponse(_fits_block(), str(400 << 20)), 32 << 20)

    def test_read_bounded_rejects_undisclosed_oversize(self) -> None:
        with self.assertRaises(PayloadTooLarge):
            read_bounded(_FakeResponse(b"\x00" * (48 << 20)), 32 << 20)


class QueueWireContract(unittest.TestCase):
    def test_claim_request_shape(self) -> None:
        request = jobs.postgrest_claim("worker-1")
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.path, "/rpc/claim_processing_job")
        self.assertEqual(request.body, {"worker_id": "worker-1"})

    def test_claim_parses_row_and_empty_queue(self) -> None:
        row = {"id": "abc", "status": "running", "product": "cutout-render"}
        self.assertEqual(jobs.parse_claim([row])["id"], "abc")
        self.assertEqual(jobs.parse_claim(row)["id"], "abc")
        self.assertIsNone(jobs.parse_claim(None))
        self.assertIsNone(jobs.parse_claim([]))
        self.assertIsNone(jobs.parse_claim({"id": "abc", "status": "queued"}))

    def test_fail_request_carries_reason(self) -> None:
        request = jobs.postgrest_patch("job-9", {"status": "failed", "error_reason": "IRSA 503"})
        self.assertEqual(request.method, "PATCH")
        self.assertTrue(request.path.startswith("/processing_jobs?id=eq.job-9"))
        self.assertEqual(request.body, {"status": "failed", "error_reason": "IRSA 503"})

    def test_jobs_requires_configuration(self) -> None:
        with self.assertRaises(ValueError):
            jobs.Jobs("", "")
        with self.assertRaises(ValueError):
            jobs.Jobs("https://example.supabase.co", "")
        client = jobs.Jobs("https://example.supabase.co", "service-key")
        self.assertEqual(client.headers["Authorization"], "Bearer service-key")


class ProductStaging(unittest.TestCase):
    def test_every_product_verifies_cutout_first(self) -> None:
        for product in ("cutout-render", "photometry"):
            stages = [stage for stage, _ in products.staged_products(product, {})]
            self.assertEqual(stages[0], "verify-cutout", f"{product} must verify cutout support before any full download")

    def test_dependency_reason_lists_missing_names(self) -> None:
        reason = products.dependency_reason({"astropy": True, "photutils": False})
        self.assertIn("photutils", reason)
        self.assertNotIn("astropy", reason)
        self.assertIsNone(products.dependency_reason({"astropy": True, "numpy": True}))

    def test_worker_dependency_lists_match_requirements(self) -> None:
        self.assertEqual(products.product_dependencies("cutout-render"), ["astropy", "numpy"])
        self.assertEqual(
            products.product_dependencies("photometry"),
            ["astropy", "numpy"],
        )


if __name__ == "__main__":
    unittest.main()
