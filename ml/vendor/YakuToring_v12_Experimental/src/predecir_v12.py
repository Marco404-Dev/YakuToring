"""YakuToring v12: regression + diagnostics, no environmental alarm automation.

Uses ONLY sensor observations and chronological history; NEVER uses the Hach label.
History from distinct laboratory batches is NEVER mixed if lote_id is given.
"""
from __future__ import annotations
import argparse,joblib
import numpy as np,pandas as pd
from .caracteristicas import ROOT,TIME,SENSORS,BASE,DYNAMIC,REFERENCE,features_instant,add_causal_history
BUNDLE=ROOT/'modelos'/'yakutoring_v12.joblib'

def history_by_lot(d):
    if 'lote_id' not in d.columns:
        # Backwards compatibility for a single field node. Lab must provide batch IDs.
        return add_causal_history(d)
    if d.lote_id.isna().any() or (d.lote_id.astype(str).str.strip()=='').any():
        raise ValueError('No se permiten identificadores de lote vacíos')
    frames=[]
    for _,group in d.groupby('lote_id',sort=False):
        frames.append(add_causal_history(group))
    return pd.concat(frames,ignore_index=True).sort_values(TIME).reset_index(drop=True)

def predict_df(raw,bundle=None):
    if bundle is None:bundle=joblib.load(BUNDLE)
    if TARGET_HACH in raw.columns:
        # Explicitly remove the reference before producing features. Never pass as input.
        raw=raw.drop(columns=[TARGET_HACH])
    d=history_by_lot(features_instant(raw,require_target=False))
    ref=d[REFERENCE].to_numpy(float)
    models=bundle['v11_models']
    base=np.maximum(0,models['base'].predict(d[BASE])+ref)
    out=d[[TIME]+SENSORS+(['lote_id'] if 'lote_id' in d.columns else [])].copy()
    out['OD_estimado_mg_L']=base
    out['OD_v5_referencia_mg_L']=base
    out['OD_v10_referencia_mg_L']=base
    out['OD_v11_referencia_mg_L']=base
    out['modo']='v5_respaldo_sin_historial'
    hist=d['historial_6h_completo'].to_numpy(dtype=bool)
    if hist.any():
        idx=np.flatnonzero(hist)
        chunk=d.iloc[idx]
        # Historical model outputs are clipped to physical nonnegativity independently
        p_dynamic=np.maximum(0,models['dynamic'].predict(chunk[DYNAMIC])+ref[idx])
        p_huber=np.maximum(0,models['huber'].predict(chunk[DYNAMIC])+ref[idx])
        p_d7=np.maximum(0,models['depth7'].predict(chunk[DYNAMIC])+ref[idx])
        p_h15=np.maximum(0,bundle['huber_delta15'].predict(chunk[DYNAMIC])+ref[idx])
        v10=.5*base[idx]+.5*p_dynamic
        v11=.5*p_huber+.5*p_d7
        v12=.5*v11+.5*p_h15
        out.loc[idx,'OD_estimado_mg_L']=v12
        out.loc[idx,'OD_v10_referencia_mg_L']=v10
        out.loc[idx,'OD_v11_referencia_mg_L']=v11
        out.loc[idx,'modo']='v12_huber_delta15_temporal_experimental'
    # Feature support checks: min-max plus joint Mahalanobis distance
    outlier=np.zeros(len(d),bool)
    for col in SENSORS:
        lo,hi=bundle['train_ranges'][col]
        outlier|=~d[col].between(lo,hi).to_numpy()
    od=bundle['ood_distance']
    inp=d[SENSORS].to_numpy(float)
    Z=(inp-np.array(od['mean']))/np.array(od['std'])
    diff=Z-np.array(od['mean_z'])
    joint=np.sqrt(np.maximum(0,np.einsum('ni,ij,nj->n',diff,np.array(od['inv_cov']),diff)))
    out['distancia_multivariante']=joint
    out['fuera_de_distribucion_aproximado']=outlier|(joint>od['p99'])
    out['historial_sin_identificador_lote']=('lote_id' not in d.columns)
    out['revision_OD_bajo_ilustrativa']=(np.minimum(out.OD_v10_referencia_mg_L,out.OD_estimado_mg_L)<5)
    out['apto_alerta_automatica']=False
    out['advertencia']=np.where(out.fuera_de_distribucion_aproximado,
        'Condiciones poco representadas en Florida; medir con Hach',
        'Solo estimacion experimental; sin validacion local ni alerta automatica')
    return out

TARGET_HACH='OD_Hach_mg_L'

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--archivo',required=True)
    p.add_argument('--salida',default='predicciones_v12.csv')
    a=p.parse_args()
    out=predict_df(pd.read_csv(a.archivo))
    out.to_csv(a.salida,index=False)
    print('Predicciones guardadas:',a.salida,'filas:',len(out))
    print(out.tail(6).to_string(index=False))
if __name__=='__main__':main()
