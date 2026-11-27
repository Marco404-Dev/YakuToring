"""Descarga opcional de CSV anuales desde el archivo oficial del CDMO/NOAA.

No se usa en entrenamiento sin verificar metadatos y QAQC. Se puede operar con
--solo-enlaces para descargar desde el navegador o Anaconda Prompt.
"""
from pathlib import Path
import argparse, hashlib, json, re, urllib.request
BASE='https://cdmo.baruch.sc.edu/waf/swmp_data_archives/'

def enlace(prefix,year):
    if not re.fullmatch(r'[a-z]{5}(wq|met)',prefix):
        raise ValueError('El código debe tener 5 letras y el sufijo wq o met')
    if not (1995<=year<=2026):raise ValueError('Año no admitido')
    return f'{BASE}{prefix}{year}.csv'

def descargar(prefix,year,folder):
    url=enlace(prefix,year)
    dst=Path(folder)/f'{prefix}{year}.csv';dst.parent.mkdir(parents=True,exist_ok=True)
    req=urllib.request.Request(url,headers={'User-Agent':'YakuToring-academic-validation/1.0'})
    with urllib.request.urlopen(req,timeout=35) as resp:
        if resp.status != 200:raise RuntimeError(f'Respuesta {resp.status}')
        blob=resp.read(30*1024*1024+1)
    if len(blob)>30*1024*1024:raise ValueError('Archivo demasiado grande para este descargador')
    first=blob[:2048].decode('utf-8-sig',errors='replace').lower()
    if '<html' in first or 'stationcode' not in first:
        raise ValueError('La respuesta no parece un CSV SWMP; no se guardó')
    dst.write_bytes(blob)
    return {'url':url,'archivo':str(dst),'bytes':len(blob),'sha256':hashlib.sha256(blob).hexdigest()}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--agua',default='apadbwq',help='Prefijo estación de agua, por ejemplo apadbwq')
    ap.add_argument('--meteorologia',default='apaebmet',help='Prefijo estación meteo, por ejemplo apaebmet')
    ap.add_argument('--anio',type=int,default=2024)
    ap.add_argument('--carpeta',default='datos_externos')
    ap.add_argument('--solo-enlaces',action='store_true')
    q=ap.parse_args()
    if q.agua.endswith('met') or q.meteorologia.endswith('wq'):
        ap.error('Elegir prefijos de agua (wq) y meteorología (met)')
    if q.solo_enlaces:
        for p in [q.agua,q.meteorologia]:print(enlace(p,q.anio))
    else:
        out=[descargar(p,q.anio,q.carpeta) for p in [q.agua,q.meteorologia]]
        print(json.dumps(out,ensure_ascii=False,indent=2))
        print('IMPORTANTE: revisar campos, zona horaria, estaciones, QAQC antes de evaluar.')
if __name__=='__main__':main()
