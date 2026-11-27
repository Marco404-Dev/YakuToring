"""Frozen four-model predictions and persistent laboratory validation sessions."""

import csv
import hashlib
import io
import json
import logging
import math
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import joblib
import numpy as np
import pandas as pd
from catboost import CatBoostRegressor
from sklearn.linear_model import Ridge

from experimental_od import FEATURES, EC_WARNING, features, numeric

ARTIFACTS = Path(__file__).parent / "models/comparison"
MODEL_KEYS = ("catboost", "mlp", "weighted", "stacking")
META_FIELDS = ("sampleCode", "samplingPoint", "depthM", "collectedAt", "phase", "observations")


def grouped_metrics(samples, phase, model):
    groups = {}
    for sample in samples:
        metadata = sample["metadata"]
        if metadata["phase"] != phase or sample["errors"][model] is None:
            continue
        key = (metadata["samplingPoint"].strip().casefold(),
               metadata["sampleCode"].strip().casefold())
        groups.setdefault(key, []).append(
            (sample["reference"], sample["prediction"]["models"][model]["value"])
        )
    pairs = [{"point": key[0], "sample": key[1], "readings": len(group),
              "reference": float(np.mean([pair[0] for pair in group])),
              "prediction": float(np.mean([pair[1] for pair in group]))}
             for key, group in groups.items()]
    observed = np.array([pair["reference"] for pair in pairs])
    predicted = np.array([pair["prediction"] for pair in pairs])
    residuals = predicted - observed
    spread = float(np.sum((observed - observed.mean()) ** 2)) if len(pairs) >= 3 else 0
    return {
        "n": len(pairs), "pairs": pairs,
        "mae": float(np.mean(np.abs(residuals))) if pairs else None,
        "rmse": float(np.sqrt(np.mean(residuals ** 2))) if pairs else None,
        "bias": float(np.mean(residuals)) if pairs else None,
        "r2": 1 - float(np.sum(residuals ** 2)) / spread if spread > 0 else None,
    }


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Falta una fecha ISO 8601 con zona horaria.")
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("La fecha debe incluir su zona horaria.")
    return parsed


class Models:
    def __init__(self, artifact_dir=ARTIFACTS, enabled=MODEL_KEYS):
        self.loaded = {}
        self.enabled = set(enabled)
        self.errors = {}
        self.hashes = {}
        self.version = "NOAA-07-08-09-experimental"
        self.tz = ZoneInfo("America/Lima")
        self.artifact_dir = Path(artifact_dir)
        try:
            self.manifest = json.loads((self.artifact_dir / "manifest.json").read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            self.manifest = []
        for key, loader in [
            ("catboost", self.load_catboost),
            ("mlp", self.load_mlp),
            ("weighted", self.load_weighted),
            ("stacking", self.load_stacking),
        ]:
            if key not in self.enabled:
                continue
            try:
                self.loaded[key] = loader()
            except Exception as error:
                logging.exception("No se pudo cargar %s", key)
                self.errors[key] = f"{type(error).__name__}: {str(error)[:180]}"

    def path(self, name):
        record = next((item for item in self.manifest if Path(item["path"]).name == name), None)
        if record is None:
            raise FileNotFoundError(f"Falta el registro del artefacto {name}")
        path = self.artifact_dir / record["path"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != record["sha256"]:
            raise ValueError(f"SHA-256 inválido en {name}")
        self.hashes[name] = digest
        return path

    def load_catboost(self):
        bundle = joblib.load(self.path("07_CatBoost_base05_300k.joblib"))
        model = bundle["estimador"]
        if bundle["features"] != FEATURES or bundle["objetivo"] != "DO_mgl":
            raise ValueError("Contrato CatBoost incompatible")
        if not isinstance(model, CatBoostRegressor) or list(model.feature_names_) != FEATURES:
            raise ValueError("Estimador CatBoost incompatible")
        return model

    def load_mlp(self):
        # Import after NumPy/sklearn/CatBoost to share the initialized OpenMP runtime.
        import torch
        from torch import nn
        torch.set_num_threads(1)
        meta = json.loads(self.path("08_MLP_128-64-32_experimental.json").read_text(encoding="utf-8"))
        if meta["features"] != FEATURES or meta["arquitectura"] != [128, 64, 32] or meta["objetivo"] != "DO_mgl":
            raise ValueError("Metadatos MLP incompatibles")
        scaler = joblib.load(self.path(meta["escalador"]))
        if scaler.n_features_in_ != 8:
            raise ValueError("Escalador MLP incompatible")

        class MLP(nn.Module):
            def __init__(self):
                super().__init__()
                self.net = nn.Sequential(
                    nn.Linear(8, 128), nn.ReLU(), nn.Linear(128, 64), nn.ReLU(),
                    nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 1),
                )

            def forward(self, x):
                return self.net(x).squeeze(-1)

        model = MLP()
        model.load_state_dict(torch.load(self.path(meta["pesos"]), map_location="cpu", weights_only=True))
        model.eval()
        return model, scaler

    def load_weighted(self):
        conf = json.loads(self.path("09_mezcla_ponderada_experimental.json").read_text(encoding="utf-8"))
        if conf["variables"] != FEATURES or not math.isclose(conf["peso_CatBoost"], .55) or not math.isclose(conf["peso_MLP"], .45):
            raise ValueError("Mezcla incompatible")
        return conf["peso_CatBoost"], conf["peso_MLP"]

    def load_stacking(self):
        bundle = joblib.load(self.path("09_stacking_Ridge_experimental.joblib"))
        if bundle["features"] != FEATURES or bundle["inputs"] != ["pred_CatBoost", "pred_MLP"]:
            raise ValueError("Contrato Stacking incompatible")
        if not isinstance(bundle["estimador"], Ridge) or bundle["estimador"].n_features_in_ != 2:
            raise ValueError("Estimador Ridge incompatible")
        return bundle["estimador"]

    def predict(self, row, blocked=None):
        result = {
            "at": row.get("at"), "packet": row.get("packet"),
            "inputs": {key: row.get(key) for key in (
                "temperature", "ph", "conductivity", "pressure",
                "conductivityOriginal", "conductivityUnit", "conductivityUsCm",
            )},
            "version": self.version, "hashes": self.hashes,
            "warnings": [EC_WARNING, "Hora civil America/Lima; timestamp de recepción cuando el paquete carece de fecha."],
            "models": {
                key: {"value": None, "status": "disabled" if key not in self.enabled else "unavailable" if key in self.errors else "pending",
                      "error": self.errors.get(key)}
                for key in MODEL_KEYS
            },
            "features": None, "spread": None,
        }
        try:
            if blocked:
                raise ValueError(blocked)
            at = timestamp(row.get("at"))
            for key, low, high in [
                ("temperature", -55, 125), ("ph", 0, 14),
                ("conductivity", 0, math.inf), ("pressure", .01, 2000),
            ]:
                if not numeric(row.get(key), low, high):
                    raise ValueError(f"Entrada esencial ausente o inválida: {key}")
            if row.get("conductivityUnit") not in ("uS/cm", "mS/cm"):
                raise ValueError("Unidad de conductividad sin confirmar")
            frame = features(
                [row[key] for key in ("temperature", "ph", "conductivity", "pressure")],
                at.astimezone(self.tz),
            )
            result["features"] = frame.iloc[0].to_dict()
        except (ValueError, TypeError, OverflowError) as error:
            for entry in result["models"].values():
                if entry["status"] == "pending":
                    entry.update(status="invalid_inputs", error=str(error))
            return result

        for key in MODEL_KEYS:
            if key not in self.loaded:
                continue
            try:
                if key == "catboost":
                    value = float(self.loaded[key].predict(frame)[0])
                elif key == "mlp":
                    import torch
                    model, scaler = self.loaded[key]
                    x = scaler.transform(frame.to_numpy(dtype="float32")).astype("float32")
                    with torch.inference_mode():
                        value = float(model(torch.from_numpy(x))[0])
                else:
                    base = [result["models"][k]["value"] for k in ("catboost", "mlp")]
                    if any(value is None for value in base):
                        raise ValueError("Predicciones base no disponibles")
                    if key == "weighted":
                        value = float(np.dot(self.loaded[key], base))
                    else:
                        value = float(self.loaded[key].predict(np.array([base], dtype="float64"))[0])
                if not math.isfinite(value):
                    raise ValueError("Resultado no finito")
                result["models"][key].update(value=value, status="experimental")
            except Exception as error:
                result["models"][key].update(status="inference_error", error=str(error)[:180])
        values = [item["value"] for item in result["models"].values() if item["value"] is not None]
        if len(values) == 4:
            result["spread"] = max(values) - min(values)
        return result


class Comparison:
    def __init__(self, db, models=None):
        self.db = db
        self.models = models or Models()
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS comparison_runs (
                id TEXT PRIMARY KEY, at TEXT NOT NULL, result TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS experiment_sessions (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS experiment_samples (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, run_id TEXT NOT NULL,
                metadata TEXT NOT NULL, reference REAL, reference_at TEXT,
                FOREIGN KEY(session_id) REFERENCES experiment_sessions(id),
                FOREIGN KEY(run_id) REFERENCES comparison_runs(id),
                UNIQUE(session_id, run_id)
            );
            CREATE TRIGGER IF NOT EXISTS experiment_limit BEFORE INSERT ON experiment_samples
            WHEN (SELECT COUNT(*) FROM experiment_samples WHERE session_id=NEW.session_id)>=100
            BEGIN SELECT RAISE(ABORT, 'La sesión ya contiene 100 mediciones'); END;
        """)

    def ingest(self, row, result=None):
        result = self.models.predict(row) if result is None else result
        result["id"] = row.get("captureId") or str(uuid.uuid4())
        with self.db:
            self.db.execute("INSERT INTO comparison_runs VALUES(?,?,?)",
                            (result["id"], result["at"], json.dumps(result, allow_nan=False)))
        return result

    def create(self, name):
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
            raise ValueError("Introduce un nombre de sesión de 1 a 100 caracteres.")
        with self.db:
            self.db.execute("INSERT INTO experiment_sessions VALUES(?,?,?)",
                            (str(uuid.uuid4()), name.strip(), datetime.now(timezone.utc).isoformat()))

    def sample(self, session_id, run_id, meta):
        if not isinstance(meta, dict):
            raise ValueError("Faltan los datos de la muestra.")
        clean = {key: meta.get(key) for key in META_FIELDS}
        for key in ("sampleCode", "samplingPoint"):
            if not isinstance(clean[key], str) or not 1 <= len(clean[key].strip()) <= 100:
                raise ValueError(f"Falta {key} (máximo 100 caracteres).")
        if clean["phase"] not in ("field", "laboratory"):
            raise ValueError("Indica si los sensores se midieron en campo o en laboratorio.")
        if clean["depthM"] is not None and not numeric(clean["depthM"], 0, 12000):
            raise ValueError("Profundidad inválida en metros.")
        if not isinstance(clean["observations"], str) or len(clean["observations"]) > 2000:
            raise ValueError("Observaciones inválidas (máximo 2000 caracteres).")
        collected = timestamp(clean["collectedAt"])
        row = self.db.execute("SELECT result FROM comparison_runs WHERE id=?", (run_id,)).fetchone()
        if not row or not self.db.execute("SELECT 1 FROM experiment_sessions WHERE id=?", (session_id,)).fetchone():
            raise ValueError("Selecciona una sesión y una medición guardada.")
        run = json.loads(row[0])
        if collected > timestamp(run["at"]):
            raise ValueError("La recolección debe ser anterior o igual a la medición.")
        if not any(item["value"] is not None for item in run["models"].values()):
            raise ValueError("Esta medición carece de predicciones válidas.")
        with self.db:
            self.db.execute("INSERT INTO experiment_samples VALUES(?,?,?,?,NULL,NULL)",
                            (str(uuid.uuid4()), session_id, run_id, json.dumps(clean)))

    def reference(self, sample_id, value, at):
        if not numeric(value, 0, 100):
            raise ValueError("OD de referencia inválido en mg/L.")
        measured = timestamp(at)
        row = self.db.execute("""
            SELECT r.at,s.metadata FROM experiment_samples s
            JOIN comparison_runs r ON r.id=s.run_id WHERE s.id=?
        """, (sample_id,)).fetchone()
        if not row:
            raise ValueError("Muestra no encontrada.")
        if measured < timestamp(json.loads(row[1])["collectedAt"]):
            raise ValueError("La lectura de la sonda debe ser posterior a la recolección.")
        # The reference time is kept independently from the frozen prediction.
        with self.db:
            self.db.execute("UPDATE experiment_samples SET reference=?,reference_at=? WHERE id=?",
                            (value, measured.isoformat(), sample_id))

    def samples(self, session_id):
        rows = self.db.execute("""
            SELECT s.id,s.metadata,s.reference,s.reference_at,r.result
            FROM experiment_samples s JOIN comparison_runs r ON s.run_id=r.id
            WHERE s.session_id=? ORDER BY s.rowid
        """, (session_id,)).fetchall()
        return [
            {"id": sid, "metadata": json.loads(meta), "reference": ref,
             "referenceAt": ref_at, "prediction": json.loads(pred),
             "errors": {key: abs(ref - value["value"]) if ref is not None and value["value"] is not None else None
                        for key, value in json.loads(pred)["models"].items()}}
            for sid, meta, ref, ref_at, pred in rows
        ]

    def snapshot(self):
        sessions = []
        for sid, name, at in self.db.execute("SELECT * FROM experiment_sessions ORDER BY rowid DESC"):
            samples = self.samples(sid)
            metrics = {
                phase: {key: grouped_metrics(samples, phase, key) for key in MODEL_KEYS}
                for phase in ("field", "laboratory")
            }
            sessions.append({"id": sid, "name": name, "createdAt": at,
                             "count": len(samples), "samples": samples, "metrics": metrics})
        recent = self.runs()
        return {"sessions": sessions, "recent": recent, "latest": recent[0] if recent else None,
                "availability": {key: {"loaded": key in self.models.loaded, "error": self.models.errors.get(key)}
                                 for key in MODEL_KEYS}}

    def runs(self, before=None):
        if before is not None and (not isinstance(before, int) or before < 1):
            raise ValueError("Cursor de mediciones inválido.")
        rows = self.db.execute("""
            SELECT rowid,result FROM comparison_runs WHERE rowid < ?
            ORDER BY rowid DESC LIMIT 30
        """, (before if before is not None else 9223372036854775807,)).fetchall()
        return [{**json.loads(result), "cursor": cursor} for cursor, result in rows]

    def export(self, session_id):
        if not self.db.execute("SELECT 1 FROM experiment_sessions WHERE id=?", (session_id,)).fetchone():
            raise ValueError("Sesión no encontrada.")
        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\r\n")
        writer.writerow([
            "sesion_id", "muestra_id", "codigo_muestra", "punto_muestreo", "profundidad_m",
            "fecha_hora_recoleccion", "fecha_hora_sensores", "contexto_sensores",
            "fecha_hora_medicion_laboratorio", "temperatura_agua_c", "ph",
            "conductividad_original", "unidad_conductividad_original",
            "conductividad_us_cm", "conductividad_ms_cm", "presion_hpa",
            "od_referencia_mg_l", *[f"od_{key}_mg_l" for key in MODEL_KEYS],
            *[f"error_absoluto_{key}_mg_l" for key in MODEL_KEYS],
            *[f"estado_{key}" for key in MODEL_KEYS],
            "observaciones", "version_modelos", "inputs_json", "hashes_modelos_json",
        ])
        for sample in self.samples(session_id):
            meta, run = sample["metadata"], sample["prediction"]
            inp = run["inputs"]
            values = [
                session_id, sample["id"], meta["sampleCode"], meta["samplingPoint"], meta["depthM"],
                meta["collectedAt"], run["at"], meta["phase"], sample["referenceAt"],
                inp["temperature"], inp["ph"], inp["conductivityOriginal"], inp["conductivityUnit"],
                inp["conductivityUsCm"], inp["conductivity"], inp["pressure"], sample["reference"],
                *[run["models"][key]["value"] for key in MODEL_KEYS],
                *[sample["errors"][key] for key in MODEL_KEYS],
                *[run["models"][key]["status"] for key in MODEL_KEYS],
                meta["observations"], run["version"], json.dumps(run["features"]), json.dumps(run["hashes"]),
            ]
            writer.writerow(["'" + value if isinstance(value, str) and value.startswith(("=", "+", "-", "@"))
                             else value for value in values])
        return output.getvalue()
