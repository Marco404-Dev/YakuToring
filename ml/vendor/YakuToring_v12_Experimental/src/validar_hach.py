"""Validación SIN ajuste: Hach OD comparado con predicciones del modelo ya congelado.

La tabla requiere lote_id y OD_Hach_mg_L; los lotes deben ser independientes
para analizar la generalización a agua nueva. No entrenar sobre este archivo.
"""
from __future__ import annotations
import argparse,json
from pathlib import Path
import pandas as pd,numpy as np
from .predecir import predict_df
from .caracteristicas import TARGET,metrics

def validate(data):
    need={'lote_id','OD_Hach_mg_L','fecha_hora_UTC'}
    if not need.issubset(data.columns):raise ValueError('Faltan campos Hach: '+str(sorted(need-set(data.columns))))
    ref=pd.to_numeric(data['OD_Hach_mg_L'],errors='coerce')
    if not (np.isfinite(ref).all() and ref.between(0,30).all()):raise ValueError('OD Hach inválido')
    if data['lote_id'].isna().any():raise ValueError('Cada lectura requiere lote_id')
    pred=predict_df(data)
    # predicciones ordenadas por fecha: emparejar correctamente contra su OD por fecha
    ref_by_time=data[['fecha_hora_UTC','OD_Hach_mg_L','lote_id']].copy()
    ref_by_time['fecha_hora_UTC']=pd.to_datetime(ref_by_time['fecha_hora_UTC'],utc=True)
    pred=pred.merge(ref_by_time,on='fecha_hora_UTC',validate='one_to_one')
    pred['error_absoluto_mg_L']=np.abs(pred['OD_estimado_mg_L']-pred['OD_Hach_mg_L'])
    report={'global':metrics(pred['OD_Hach_mg_L'],pred['OD_estimado_mg_L']),
            'lotes':int(pred['lote_id'].nunique()),
            'advertencia':'Sin recalibración: OD Hach es referencia de evaluación, no predictor.'}
    return pred,report

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--archivo',required=True);ap.add_argument('--salida',default='validacion_hach_v10.csv')
    a=ap.parse_args();p,m=validate(pd.read_csv(a.archivo));p.to_csv(a.salida,index=False)
    Path(a.salida).with_suffix('.metricas.json').write_text(json.dumps(m,indent=2,ensure_ascii=False),encoding='utf8')
    print(json.dumps(m,indent=2,ensure_ascii=False))
if __name__=='__main__':main()
