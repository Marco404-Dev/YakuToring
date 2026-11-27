"""Predicciones con datos de sensores únicamente; no utiliza OD observado.

Ejemplo: python -m src.predecir --archivo lecturas.csv --salida predicciones.csv
"""
from __future__ import annotations
import argparse,joblib
from pathlib import Path
import numpy as np,pandas as pd
from .caracteristicas import ROOT,TIME,SENSORS,BASE,DYNAMIC,REFERENCE,features_instant,add_causal_history
BUNDLE=ROOT/'modelos'/'yakutoring_v10.joblib'

def predict_df(raw: pd.DataFrame, bundle=None):
    if bundle is None:bundle=joblib.load(BUNDLE)
    d=add_causal_history(features_instant(raw,require_target=False))
    ref=d[REFERENCE].to_numpy(float)
    base=np.maximum(0,bundle['model_base'].predict(d[BASE])+ref)
    out=d[[TIME]+SENSORS].copy()
    out['OD_estimado_mg_L']=base.copy()
    out['modo']='v5_base_sin_historial'
    available=d['historial_6h_completo'].to_numpy(dtype=bool)
    if available.any():
        dyn=np.maximum(0,bundle['model_dynamic'].predict(d.loc[available,DYNAMIC])+ref[available])
        out.loc[available,'OD_estimado_mg_L']=(.5*base[available]+.5*dyn)
        out.loc[available,'modo']='v10_ensamble_temporal'
    ranges=bundle['train_ranges']
    outside=np.zeros(len(d),dtype=bool)
    for s in SENSORS:
        lo,hi=ranges[s];outside |= ~d[s].between(lo,hi).to_numpy()
    out['fuera_del_rango_entrenamiento']=outside
    out['advertencia']=np.where(outside,'No validado: fuera del rango de Florida',
                'Prediccion experimental: requiere validacion Hach')
    return out

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--archivo',required=True);ap.add_argument('--salida',default='predicciones_v10.csv')
    args=ap.parse_args();p=predict_df(pd.read_csv(args.archivo));p.to_csv(args.salida,index=False)
    print(f'Generadas {len(p)} predicciones -> {args.salida}');print(p.tail(4).to_string(index=False))
if __name__=='__main__':main()
