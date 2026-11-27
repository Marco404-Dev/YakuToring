"""Independent Hach evaluation by batch. Hach is NEVER an input.

Batch-separated history prevents artificial lags from another container of water.
"""
from __future__ import annotations
import argparse,json
import numpy as np,pandas as pd
from .caracteristicas import TIME,metrics
from .predecir_v12 import predict_df

def evaluate(raw,bundle=None):
    need={'lote_id',TIME,'OD_Hach_mg_L'}
    if not need.issubset(raw.columns):raise ValueError(f'Faltan columnas: {need-set(raw.columns)}')
    if raw.lote_id.isna().any():raise ValueError('Faltan IDs de lote')
    y=pd.to_numeric(raw.OD_Hach_mg_L,errors='coerce')
    if not np.isfinite(y.to_numpy(dtype=float)).all() or not y.between(0,30).all():
        raise ValueError('OD de Hach no válido')
    pred=predict_df(raw.drop(columns=['OD_Hach_mg_L']),bundle=bundle)
    lab=raw[[TIME,'lote_id','OD_Hach_mg_L']].copy()
    lab[TIME]=pd.to_datetime(lab[TIME],utc=True)
    if lab[TIME].duplicated().any():raise ValueError('Timestamps Hach duplicados')
    out=pred.merge(lab,on=[TIME,'lote_id'],how='left',validate='one_to_one')
    if out.OD_Hach_mg_L.isna().any():raise ValueError('Predicciones sin par Hach')
    out['error_absoluto_mg_L']=(out.OD_estimado_mg_L-out.OD_Hach_mg_L).abs()
    report=metrics(out.OD_Hach_mg_L,out.OD_estimado_mg_L)
    # Compare models on EXACTLY the same rows with complete 6h history.
    # This avoids choosing v12 using rows that only used v5 fallback.
    full=out[out.modo=='v12_huber_delta15_temporal_experimental']
    fair={}
    if len(full):
        for model,col in [('v5','OD_v5_referencia_mg_L'),('v10','OD_v10_referencia_mg_L'),
                          ('v11','OD_v11_referencia_mg_L'),('v12','OD_estimado_mg_L')]:
            fair[model]=metrics(full.OD_Hach_mg_L,full[col])
    report['comparacion_mismas_filas_con_6h']=fair
    report['lotes_con_6h']=int(full.lote_id.nunique()) if len(full) else 0
    report['retroceso_recomendado_preliminar']= (
        'Evaluar v10/v11; v12 empeoro MAE en estas filas' if len(full) and
        fair['v12']['MAE']>min(fair['v10']['MAE'],fair['v11']['MAE']) else
        'No hay historial de 6h: solo se evaluo respaldo v5' if not len(full) else
        'v12 no empeoro MAE frente a v10/v11 en estas filas; evaluar por lotes nuevos')
    report.update({'lotes_independientes':int(out.lote_id.nunique()),
        'filas_modo_v5':int((out.modo=='v5_respaldo_sin_historial').sum()),
        'filas_modo_v12':int((out.modo=='v12_huber_delta15_temporal_experimental').sum()),
        'advertencia':'Validación solo si todos estos lotes fueron nuevos y no usados en adaptación; umbral de alarma no aprobado.'})
    return out,report

def main():
    p=argparse.ArgumentParser();p.add_argument('--archivo',required=True);p.add_argument('--salida',default='comparacion_hach_v12.csv')
    a=p.parse_args();out,rep=evaluate(pd.read_csv(a.archivo));out.to_csv(a.salida,index=False)
    print(json.dumps(rep,indent=2,ensure_ascii=False))
if __name__=='__main__':main()
