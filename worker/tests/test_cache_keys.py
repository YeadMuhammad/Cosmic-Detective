"""Golden cache-key cases shared with the JavaScript implementation.

worker/cache_key_cases.json locks worker/lib/cache_keys.py and
netlify/lib/processing.mjs together: both must produce the same keys, or a
cache write and lookup would disagree across the stack.
"""
from __future__ import annotations

import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from lib.cache_keys import KEY_VERSION, cache_key, canonical_params, params_hash, upload_path  # noqa: E402

CASES = json.loads((pathlib.Path(__file__).resolve().parents[1] / "cache_key_cases.json").read_text(encoding="utf-8"))


def key_from_input(case_input: dict) -> str:
    return cache_key(
        case_input["product"],
        collection=case_input["collection"],
        obs_id=case_input["obsId"],
        detector=case_input["detector"],
        release=case_input["release"],
        ra=case_input["ra"],
        dec=case_input["dec"],
        size_deg=case_input["sizeDeg"],
        params=case_input.get("params", {}),
    )


class CacheKeyGoldenTests(unittest.TestCase):
    def test_key_version_is_v1(self) -> None:
        self.assertEqual(KEY_VERSION, CASES["keyVersion"], "goldens and implementation must track the same version")

    def test_golden_cases(self) -> None:
        for case in CASES["cases"]:
            with self.subTest(case=case["name"]):
                self.assertEqual(key_from_input(case["input"]), case["key"])

    def test_param_order_is_irrelevant(self) -> None:
        first = {"a": "x", "b": 1, "c": True, "d": "y"}
        second = {"d": "y", "c": True, "b": 1, "a": "x"}
        self.assertEqual(params_hash("p", first), params_hash("p", second))

    def test_invalid_inputs_rejected(self) -> None:
        for case in CASES["invalid"]:
            with self.subTest(case=case["name"]):
                with self.assertRaises(ValueError):
                    key_from_input(case["input"])

    def test_canonical_params_renders_pytuples_like_json(self) -> None:
        self.assertEqual(canonical_params("p", {"a": "x", "b": 2}), '{"a":"x","b":2,"product":"p"}')


if __name__ == "__main__":
    unittest.main()
