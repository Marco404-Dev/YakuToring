"""Importación conservadora de archivos SWMP NOAA (WQ + MET) a formato YakuToring.
Los CSV originales se descargan manualmente de CDMO. No se inventa presión.
Requiere datos Historical=1 y flags explícitos F_*=0 para cada predictor/OD.
"""
from pathlib import Path
import argparse,json
import pandas as pd,numpy as np
SENSORS=['temperatura_agua_C','pH','conductividad_especifica_mS_cm','presion_atmosferica_hPa']
Y='oxigeno_disuelto_mg_L';T='fecha_hora_UTC'
ALIASES={'Temp':'temperatura_agua_C','pH':'pH','SpCond':'conductividad_especifica_mS_cm','DO_mgl':Y}

def _times(raw,zone):
    if 'DateTimeStamp' not in raw:raise ValueError('Falta DateTimeStamp')
    dt=pd.to_datetime(raw['DateTimeStamp'],errors='coerce')
    if dt.isna().any():raise ValueError('Fechas ilegibles')
    if dt.dt.tz is None:
        dt=dt.dt.tz_localize(zone,ambiguous='NaT',nonexistent='NaT')
    return dt.dt.tz_convert('UTC')

def _clean(raw,columns,zone,station):
    need=['StationCode','Historical','DateTimeStamp']+columns+[f'F_{c}' for c in columns]
    missing=[c for c in need if c not in raw.columns]
    if missing:raise ValueError('Faltan columnas NOAA (no se permite sustituirlas): '+', '.join(missing))
    found=raw['StationCode'].astype(str).str.upper().eq(station.upper())
    if not found.any():raise ValueError('La estación indicada no aparece en el CSV: '+station)
    flags=raw['Historical'].astype(str).str.strip().isin(['1','1.0'])
    for c in columns:
        flags &= raw[f'F_{c}'].astype(str).str.strip().isin(['0','0.0'])
    sub=raw.loc[found & flags].copy()
    sub[T]=_times(sub,zone)
    for c in columns:sub[c]=pd.to_numeric(sub[c],errors='coerce')
    sub=sub.dropna(subset=[T]+columns).sort_values(T)
    sub=sub.drop_duplicates(T,keep='first')
    return sub[[T]+columns].copy(), {'registros_entrada':int(len(raw)),'estacion':station,'validos_antes_de_cruzar':int(len(sub)),'excluidos_por_qaqc_fecha_o_estacion':int(len(raw)-len(sub))}

def importar(wq_path, met_path, zone, station_wq, station_met, output):
    wqr=pd.read_csv(wq_path,low_memory=False,encoding='utf-8-sig')
    mr=pd.read_csv(met_path,low_memory=False,encoding='utf-8-sig')
    wq,aw=_clean(wqr,list(ALIASES),zone,station_wq)
    met,am=_clean(mr,['BP'],zone,station_met)
    # El MET registra la presión de los 15 minutos previos; no se usa MET futuro.
    merged=pd.merge_asof(wq.sort_values(T),met.sort_values(T),on=T,direction='backward',tolerance=pd.Timedelta(minutes=15))
    merged=merged.dropna(subset=['BP']).rename(columns={**ALIASES,'BP':'presion_atmosferica_hPa'})
    if len(merged)<200:raise ValueError('Menos de 200 observaciones pareadas limpias. Revisar estación/huso/QAQC.')
    limits={'temperatura_agua_C':(0,40),'pH':(0,14),'conductividad_especifica_mS_cm':(0,59.118),'presion_atmosferica_hPa':(507,1114),Y:(0,30)}
    for c,(a,b) in limits.items():merged=merged.loc[merged[c].between(a,b)]
    if len(merged)<200:raise ValueError('Menos de 200 observaciones dentro de rangos permitidos')
    merged.insert(0,'estacion_id',station_wq.upper())
    out=Path(output);out.parent.mkdir(parents=True,exist_ok=True)
    merged[['estacion_id',T]+SENSORS+[Y]].to_csv(out,index=False)
    audit={'fuente':'NOAA SWMP CDMO','csv_agua':str(wq_path),'csv_meteorologia':str(met_path),'zona_horaria':zone,
           'agua':aw,'meteorologia':am,'n_uniones_aceptadas':int(len(merged)),'unidad_BP':'mb equivale numericamente hPa',
           'qaqc':'Historical=1; F_*=0; sin DO_pct de entrada',
           'riesgos':['Verificar metadatos del sitio y distancia entre estaciones WQ/MET','La hora local Florida puede cambiar por DST','Los modelos iniciales están calibrados solo en Florida no en Tumbes']}
    out.with_suffix('.auditoria.json').write_text(json.dumps(audit,indent=2,ensure_ascii=False),encoding='utf8')
    return audit

if __name__=='__main__':
    a=argparse.ArgumentParser()
    a.add_argument('--agua',required=True);a.add_argument('--meteo',required=True)
    a.add_argument('--zona',required=True,help='Ejemplo America/New_York')
    a.add_argument('--estacion-agua',required=True);a.add_argument('--estacion-meteo',required=True)
    a.add_argument('--salida',required=True)
    q=a.parse_args()
    print(json.dumps(importar(q.agua,q.meteo,q.zona,q.estacion_agua,q.estacion_meteo,q.salida),indent=2,ensure_ascii=False))
