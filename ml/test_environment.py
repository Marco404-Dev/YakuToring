import sqlite3
import unittest
from contextlib import closing

from datasets import Datasets
from environment_inference import predict, reference
from comparison import grouped_metrics


class FakeModels:
    def predict(self, row):
        return {"inputs": row, "models": {}, "spread": None}


class TestEnvironment(unittest.TestCase):
    def test_csv_inference_reuses_reference(self):
        center = reference()["projection"]["mean"]
        valid = ",".join(map(str, center))
        csv = ("at,temperature,ph,conductivity,pressure\n"
               f"2024-04-20T13:45:00Z,{valid}\n"
               "2024-04-20T13:45:00Z,900,8,9,1000\n"
               "2024-04-20T13:45:00Z,,8,9,1000\n")
        results = predict(FakeModels(), None, csv)["predictions"]
        self.assertEqual(results[0]["inputs"]["conductivityUnit"], "mS/cm")
        self.assertIn("isolation", results[0])
        self.assertIn("estimación extrapolada", results[1]["status"])
        self.assertIn("insuficiente", results[2]["status"])

    def test_csv_archive_preserves_original_and_reports_quality(self):
        with closing(sqlite3.connect(":memory:")) as db:
            catalogs = Datasets(db)
            raw = '\ufeffid,temp\r\n"A, B",\r\n"A, B",\r\n'
            first = catalogs.save("campaña.csv", "Campo Perú", raw)
            self.assertEqual(catalogs.save("otra.csv", "Campo Perú", raw), first)
            item = catalogs.list()["datasets"][0]
            self.assertEqual((item["duplicates"], item["empty"]["temp"]), (1, 2))
            self.assertEqual(catalogs.get(first["id"])["csv"], raw)
            self.assertEqual(catalogs.get(first["id"], 0, "a, b")["records"], 2)
            with self.assertRaises(ValueError):
                catalogs.save("mal.csv", "Campo Perú", "a,b\n1")

    def test_grouping_keeps_local_repeats_together(self):
        def sample(code, phase, reference, estimate):
            return {
                "metadata": {"sampleCode": code, "samplingPoint": "A", "phase": phase},
                "reference": reference, "prediction": {"models": {"mlp": {"value": estimate}}},
                "errors": {"mlp": abs(estimate - reference)},
            }
        rows = [sample("M01", "laboratory", 8, 10), sample("m01", "laboratory", 8, 8),
                sample("M01", "field", 8, 7)]
        result = grouped_metrics(rows, "laboratory", "mlp")
        self.assertEqual(result["n"], 1)
        self.assertEqual(result["pairs"][0]["readings"], 2)
        self.assertEqual(result["mae"], 1)
        self.assertIsNone(result["r2"])


if __name__ == "__main__":
    unittest.main()
