"""Prueba con mediciones Hach independientes, sin reentrenar.

Usar lotes NO utilizados en entrenamiento/adaptación. No calcular CV aleatoria por fila.
"""
from __future__ import annotations
import argparse
import numpy as np,pandas as pd
from .caracteristicas import TARGET,TIME,metrics
from .predecir_v11 import predict_df


def evaluate(raw):
    required = ['lote_id','OD_Hach_mg_L',TIME]
    missing=[c for c in required if c not in raw]
    if missing: raise ValueError(f'Faltan columnas Hach: {missing}')
    if raw.lote_id.isna().any():raise ValueError('No pueden faltar IDs de lote')
    y=pd.to_numeric(raw.OD_Hach_mg_L,errors='coerce')
    if not np.isfinite(y.to_numpy(float)).all() or not y.between(0,30).all():
        raise ValueError('OD Hach inválido o fuera de rango de revisión')
    inp=raw.drop(columns=['OD_Hach_mg_L', 'lote_id'], errors='ignore')
    out=predict_df(inp)
    # predict_df ordena por fecha: emparejar por timestamp, nunca por posición del CSV.
    labels=raw[[TIME,'lote_id','OD_Hach_mg_L']].copy()
    labels[TIME]=pd.to_datetime(labels[TIME],utc=True,errors='raise')
    if labels[TIME].duplicated().any(): raise ValueError('Fecha repetida: asignar timestamp único por muestra')
    out=out.merge(labels,on=TIME,how='left',validate='one_to_one')
    if out.OD_Hach_mg_L.isna().any():raise ValueError('Sin emparejamiento Hach')
    out['error_absoluto_mg_L']=(out.OD_estimado_mg_L-out.OD_Hach_mg_L).abs()
    report=metrics(out.OD_Hach_mg_L,out.OD_estimado_mg_L)
    report.update({'lotes_independientes':int(out.lote_id.nunique()),
        'advertencia':'Los lotes deben ser independientes de cualquier ajuste; MAE no representa validación de Tumbes sin muestras locales.'})
    return out,report


def main():
    p=argparse.ArgumentParser();p.add_argument('--archivo',required=True)
    p.add_argument('--salida',default='comparacion_hach_v11.csv')
    a=p.parse_args();d,r=evaluate(pd.read_csv(a.archivo));d.to_csv(a.salida,index=False)
    print('Resultados de evaluación independiente (si los lotes son nuevos):')
    for k,v in r.items(): print(f'  {k}: {v}')
    print('Archivo:',a.salida)
if __name__=='__main__':main()
