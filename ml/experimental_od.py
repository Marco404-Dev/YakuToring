"""Instantaneous OD estimation with the supplied NOAA benchmark candidate."""

import hashlib
import json
import logging
import math
import os
import uuid
import warnings
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.exceptions import InconsistentVersionWarning


FEATURES = ["Temp", "pH", "SpCond", "BP_hPa", "hora_sin", "hora_cos", "dia_sin", "dia_cos"]
MODEL_VERSION = "05-ligero-HistGradientBoosting-NOAA"
MODEL_SHA256 = "a72396f99a987b3410f8d33140b3f6462562f429a2fedb78d5cab0683297e2a2"
MODEL_PATH = Path(__file__).parent / "models/05_candidato_ligero_HistGradientBoosting.joblib"
SENSORS = {
    "temperature": ("°C", -55, 125),
    "ph": ("pH", 0, 14),
    "conductivity": ("mS/cm", 0, math.inf),
    "pressure": ("hPa", 0.01, 2000),
}
EC_WARNING = "Equivalencia Gravity TDS–SpCond pendiente de validar. EC provisional en mS/cm."
DEMO = {
    "at": "2024-02-29T17:30:00Z",
    "temperature": 24,
    "ph": 7.8,
    "conductivity": 15,
    "pressure": 1013,
}


def numeric(value, low, high):
    return type(value) in (int, float) and low <= value <= high and math.isfinite(value)


def features(inputs, local_time):
    hour = 2 * np.pi * (local_time.hour + local_time.minute / 60) / 24
    day = 2 * np.pi * local_time.timetuple().tm_yday / 365.25
    cycles = np.array([np.sin(hour), np.cos(hour), np.sin(day), np.cos(day)], dtype="float32")
    return pd.DataFrame([[*inputs, *cycles]], columns=FEATURES)


def zone(value):
    if value < 4 or value > 10:
        return "fuera", "Fuera del intervalo prioritario: verificar con instrumento de referencia."
    if value < 5.5:
        return "inferior", "Estimación con cautela: zona de amortiguación inferior."
    if value <= 8.5:
        return "central", "Estimación en zona central; pendiente de validación de campo."
    return "superior", "Estimación con cautela: zona de amortiguación superior."


def load_model():
    if hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest() != MODEL_SHA256:
        raise ValueError("El archivo no coincide con el candidato proporcionado.")
    with warnings.catch_warnings():
        warnings.simplefilter("error", InconsistentVersionWarning)
        bundle = joblib.load(MODEL_PATH)
    model = bundle.get("estimador") if isinstance(bundle, dict) else None
    if (
        not isinstance(model, HistGradientBoostingRegressor)
        or bundle.get("features") != FEATURES
        or list(model.feature_names_in_) != FEATURES
        or bundle.get("objetivo") != "DO_mgl"
        or bundle.get("modo") != "LIGERO"
    ):
        raise ValueError("El estimador y sus entradas no coinciden con el contrato NOAA.")
    return model


class ExperimentalOD:
    def __init__(self, db, enabled=True):
        self.db = db
        self.allow_provisional = os.environ.get("YAKUTORING_OD_ALLOW_PROVISIONAL_EC") == "1"
        self.model = None
        self.error = None
        try:
            self.tz = ZoneInfo("America/Lima")
            if enabled:
                self.model = load_model()
        except Exception:
            logging.exception("No se pudo cargar el candidato NOAA")
            self.error = "Modelo NOAA no disponible. Comprueba el archivo y el entorno Python."
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS experimental_od (
                id TEXT PRIMARY KEY, lot TEXT NOT NULL, model_sha256 TEXT NOT NULL,
                result TEXT NOT NULL, prediction REAL, reference REAL
            )
        """)
        self.db.execute("CREATE INDEX IF NOT EXISTS experimental_od_lot ON experimental_od(lot, model_sha256)")

    def estimate(self, row, demo=False):
        values = {}
        for key, (unit, low, high) in SENSORS.items():
            value = row.get(key)
            values[key] = {
                "value": value if numeric(value, low, high) else None,
                "unit": unit,
                "status": "ausente" if value is None else "valido" if numeric(value, low, high) else "invalido",
            }
        result = {
            "at": row.get("at"),
            "sequence": row.get("packet"),
            "modelVersion": MODEL_VERSION,
            "modelSha256": MODEL_SHA256,
            "source": "demo" if demo else "serial",
            "timeSource": "muestra_fija" if demo else "recepcion_usb",
            "sensors": values,
            "warnings": ["Datos simulados de demostración."] if demo else [EC_WARNING],
            "features": None,
            "od_estimado_mg_l": None,
            "od_referencia_mg_l": None,
            "error_absoluto_mg_l": None,
            "zone": None,
        }
        missing = [key for key, sensor in values.items() if sensor["status"] != "valido"]
        try:
            timestamp = datetime.fromisoformat(row["at"])
            if timestamp.utcoffset() is None:
                raise ValueError("Fecha sin desplazamiento")
        except (KeyError, TypeError, ValueError):
            timestamp = None
            missing.append("fecha con zona horaria")

        if missing:
            status, message = "entradas_invalidas", "Entradas ausentes o inválidas: " + ", ".join(missing)
        elif not demo and row.get("format") not in {"DATA", "YK"}:
            status, message = "unidad_desconocida", "Formato sin contrato de unidades reconocido."
        elif self.model is None:
            status, message = "modelo_no_disponible", self.error
        else:
            local_time = timestamp.astimezone(self.tz)
            frame = features([sensor["value"] for sensor in values.values()], local_time)
            result["localTime"] = local_time.isoformat()
            if not demo and not self.allow_provisional:
                status, message = "ec_bloqueada", "Estimación bloqueada: falta validar la EC frente a SpCond."
            else:
                result["features"] = frame.iloc[0].to_dict()
                try:
                    prediction = float(self.model.predict(frame)[0])
                    if not math.isfinite(prediction):
                        raise ValueError("Predicción no finita")
                except Exception:
                    logging.exception("Falló la inferencia de OD")
                    status, message = "error_inferencia", "No se pudo calcular el OD estimado."
                else:
                    result["od_estimado_mg_l"] = prediction
                    result["zone"], message = zone(prediction)
                    status = "experimental"
        return {**result, "status": status, "message": message}

    def ingest(self, row, lot):
        result = self.estimate(row)
        result.update(id=row.get("captureId") or str(uuid.uuid4()), lotId=lot)
        with self.db:
            self.db.execute(
                "INSERT INTO experimental_od VALUES (?, ?, ?, ?, ?, NULL)",
                (result["id"], lot, MODEL_SHA256, json.dumps(result, allow_nan=False), result["od_estimado_mg_l"]),
            )

    def reference(self, measurement_id, value, lot):
        if not isinstance(measurement_id, str) or not numeric(value, 0, math.inf):
            raise ValueError("Selecciona una medición e introduce OD de referencia válido en mg/L.")
        with self.db:
            row = self.db.execute(
                "SELECT result, prediction FROM experimental_od WHERE id=? AND lot=? AND model_sha256=?",
                (measurement_id, lot, MODEL_SHA256),
            ).fetchone()
            if row is None:
                raise ValueError("Medición de referencia no encontrada en el lote activo.")
            result, prediction = json.loads(row[0]), row[1]
            result["od_referencia_mg_l"] = value
            result["error_absoluto_mg_l"] = abs(prediction - value) if prediction is not None else None
            self.db.execute(
                "UPDATE experimental_od SET result=?, reference=? WHERE id=?",
                (json.dumps(result, allow_nan=False), value, measurement_id),
            )

    def snapshot(self, lot):
        key = (lot, MODEL_SHA256)
        history = [
            json.loads(row[0]) for row in self.db.execute(
                "SELECT result FROM experimental_od WHERE lot=? AND model_sha256=? ORDER BY rowid DESC LIMIT 25",
                key,
            )
        ]
        count, mae = self.db.execute(
            """SELECT COUNT(*), AVG(ABS(prediction - reference))
               FROM experimental_od WHERE lot=? AND model_sha256=?
               AND prediction IS NOT NULL AND reference IS NOT NULL""", key,
        ).fetchone()
        return {
            "modelVersion": MODEL_VERSION,
            "error": self.error,
            "allowProvisionalEc": self.allow_provisional,
            "latest": history[0] if history else None,
            "history": history,
            "metrics": {"n": count, "mae": mae},
        }
