"""Modelos habilitados en el proceso de inferencia."""
import os

AVAILABLE = {"catboost", "mlp", "weighted", "stacking", "reduced", "noaa", "legacy"}


def enabled_models():
    enabled = set(os.getenv("YAKUTORING_ACTIVE_MODELS", "catboost").split(","))
    enabled = {item.strip().lower() for item in enabled if item.strip()}
    if enabled - AVAILABLE:
        raise ValueError("Modelos desconocidos en YAKUTORING_ACTIVE_MODELS.")
    if enabled & {"weighted", "stacking"} and not {"catboost", "mlp"} <= enabled:
        raise ValueError("Los híbridos requieren CatBoost y MLP habilitados.")
    return enabled
