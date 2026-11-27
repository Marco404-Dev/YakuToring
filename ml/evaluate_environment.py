"""Compare the frozen CatBoost and new experimental candidates on NOAA 2024."""
import argparse
import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from catboost import CatBoostRegressor
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error
from threadpoolctl import threadpool_limits

from experimental_od import FEATURES
from comparison import Models
from train_environment import ROOT


def metrics(observed, predicted):
    return {
        "n": len(observed), "mae": mean_absolute_error(observed, predicted),
        "rmse": root_mean_squared_error(observed, predicted),
        "r2": r2_score(observed, predicted) if observed.nunique() > 1 else None,
        "bias": float(np.mean(predicted - observed)),
    }


@threadpool_limits.wrap(limits=2)
def evaluate(train_file, test_file, output, limit):
    columns = ["DateTimeStamp", *FEATURES, "DO_mgl"]
    train = pd.read_parquet(train_file, columns=columns).dropna()
    test = pd.read_parquet(test_file, columns=columns).dropna()
    test = test.loc[test.DateTimeStamp.dt.year.eq(2024)]
    if train.empty or test.empty or train.DateTimeStamp.dt.year.ge(2024).any():
        raise ValueError("Se requieren entrenamiento anterior a 2024 y evaluación exclusiva 2024.")
    train = train.sample(min(limit, len(train)), random_state=42).reset_index(drop=True)
    test = test.reset_index(drop=True)
    def checksum(source):
        with source.open("rb") as handle:
            return hashlib.file_digest(handle, "sha256").hexdigest()

    training_sha = checksum(train_file)
    reference_report = json.loads((output / "florida-v1.json").read_text(encoding="utf-8"))
    if reference_report["sha256"] != training_sha:
        raise ValueError("El agrupamiento debe proceder de la misma partición de entrenamiento.")
    reference = joblib.load(output / "florida-v1.joblib")
    cluster_columns = FEATURES[:4]
    def cluster(frame):
        values = frame[cluster_columns].set_axis(reference["features"], axis=1)
        return reference["cluster"].predict(reference["scaler"].transform(values))

    train["cluster"] = cluster(train)
    test["cluster"] = cluster(test)
    def fit(data, feature_names):
        return CatBoostRegressor(iterations=250, depth=6, random_seed=42, thread_count=2,
                                 verbose=False, allow_writing_files=False).fit(
            data[feature_names], data.DO_mgl,
        )

    frozen = Models()
    if frozen.errors:
        raise ValueError(f"Faltan modelos históricos: {frozen.errors}")
    with_cluster = [*FEATURES, "cluster"]
    no_ec = [key for key in FEATURES if key != "SpCond"]
    augmented = fit(train, with_cluster)
    reduced = fit(train, no_ec)
    control = fit(train, FEATURES)
    specialized = {}
    predictions_by_cluster = np.empty(len(test))
    for key, group in train.groupby("cluster"):
        specialized[int(key)] = fit(group, FEATURES)
        mask = test.cluster.eq(key)
        if mask.any():
            predictions_by_cluster[mask] = specialized[int(key)].predict(test.loc[mask, FEATURES])
    if not test.cluster.isin(specialized).all():
        raise ValueError("Faltan muestras de entrenamiento para un cluster presente en 2024.")
    baseline = float(train.DO_mgl.median())
    import torch
    mlp, mlp_scaler = frozen.loaded["mlp"]
    test_features = test[FEATURES]
    catboost = frozen.loaded["catboost"].predict(test_features, thread_count=2)
    with torch.inference_mode():
        scaled = mlp_scaler.transform(test_features.to_numpy(dtype="float32")).astype("float32")
        neural = np.concatenate([mlp(torch.from_numpy(batch)).numpy()
                                 for batch in np.array_split(scaled, 20)])
    base = np.column_stack([catboost, neural])
    predictions = {
        "A": catboost,
        "A_control": control.predict(test_features),
        "B": augmented.predict(test[with_cluster]),
        "C": predictions_by_cluster,
        "E": reduced.predict(test[no_ec]),
        "F": np.full(len(test), baseline),
        "MLP": neural,
        "weighted": base @ frozen.loaded["weighted"],
        "stacking": frozen.loaded["stacking"].predict(base),
    }
    bins = pd.cut(test.DO_mgl, [-np.inf, 4, 7, 9, 10, np.inf], right=False)
    results = {}
    for key, values in predictions.items():
        results[key] = {
            **metrics(test.DO_mgl, values),
            "byRange": {str(group): metrics(test.DO_mgl[mask], values[mask])
                        for group in bins.cat.categories if (mask := bins.eq(group)).any()},
            "byCluster": {str(group): metrics(test.DO_mgl[mask], values[mask])
                          for group in sorted(test.cluster.unique()) if (mask := test.cluster.eq(group)).any()},
        }
    report = {
        "version": "noaa-experiments-v1", "domain": "NOAA Florida 2024",
        "train": len(train), "test": len(test), "results": results,
        "trainingSource": train_file.name, "trainingSha256": training_sha,
        "evaluationSource": test_file.name, "evaluationSha256": checksum(test_file),
        "unavailable": {"D": "Requiere muestras locales pareadas e independientes para ajuste y evaluación."},
    }
    joblib.dump({"A_control": control, "B": augmented, "C": specialized, "E": reduced, "F": baseline},
                output / "noaa-experiments-v1.joblib", compress=3)
    (output / "noaa-experiments-v1.json").write_text(
        json.dumps(report, allow_nan=False, default=lambda value: value.item()), encoding="utf-8",
    )
    print(json.dumps({key: result["mae"] for key, result in results.items()}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("train", type=Path)
    parser.add_argument("test", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "environment_models")
    parser.add_argument("--train-limit", type=int, default=100_000)
    args = parser.parse_args()
    evaluate(args.train, args.test, args.output, args.train_limit)
