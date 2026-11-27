"""Fit a versioned Florida reference. Input dates at or after 2024 are held out."""
import argparse
import hashlib
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.cluster import MiniBatchKMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (
    adjusted_rand_score, calinski_harabasz_score, davies_bouldin_score,
    silhouette_score,
)
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

ROOT = Path(__file__).resolve().parent
FEATURES = ["temperatura_agua_C", "pH", "conductividad_especifica_mS_cm",
            "presion_atmosferica_hPa"]
TARGET = "oxigeno_disuelto_mg_L"
DATE = "fecha_hora_UTC"
SEED = 42
NOAA_COLUMNS = dict(zip(["Temp", "pH", "SpCond", "BP_hPa", "DO_mgl", "DateTimeStamp"],
                        [*FEATURES, TARGET, DATE]))


@threadpool_limits.wrap(limits=2)
def train(source, output):
    if source.suffix.lower() == ".parquet":
        frame = pd.read_parquet(source, columns=list(NOAA_COLUMNS)).rename(columns=NOAA_COLUMNS)
    else:
        frame = pd.read_csv(source, usecols=[DATE, *FEATURES, TARGET])
    dates = pd.to_datetime(frame[DATE], utc=True, errors="coerce")
    numeric = frame[[*FEATURES, TARGET]].apply(pd.to_numeric, errors="coerce")
    valid = (numeric[FEATURES[0]].between(0, 40)
             & numeric["pH"].between(0, 14)
             & numeric[FEATURES[2]].between(0, 100)
             & numeric[FEATURES[3]].between(300, 1100))
    cutoff = pd.Timestamp("2024-01-01", tz="UTC")
    history = numeric.loc[valid & dates.lt(cutoff)].copy()
    if len(history) < 500:
        raise ValueError("Se requieren al menos 500 registros de referencia válidos.")
    scaler = StandardScaler().fit(history[FEATURES])
    x = scaler.transform(history[FEATURES])
    pca = PCA(n_components=2).fit(x)
    selection = scaler.transform(history.sample(min(30000, len(history)), random_state=SEED)[FEATURES])
    trials = []
    candidates = {}
    for k in range(2, 11):
        model = MiniBatchKMeans(n_clusters=k, random_state=SEED, n_init=5).fit(x)
        alternate = MiniBatchKMeans(n_clusters=k, random_state=43, n_init=5).fit(x)
        labels = model.predict(x)
        mixture = GaussianMixture(n_components=k, random_state=SEED).fit(selection)
        trials.append({
            "k": k, "silhouette": silhouette_score(x, labels, sample_size=2000, random_state=SEED),
            "daviesBouldin": davies_bouldin_score(x, labels),
            "calinskiHarabasz": calinski_harabasz_score(x, labels),
            "inertia": float((model.transform(x).min(axis=1) ** 2).sum()),
            "stability": adjusted_rand_score(labels, alternate.predict(x)),
            "bic": mixture.bic(selection), "aic": mixture.aic(selection),
        })
        candidates[k] = model
    chosen = max(trials, key=lambda trial: trial["silhouette"])["k"]
    model = candidates[chosen]
    isolation = IsolationForest(random_state=SEED).fit(x)
    history["cluster"] = model.predict(x)
    history["distance"] = model.transform(x).min(axis=1)
    summary = []
    for label, group in history.groupby("cluster"):
        oxygen = group[TARGET].where(group[TARGET].between(0, 30)).dropna()
        summary.append({
            "id": int(label), "n": len(group), "share": len(group) / len(history),
            "means": group[FEATURES].mean().tolist(),
            "oxygenCount": len(oxygen), "oxygenMean": oxygen.mean() if len(oxygen) else None,
            "oxygenMedian": oxygen.median() if len(oxygen) else None,
            "oxygenSD": oxygen.std() if len(oxygen) > 1 else None,
            "oxygenQuantiles": oxygen.quantile([.05, .25, .75, .95]).tolist() if len(oxygen) else [],
            "distance95": group.distance.quantile(.95),
            "distance99": group.distance.quantile(.99),
        })
    plot = history.sample(min(1400, len(history)), random_state=SEED)
    coordinates = pca.transform(scaler.transform(plot[FEATURES]))
    with source.open("rb") as handle:
        checksum = hashlib.file_digest(handle, "sha256").hexdigest()
    report = {
        "version": "florida-v1", "source": source.name, "sha256": checksum,
        "records": len(history), "inputRecords": len(frame),
        "heldOut": int(dates.ge(cutoff).sum()),
        "first": dates.loc[history.index].min().isoformat(),
        "last": dates.loc[history.index].max().isoformat(),
        "features": FEATURES, "chosen": chosen, "trials": trials, "clusters": summary,
        "ranges": {key: history[key].agg(["min", "max"]).tolist() for key in FEATURES},
        "loadings": pca.components_.tolist(), "variance": pca.explained_variance_ratio_.tolist(),
        "correlation": history[FEATURES].corr().values.tolist(),
        "centroids": pca.transform(model.cluster_centers_).tolist(),
        "points": [[round(float(a), 5), round(float(b), 5), int(label)]
                   for (a, b), label in zip(coordinates, plot.cluster)],
        "projection": {
            "mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist(),
            "pcaMean": pca.mean_.tolist(), "centers": model.cluster_centers_.tolist(),
        },
    }
    serialized = json.dumps(report, allow_nan=False, default=lambda value: value.item())
    output.mkdir(parents=True, exist_ok=True)
    joblib.dump({"scaler": scaler, "pca": pca, "cluster": model, "isolation": isolation,
                 "features": FEATURES}, output / "florida-v1.joblib", compress=3)
    (output / "florida-v1.json").write_text(serialized, encoding="utf-8")
    print(f"{len(history)} registros, k={chosen}, {report['heldOut']} filas reservadas")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "environment_models")
    args = parser.parse_args()
    train(args.source, args.output)
