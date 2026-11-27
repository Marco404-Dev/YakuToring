import math
import os
import sqlite3
import unittest
from unittest.mock import patch

from experimental_od import DEMO, FEATURES, ExperimentalOD, zone


class CandidateTests(unittest.TestCase):
    def setUp(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        with patch.dict(os.environ, {"YAKUTORING_OD_ALLOW_PROVISIONAL_EC": "0"}):
            self.od = ExperimentalOD(db)
        self.assertIsNone(self.od.error)
        self.row = {**DEMO, "format": "DATA", "packet": 1}

    def test_real_joblib_and_feature_contract(self):
        result = self.od.estimate(DEMO, demo=True)
        self.assertEqual(result["status"], "experimental")
        x = result["features"]
        self.assertEqual(list(x), FEATURES)
        self.assertEqual(list(x.values())[:4], [24, 7.8, 15, 1013])
        self.assertEqual(result["localTime"], "2024-02-29T12:30:00-05:00")
        for key, expected in zip(FEATURES[4:], [
            math.sin(math.tau * 12.5 / 24), math.cos(math.tau * 12.5 / 24),
            math.sin(math.tau * 60 / 365.25), math.cos(math.tau * 60 / 365.25),
        ]):
            self.assertAlmostEqual(x[key], expected, places=7)
        self.assertTrue(math.isfinite(result["od_estimado_mg_l"]))
        self.assertIsNone(self.od.snapshot("campo")["latest"])

    def test_block_and_invalid_inputs(self):
        self.assertEqual(self.od.estimate(self.row)["status"], "ec_bloqueada")
        self.od.allow_provisional = True
        for bad in [
            {"conductivity": None, "tds": 707}, {"pressure": "1013"},
            {"temperature": float("inf")}, {"ph": True},
            {"at": "2024-02-29T12:30:00"}, {"at": None},
        ]:
            with self.subTest(bad=bad):
                result = self.od.estimate({**self.row, **bad})
                self.assertEqual(result["status"], "entradas_invalidas")
                self.assertIsNone(result["od_estimado_mg_l"])
        self.assertEqual(self.od.estimate({**self.row, "format": None})["status"], "unidad_desconocida")

    def test_pairs_reference_correction_and_lot_isolation(self):
        self.od.ingest(self.row, "campo")
        blocked = self.od.snapshot("campo")["latest"]
        self.od.reference(blocked["id"], 7, "campo")
        self.assertEqual(self.od.snapshot("campo")["metrics"], {"n": 0, "mae": None})
        self.od.allow_provisional = True
        self.od.ingest(self.row, "campo")
        result = self.od.snapshot("campo")["latest"]
        prediction = result["od_estimado_mg_l"]
        self.assertTrue(math.isfinite(prediction))
        with self.assertRaises(ValueError):
            self.od.reference(result["id"], 7, "otro lote")
        with self.assertRaises(ValueError):
            self.od.reference(result["id"], "7", "campo")
        self.od.reference(result["id"], 7, "campo")
        self.od.reference(result["id"], 8, "campo")
        latest = self.od.snapshot("campo")
        self.assertEqual(latest["latest"]["od_referencia_mg_l"], 8)
        self.assertEqual(latest["latest"]["error_absoluto_mg_l"], abs(prediction - 8))
        self.assertEqual(latest["metrics"], {"n": 1, "mae": abs(prediction - 8)})

    def test_zone_boundaries(self):
        self.assertEqual(
            [zone(v)[0] for v in [3.99, 4, 5.49, 5.5, 8.5, 8.51, 10, 10.01]],
            ["fuera", "inferior", "inferior", "central", "central", "superior", "superior", "fuera"],
        )
