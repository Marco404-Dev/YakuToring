"""Solo sensores medidos y transformaciones causales. No usar OD anterior como predictor.

Los datos del CSV son de Florida; los parámetros físicos derivados incluyen
la hipótesis de composición salina aproximadamente marina, NO validada en Tumbes.
"""
from __future__ import annotations
from pathlib import Path
import hashlib
import numpy as np
import pandas as pd
from .fisica_benson import saturacion_benson_krause

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / 'datos' / 'data_Apalachicola Bay, FL.csv'
TIME = 'fecha_hora_UTC'
TARGET = 'oxigeno_disuelto_mg_L'
SENSORS = ['temperatura_agua_C','pH','conductividad_especifica_mS_cm','presion_atmosferica_hPa']
LAGS = (1, 3, 6)
BASE = SENSORS + ['hora_local_sin','hora_local_cos','sat_dulce_BK_mg_L',
                  'sat_salobre_proxy_BK_mg_L','salinidad_proxy_ppt']
DIFFS = [f'd_{sensor}_{lag}h' for sensor in SENSORS for lag in LAGS]
DYNAMIC = BASE + DIFFS
REFERENCE = 'sat_salobre_proxy_BK_mg_L'


def features_instant(df: pd.DataFrame, *, require_target=False):
    d = df.copy()
    required = [TIME]+SENSORS+([TARGET] if require_target else [])
    missing = [c for c in required if c not in d]
    if missing: raise ValueError(f'Columnas faltantes: {missing}')
    d[TIME] = pd.to_datetime(d[TIME], utc=True, errors='coerce')
    if d[TIME].isna().any():raise ValueError('Fechas UTC inválidas')
    if d[TIME].duplicated().any():raise ValueError('Fechas repetidas; deduplicar por instrumento antes')
    cols=SENSORS+([TARGET] if require_target else [])
    for c in cols: d[c]=pd.to_numeric(d[c], errors='coerce')
    if not np.isfinite(d[cols].to_numpy(dtype=float)).all():raise ValueError('Sensores/OD nulos o no finitos')
    limits={'temperatura_agua_C':(0,40),'pH':(0,14),
            'conductividad_especifica_mS_cm':(0,59.118),
            'presion_atmosferica_hPa':(507,1114)}
    for c,(lo,hi) in limits.items():
        if not d[c].between(lo,hi).all():raise ValueError(f'{c} fuera de rango físico de la fórmula: [{lo}, {hi}]')
    if require_target and not d[TARGET].between(0,30).all():raise ValueError('OD observado fuera del rango de revisión')
    d=d.sort_values(TIME).reset_index(drop=True)
    ec=d['conductividad_especifica_mS_cm'].to_numpy(float)*1000
    d['salinidad_proxy_ppt'] = 5.572e-4*ec + 2.02e-9*ec**2
    if (d['salinidad_proxy_ppt']>40).any():raise ValueError('La salinidad aproximada supera 40 g/kg')
    d['sat_dulce_BK_mg_L'] = saturacion_benson_krause(
        d['temperatura_agua_C'].to_numpy(), np.zeros(len(d)),d['presion_atmosferica_hPa'].to_numpy())
    d[REFERENCE] = saturacion_benson_krause(
        d['temperatura_agua_C'].to_numpy(),d['conductividad_especifica_mS_cm'].to_numpy(),d['presion_atmosferica_hPa'].to_numpy())
    # Se conserva -05:00 fijo para compatibilidad con el histórico EST; en Tumbes es UTC-05 todo el año.
    h=(d[TIME]-pd.Timedelta(hours=5)).dt.hour+(d[TIME]-pd.Timedelta(hours=5)).dt.minute/60
    d['hora_local_sin']=np.sin(2*np.pi*h/24)
    d['hora_local_cos']=np.cos(2*np.pi*h/24)
    return d


def add_causal_history(d: pd.DataFrame):
    """Crea cambios contra exactamente 1, 3 y 6 h atrás; NaN si no hay coincidencia.

    No exige que la medición sea en :00; soporta muestras cada hora a los :05, :10, etc.
    Nunca interpola ni usa una medición posterior.
    """
    d=d.copy().sort_values(TIME).reset_index(drop=True)
    base=d[[TIME]+SENSORS].copy().set_index(TIME)
    for lag in LAGS:
        earlier = base.copy()
        earlier.index = earlier.index + pd.Timedelta(hours=lag)
        earlier.columns = [f'lag_{c}_{lag}h' for c in SENSORS]
        d = d.join(earlier, on=TIME)
        for c in SENSORS:
            d[f'd_{c}_{lag}h']=d[c]-d[f'lag_{c}_{lag}h']
    d['historial_6h_completo']=np.isfinite(d[DIFFS].to_numpy(dtype=float)).all(axis=1)
    return d


def load_development(path=DATASET):
    original=pd.read_csv(path)
    original[TIME]=pd.to_datetime(original[TIME], utc=True,errors='coerce')
    if original[TIME].isna().any():raise ValueError('Fechas inválidas en el dataset')
    original=original.sort_values(TIME).reset_index(drop=True)
    # El 20% final ya fue consultado en versiones antiguas: no utilizarlo para elegir modelos.
    start_exposed=original.iloc[int(.8*len(original))][TIME]
    dev=original.loc[original[TIME] < start_exposed-pd.Timedelta(hours=24)].copy()
    df=features_instant(dev,require_target=True)
    # Hacemos los folds comparables con el proyecto v5-v9: lecturas a la hora exacta.
    df=df[df[TIME].dt.minute.eq(0)].copy()
    df=add_causal_history(df)
    df=df[df['historial_6h_completo']].copy().reset_index(drop=True)
    audit={'registros_csv':len(original),'registros_desarrollo':len(dev),
           'registros_horarios_historico_6h':len(df),'inicio_test_expuesto':str(start_exposed),
           'sha256':hashlib.sha256(Path(path).read_bytes()).hexdigest(),
           'nota':'El 20% final no se utiliza en la selección ni en el entrenamiento.'}
    return df,audit


def folds(d, cuts=(.40,.56,.72,.88),window=.105):
    n=len(d)
    for k,f in enumerate(cuts,1):
        start=d.iloc[int(f*n)][TIME]
        end=d.iloc[min(n-1,int((f+window)*n))][TIME]
        itr=np.flatnonzero((d[TIME]<start-pd.Timedelta(hours=24)).to_numpy())
        iva=np.flatnonzero(((d[TIME]>=start)&(d[TIME]<end)).to_numpy())
        if len(itr)<300 or len(iva)<80: raise ValueError('Fold demasiado pequeño')
        if not d.iloc[itr][TIME].max()+pd.Timedelta(hours=24)<d.iloc[iva][TIME].min():
            raise AssertionError('Fuga temporal')
        yield k,itr,iva,str(start),str(end)


def metrics(y,p):
    y=np.asarray(y,float);p=np.asarray(p,float)
    if not len(y) or len(y)!=len(p):raise ValueError('Dimensiones incompatibles')
    e=p-y
    if not np.isfinite(e).all():raise ValueError('Error no finito')
    return {'MAE':float(np.abs(e).mean()),'RMSE':float(np.sqrt(np.square(e).mean())),
            'R2':float(1-np.square(e).sum()/np.square(y-y.mean()).sum()) if np.var(y)>0 else None,
            'sesgo_mg_L':float(e.mean()), 'pct_dentro_0_5':float(100*np.mean(np.abs(e)<=.5)),
            'max_abs_mg_L':float(np.abs(e).max()),'n':len(e)}
