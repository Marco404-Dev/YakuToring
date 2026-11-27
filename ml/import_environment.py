"""Normalize a CSV or Parquet dataset in bounded batches without modifying its source."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from train_environment import DATE, FEATURES, NOAA_COLUMNS, TARGET

MAPPING = {
    **NOAA_COLUMNS, "at": DATE, "temperature": FEATURES[0], "ph": "pH",
    "conductivity": FEATURES[2], "conductivity_us_cm": FEATURES[2],
    "pressure": FEATURES[3], "pressure_pa": FEATURES[3], "oxygen": TARGET,
}
FIELDS = [*FEATURES,TARGET]


def ingest(source, destination, environment, provenance, synthetic, mapping=None):
    if source.resolve() == destination.resolve() or destination.exists():
        raise ValueError("Selecciona una salida Parquet nueva.")
    schema = pa.schema([(DATE,pa.timestamp("ns",tz="UTC")),("sample_id",pa.string()),
                        ("synthetic",pa.bool_()), *((key,pa.float64()) for key in FIELDS)])
    counts = {key:{"valid":0,"missing":0,"minimum":None,"maximum":None,"sum":0.0} for key in FIELDS}
    rows = 0
    first = last = None
    batches = (pd.read_csv(source,chunksize=25000) if source.suffix.lower()==".csv" else
               (batch.to_pandas() for batch in pq.ParquetFile(source).iter_batches(batch_size=25000)))
    destination.parent.mkdir(parents=True,exist_ok=True)
    temporary = destination.with_suffix(".partial")
    if temporary.exists():
        raise ValueError("Ya existe una importación parcial con ese nombre.")
    try:
        with pq.ParquetWriter(temporary,schema) as writer:
            for frame in batches:
                raw_columns = set(frame.columns)
                frame = frame.rename(columns={**MAPPING,**(mapping or {})})
                if not frame.columns.is_unique or DATE not in frame or len(set(FEATURES)&set(frame.columns))<2:
                    raise ValueError("Se requiere fecha y dos variables de sensores, sin columnas ambiguas.")
                if environment=="laboratorio" and not synthetic and "sample_id" not in frame:
                    raise ValueError("El laboratorio requiere sample_id de muestra física.")
                frame[DATE] = pd.to_datetime(frame[DATE],utc=True,errors="coerce",format="mixed")
                if frame[DATE].notna().any():
                    a,b=frame[DATE].min(),frame[DATE].max()
                    first = a if first is None else min(first,a)
                    last = b if last is None else max(last,b)
                frame["sample_id"] = frame.get("sample_id",pd.Series(None,index=frame.index)).astype("string")
                frame["synthetic"] = True if synthetic else (
                    ~frame["synthetic"].astype(str).str.lower().isin(["false","0"])
                    if "synthetic" in frame else False)
                for key in FIELDS:
                    series = pd.to_numeric(frame.get(key,pd.Series(np.nan,index=frame.index)),errors="coerce").replace([np.inf,-np.inf],np.nan)
                    if key==FEATURES[2] and "conductivity_us_cm" in raw_columns: series /= 1000
                    if key==FEATURES[3] and "pressure_pa" in raw_columns: series /= 100
                    frame[key]=series
                    stats=counts[key]
                    stats["valid"]+=int(series.count())
                    stats["missing"]+=int(series.isna().sum())
                    if series.count():
                        minimum,maximum=float(series.min()),float(series.max())
                        stats["minimum"]=minimum if stats["minimum"] is None else min(minimum,stats["minimum"])
                        stats["maximum"]=maximum if stats["maximum"] is None else max(maximum,stats["maximum"])
                        stats["sum"]+=float(series.sum())
                writer.write_table(pa.Table.from_pandas(frame[list(schema.names)],schema=schema,preserve_index=False))
                rows+=len(frame)
        if not rows:
            raise ValueError("El dataset está vacío.")
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    with source.open("rb") as handle:
        sha=hashlib.file_digest(handle,"sha256").hexdigest()
    for stats in counts.values():
        total=stats.pop("sum")
        stats["mean"]=total/stats["valid"] if stats["valid"] else None
    destination.with_suffix(".json").write_text(json.dumps({
        "environment":environment,"provenance":provenance,"source":source.name,"sha256":sha,
        "syntheticOverride":synthetic,"rows":rows,"first":str(first),"last":str(last),"summary":counts,
    },ensure_ascii=False,indent=2),encoding="utf-8")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--environment",choices=["manglar","humedal","laboratorio"],required=True)
    parser.add_argument("--provenance",required=True)
    parser.add_argument("--synthetic",action="store_true")
    parser.add_argument("--mapping",type=Path,help="JSON con equivalencias de columnas en unidades canónicas")
    args=parser.parse_args()
    if args.source.suffix.lower() not in {".csv",".parquet"} or args.output.suffix.lower()!=".parquet":
        parser.error("Se acepta CSV o Parquet; la salida debe ser Parquet.")
    mapping=json.loads(args.mapping.read_text(encoding="utf-8")) if args.mapping else None
    ingest(args.source,args.output,args.environment,args.provenance,args.synthetic,mapping)
