"""Fit a versioned Florida reference. Input dates at or after 2024 are held out."""
import argparse
import hashlib
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.cluster import KMeans, MiniBatchKMeans
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
    return train_reference(source, output, "manglar", "florida-v1")


@threadpool_limits.wrap(limits=2)
def train_reference(source, output, environment, version, features=None,
                    holdout_from="2024-01-01", algorithm="minibatch", max_clusters=10,
                    min_independent=100):
    features = features or FEATURES
    if (len(set(features)) != len(features) or len(features) < 2 or
            any(key not in FEATURES for key in features)):
        raise ValueError("Selecciona al menos dos variables de sensores compatibles. El OD se usa solo para caracterizar.")
    if not 2 <= max_clusters <= 20 or min_independent < 2:
        raise ValueError("Configuración inválida de clusters o muestras independientes.")
    if source.suffix.lower() == ".parquet":
        frame = pd.read_parquet(source).rename(columns=NOAA_COLUMNS)
    else:
        frame = pd.read_csv(source).rename(columns=NOAA_COLUMNS)
    if TARGET not in frame:
        frame[TARGET] = float("nan")
    dates = pd.to_datetime(frame[DATE], utc=True, errors="coerce")
    numeric = frame[[*features, TARGET]].apply(pd.to_numeric, errors="coerce")
    valid = pd.Series(True,index=frame.index)
    bounds = dict(zip(FEATURES,[(0,40),(0,14),(0,100),(300,1100)]))
    for key in features:
        valid &= numeric[key].between(*bounds[key])
    if "synthetic" in frame:
        valid &= frame["synthetic"].astype(str).str.lower().isin(["false","0"])
    cutoff = pd.to_datetime(holdout_from,utc=True)
    history = numeric.loc[valid & dates.lt(cutoff)].copy()
    if environment == "laboratorio":
        if "sample_id" not in frame:
            raise ValueError("Laboratorio requiere sample_id de muestras físicas independientes.")
        ids = frame.loc[history.index,"sample_id"].astype("string").str.strip()
        groups = ids[ids.notna() & ids.ne("")]
        if groups.nunique() < min_independent:
            raise ValueError("Muestras físicas independientes insuficientes; usa análisis exploratorio.")
        if set(groups) & set(frame.loc[dates.ge(cutoff),"sample_id"].astype("string").str.strip().dropna()):
            raise ValueError("Una muestra física cruza la división temporal.")
        history = history.loc[groups.index].groupby(groups).median()
        train_dates = dates.loc[groups.index]
    else:
        train_dates = dates.loc[history.index]
    if len(history) < (min_independent if environment=="laboratorio" else 500):
        raise ValueError("Registros independientes de referencia insuficientes.")
    scaler = StandardScaler().fit(history[features])
    x = scaler.transform(history[features])
    pca = PCA(n_components=2).fit(x)
    selection = scaler.transform(history.sample(min(30000, len(history)), random_state=SEED)[features])
    trials = []
    candidates = {}
    estimator = KMeans if algorithm == "kmeans" else MiniBatchKMeans
    for k in range(2, min(max_clusters,len(history)-1)+1):
        model = estimator(n_clusters=k, random_state=SEED, n_init=5).fit(x)
        alternate = estimator(n_clusters=k, random_state=43, n_init=5).fit(x)
        labels = model.predict(x)
        if len(set(labels)) != k:
            continue
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
            "means": group[features].mean().tolist(),
            "quantiles": {key:group[key].quantile([.05,.25,.5,.75,.95]).tolist() for key in features},
            "oxygenCount": len(oxygen), "oxygenMean": oxygen.mean() if len(oxygen) else None,
            "oxygenMedian": oxygen.median() if len(oxygen) else None,
            "oxygenSD": oxygen.std() if len(oxygen) > 1 else None,
            "oxygenQuantiles": oxygen.quantile([.05, .25, .75, .95]).tolist() if len(oxygen) else [],
            "distance95": group.distance.quantile(.95),
            "distance99": group.distance.quantile(.99),
        })
    plot = history.sample(min(1400, len(history)), random_state=SEED)
    coordinates = pca.transform(scaler.transform(plot[features]))
    with source.open("rb") as handle:
        checksum = hashlib.file_digest(handle, "sha256").hexdigest()
    report = {
        "version": version, "environment": environment, "algorithm": algorithm, "source": source.name, "sha256": checksum,
        "trainedAt": pd.Timestamp.now(tz="UTC").isoformat(), "holdoutFrom": cutoff.isoformat(),
        "records": len(history), "inputRecords": len(frame),
        "heldOut": int(dates.ge(cutoff).sum()),
        "first": train_dates.min().isoformat(),
        "last": train_dates.max().isoformat(),
        "features": features, "chosen": chosen, "trials": trials, "clusters": summary,
        "ranges": {key: history[key].agg(["min", "max"]).tolist() for key in features},
        "loadings": pca.components_.tolist(), "variance": pca.explained_variance_ratio_.tolist(),
        "correlation": history[features].corr().fillna(0).values.tolist(),
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
                 "features": features}, output / f"{version}.joblib", compress=3)
    (output / f"{version}.json").write_text(serialized, encoding="utf-8")
    print(f"{len(history)} registros, k={chosen}, {report['heldOut']} filas reservadas")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "environment_models")
    parser.add_argument("--environment", choices=["manglar","humedal","laboratorio"], default="manglar")
    parser.add_argument("--version", default="florida-v1")
    parser.add_argument("--features", nargs="+", choices=FEATURES)
    parser.add_argument("--holdout-from", default="2024-01-01")
    parser.add_argument("--algorithm", choices=["minibatch","kmeans"], default="minibatch")
    parser.add_argument("--max-clusters", type=int, default=10)
    parser.add_argument("--min-independent", type=int, default=100)
    args = parser.parse_args()
    if not __import__("re").fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,60}", args.version):
        parser.error("Versión inválida.")
    train_reference(args.source,args.output,args.environment,args.version,args.features,args.holdout_from,
                    args.algorithm,args.max_clusters,args.min_independent)
