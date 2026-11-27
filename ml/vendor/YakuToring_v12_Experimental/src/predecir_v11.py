"""Inferencia YakuToring v11. NO usa el OD del Hach como entrada.

python -m src.predecir_v11 --archivo plantilla_lecturas.csv --salida predicciones_v11.csv
"""
from __future__ import annotations
import argparse, joblib
import numpy as np, pandas as pd
from .caracteristicas import ROOT,TIME,SENSORS,BASE,DYNAMIC,REFERENCE,features_instant,add_causal_history

BUNDLE = ROOT/'modelos'/'yakutoring_v11.joblib'


def predict_df(raw, bundle=None):
    if bundle is None:bundle=joblib.load(BUNDLE)
    d=add_causal_history(features_instant(raw,require_target=False))
    ref=d[REFERENCE].to_numpy(float)
    m=bundle['models']
    base=np.maximum(0,m['base'].predict(d[BASE])+ref)
    out=d[[TIME]+SENSORS].copy()
    out['OD_estimado_mg_L'] = base.copy()
    out['OD_v10_referencia_mg_L'] = base.copy()
    out['modo'] = 'v5_instantaneo_sin_historial'
    hist=d['historial_6h_completo'].to_numpy(bool)
    if hist.any():
        idx=np.flatnonzero(hist)
        va=d.iloc[idx]
        dyn=np.maximum(0,m['dynamic'].predict(va[DYNAMIC])+ref[idx])
        hub=np.maximum(0,m['huber'].predict(va[DYNAMIC])+ref[idx])
        d7=np.maximum(0,m['depth7'].predict(va[DYNAMIC])+ref[idx])
        out.loc[idx,'OD_estimado_mg_L'] = .5*hub+.5*d7
        out.loc[idx,'OD_v10_referencia_mg_L'] = .5*base[idx]+.5*dyn
        out.loc[idx,'modo'] = 'v11_huber_depth7_experimental'
    outside=np.zeros(len(d),bool)
    for col in SENSORS:
        lo,hi=bundle['train_ranges'][col]
        outside |= ~d[col].between(lo,hi).to_numpy(bool)
    out['fuera_rango_historico'] = outside
    out['apto_alerta_automatica'] = False
    out['advertencia'] = np.where(outside,
        'Fuera de rango Florida: comprobar con referencia',
        'Prediccion experimental sin validacion Hach / Tumbes')
    return out


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--archivo', required=True)
    p.add_argument('--salida',default='predicciones_v11.csv')
    args=p.parse_args()
    pred=predict_df(pd.read_csv(args.archivo))
    pred.to_csv(args.salida,index=False)
    print(f'{len(pred)} predicciones guardadas en {args.salida}')
    print(pred.tail(5).to_string(index=False))
if __name__=='__main__':main()
