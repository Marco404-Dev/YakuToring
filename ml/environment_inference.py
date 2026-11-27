"""Domain checks for ad hoc predictions. Entries are not persisted."""
import csv
import io
import json
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import joblib
from experimental_od import features
from environment_registry import DEFAULT, artifact

FIELDS = ("temperature", "ph", "conductivity", "pressure")


@lru_cache(maxsize=3)
def reference(environment=DEFAULT):
    path = artifact(environment,"reference")
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=3)
def isolation_forest(environment=DEFAULT):
    path = artifact(environment,"clustering")
    return joblib.load(path)["isolation"]


@lru_cache(maxsize=3)
def reduced_model(environment=DEFAULT):
    path = artifact(environment,"reduced")
    return joblib.load(path)["E"]


def predict_reduced(item, report, environment):
    indices = (0, 1, 3)
    values = [float(item[FIELDS[index]]) for index in indices]
    for value, key in zip(values, ("temperatura_agua_C","pH","presion_atmosferica_hPa")):
        bounds = report["ranges"].get(key)
        if not np.isfinite(value) or (bounds and not bounds[0] <= value <= bounds[1]):
            return {"status": "Fuera del rango de referencia · abstención"}
    at = datetime.fromisoformat(item["at"])
    if at.utcoffset() is None:
        raise ValueError("Fecha sin zona horaria.")
    frame = features([values[0], values[1], np.nan, values[2]],
                     at.astimezone(ZoneInfo("America/Lima"))).drop(columns="SpCond")
    result = float(reduced_model(environment).predict(frame, thread_count=1)[0])
    return {"status": "Experimental sin EC · representatividad multivariable sin evaluar",
            "models": {"reduced": {"value": result}}}


def predict(models, row, csv_text=None, no_conductivity=False, score_isolation=True, environment=DEFAULT):
    if csv_text is not None:
        reader = csv.DictReader(io.StringIO(csv_text.lstrip("\ufeff")))
        if reader.fieldnames != ["at", *FIELDS]:
            raise ValueError("Encabezado CSV requerido: at,temperature,ph,conductivity,pressure.")
        rows = list(reader)
        if not 1 <= len(rows) <= 100:
            raise ValueError("El CSV debe contener entre 1 y 100 filas.")
    else:
        rows = [row]
    report = reference(environment)
    feature_map = dict(zip(
        ("temperatura_agua_C","pH","conductividad_especifica_mS_cm","presion_atmosferica_hPa"), FIELDS
    ))
    projection = report["projection"]
    output = []
    for item in rows:
        try:
            if not isinstance(item, dict) or None in item:
                raise ValueError("Estructura de fila inválida.")
            if no_conductivity:
                output.append(predict_reduced(item, report, environment))
                continue
            values = [float(item[key]) for key in FIELDS]
            if not np.isfinite(values).all():
                raise ValueError("Entrada no finita.")
            vector = [float(item[feature_map[key]]) for key in report["features"]]
            standardized = (vector - np.array(projection["mean"])) / projection["scale"]
            distances = np.linalg.norm(standardized - np.array(projection["centers"]), axis=1)
            nearest = int(distances.argmin())
            distance = float(distances[nearest])
            isolation = float(isolation_forest(environment).decision_function([standardized])[0]) if score_isolation else None
            cluster = next(group for group in report["clusters"] if group["id"] == nearest)
            labels = report["features"]
            outside = [label for label, value, (low, high) in
                       zip(labels, vector, (report["ranges"][key] for key in report["features"]))
                       if not low <= value <= high]
            far = distance > cluster["distance99"]
            reason = "Variables fuera del intervalo histórico: " + ", ".join(outside) + "." if outside else None
            if far:
                contributions = np.abs(standardized - projection["centers"][nearest])
                drivers = outside or [labels[index] for index in contributions.argsort()[-2:][::-1]]
                reason = "Estimación extrapolada. Variables que más explican la diferencia: " + ", ".join(drivers) + "."
            result = models.predict({
                **item, **dict(zip(FIELDS, values)), "at": item.get("at"),
                "conductivityUnit": item.get("conductivityUnit", "mS/cm"),
            })
            limited = outside or distance > cluster["distance95"]
            status = ("Fuera de distribución · estimación extrapolada" if far else
                      "Representatividad limitada" if limited else "Dentro de la referencia estadística")
            catboost = result["models"].get("catboost")
            if catboost and catboost.get("status") == "invalid_inputs":
                status, reason = "Entrada inválida para CatBoost", catboost["error"]
            output.append({"environment":environment,"status": status, "reason": reason, "distance": distance, "isolation": isolation, **result})
        except (KeyError, TypeError, ValueError, OverflowError):
            output.append({"status": "Información insuficiente · revisa los valores y unidades"})
    return {"predictions": output}
