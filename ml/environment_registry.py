"""Trusted registry shared with the API and browser."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REGISTRY = json.loads((ROOT.parent / "config/environments.json").read_text(encoding="utf-8"))
DEFAULT = REGISTRY["default"]


def artifact(environment, name):
    entry = REGISTRY["environments"].get(environment)
    value = (entry.get("artifacts") or {}).get(name) if entry else None
    if not value:
        raise ValueError("Dataset especializado pendiente de incorporación.")
    path = (ROOT / value).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError("Ruta de artefacto inválida.")
    return path
