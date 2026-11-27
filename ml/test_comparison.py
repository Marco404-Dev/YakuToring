import csv
import io
import json
import math
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from comparison import Comparison, Models, MODEL_KEYS
from experimental_od import FEATURES
import torch


class FourModelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.models = Models()
        if cls.models.errors:
            raise AssertionError(cls.models.errors)
        cls.row = {
            "at": "2024-02-29T17:30:00Z", "packet": 12,
            "temperature": 24., "ph": 7.8, "conductivity": 1.413,
            "conductivityOriginal": 1413., "conductivityUsCm": 1413.,
            "conductivityUnit": "uS/cm", "pressure": 1013.,
        }

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.comparison = Comparison(self.db, self.models)

    def test_notebook_parity_and_single_execution_of_bases(self):
        cb = self.models.loaded["catboost"]
        mlp, scaler = self.models.loaded["mlp"]
        with patch.object(cb, "predict", wraps=cb.predict) as predict_cb, patch.object(
            mlp, "forward", wraps=mlp.forward
        ) as predict_mlp:
            result = self.models.predict(self.row)
            self.assertEqual(predict_cb.call_count, 1)
            self.assertEqual(predict_mlp.call_count, 1)
        self.assertEqual(list(result["features"]), FEATURES)
        self.assertEqual(len(result["hashes"]), 6)
        h, day = 12.5, 60
        cycles = np.array([
            math.sin(2 * math.pi * h / 24), math.cos(2 * math.pi * h / 24),
            math.sin(2 * math.pi * day / 365.25), math.cos(2 * math.pi * day / 365.25),
        ], dtype="float32")
        x = np.array([[24., 7.8, 1.413, 1013., *cycles]], dtype="float32")
        scaled = scaler.transform(x).astype("float32")
        with torch.no_grad():
            expected_mlp = float(mlp(torch.from_numpy(scaled))[0])
        values = result["models"]
        self.assertAlmostEqual(values["mlp"]["value"], expected_mlp)
        base = [values[key]["value"] for key in ("catboost", "mlp")]
        self.assertAlmostEqual(values["weighted"]["value"], .55 * base[0] + .45 * base[1])
        self.assertAlmostEqual(values["stacking"]["value"],
                               float(self.models.loaded["stacking"].predict([base])[0]))
        self.assertAlmostEqual(result["spread"],
                               max(v["value"] for v in values.values()) - min(v["value"] for v in values.values()))
        # A reference or voltage cannot leak into any predictor.
        again = self.models.predict({**self.row, "od_referencia_mg_l": 0, "odVoltageV": 3})
        self.assertEqual(result["models"], again["models"])

    def test_missing_inputs_and_model_failure(self):
        for bad in ({"pressure": None}, {"ph": True}, {"at": "2024-02-29T12:30:00"},
                    {"conductivityUnit": "ppm"}, {"conductivity": -1}):
            with self.subTest(bad=bad):
                result = self.models.predict({**self.row, **bad})
                self.assertTrue(all(v["value"] is None for v in result["models"].values()))
        with tempfile.TemporaryDirectory() as folder:
            with self.assertLogs(level="ERROR"):
                broken = Models(folder)
            self.assertEqual(set(broken.errors), set(MODEL_KEYS))
        with patch.dict(self.models.loaded, {"catboost": None}):
            output = self.models.predict(self.row)
            self.assertIsNone(output["models"]["catboost"]["value"])
            self.assertIsNone(output["models"]["weighted"]["value"])
            self.assertIsNotNone(output["models"]["mlp"]["value"])

    def test_reference_csv_metrics_and_preserved_prediction(self):
        self.comparison.ingest(self.row)
        run = self.comparison.snapshot()["latest"]
        self.comparison.create("SIMULADO LABORATORIO")
        sid = self.comparison.snapshot()["sessions"][0]["id"]
        meta = {
            "sampleCode": "M-01", "samplingPoint": "Punto A, manglar", "depthM": None,
            "collectedAt": "2024-02-29T08:00:00-05:00", "phase": "laboratory",
            "observations": 'Ensayo sintético, "prueba"',
        }
        self.comparison.sample(sid, run["id"], meta)
        sample = self.comparison.snapshot()["sessions"][0]["samples"][0]
        before = self.db.execute("SELECT result FROM comparison_runs").fetchone()[0]
        self.comparison.reference(sample["id"], 7., "2024-02-29T12:31:00-05:00")
        self.assertEqual(before, self.db.execute("SELECT result FROM comparison_runs").fetchone()[0])
        session = self.comparison.snapshot()["sessions"][0]
        for key in MODEL_KEYS:
            self.assertEqual(session["metrics"]["laboratory"][key]["n"], 1)
            self.assertAlmostEqual(session["metrics"]["laboratory"][key]["mae"],
                                   abs(7 - run["models"][key]["value"]))
            self.assertEqual(session["metrics"]["field"][key]["n"], 0)
        rows = list(csv.DictReader(io.StringIO(self.comparison.export(sid))))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["conductividad_us_cm"], "1413.0")
        self.assertEqual(rows[0]["conductividad_ms_cm"], "1.413")
        self.assertEqual(rows[0]["profundidad_m"], "")
        self.assertEqual(rows[0]["observaciones"], meta["observations"])
        with self.assertRaises(ValueError):
            self.comparison.reference(sample["id"], None, self.row["at"])
        with self.assertRaises(sqlite3.IntegrityError):
            self.comparison.sample(sid, run["id"], meta)

    def test_limit_is_100_and_sessions_are_independent(self):
        self.comparison.create("SIMULADO 100")
        sid = self.comparison.snapshot()["sessions"][0]["id"]
        # Reuse a frozen synthetic inference to exercise the storage limit.
        result = self.models.predict(self.row)
        meta = {
            "sampleCode": "M", "samplingPoint": "P", "depthM": 0,
            "collectedAt": "2024-02-29T08:00:00-05:00", "phase": "field", "observations": "",
        }
        for i in range(101):
            run_id = f"SIMULADO-{i}"
            self.db.execute("INSERT INTO comparison_runs VALUES(?,?,?)",
                            (run_id, self.row["at"], json.dumps({**result, "id": run_id})))
            self.db.commit()
            if i == 100:
                with self.assertRaises(sqlite3.IntegrityError):
                    self.comparison.sample(sid, run_id, meta)
            else:
                self.comparison.sample(sid, run_id, meta)
        self.assertEqual(len(list(csv.DictReader(io.StringIO(self.comparison.export(sid))))), 100)
        self.comparison.create("SEGUNDA SIMULADA")
        state = self.comparison.snapshot()
        self.assertEqual([s["count"] for s in state["sessions"]], [0, 100])
