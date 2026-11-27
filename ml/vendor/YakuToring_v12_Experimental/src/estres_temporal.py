"""Tres cortes cronológicos adicionales. NO es test nuevo: misma estación y periodo de desarrollo."""
from __future__ import annotations
import numpy as np,pandas as pd
from .caracteristicas import ROOT,TIME,TARGET,REFERENCE,load_development,metrics
from .entrenar_y_comparar import fit_pair,predict_pair,RESULTS

def main():
 d,_=load_development();rows=[]
 for fold,cut in enumerate([.32,.52,.76],1):
  start=d.iloc[int(cut*len(d))][TIME]
  stop=d.iloc[min(len(d)-1,int((cut+.10)*len(d)))][TIME]
  train=d[d[TIME]<start-pd.Timedelta(hours=24)];va=d[(d[TIME]>=start)&(d[TIME]<stop)]
  a,b=fit_pair(train)
  for name,p in predict_pair(va,a,b).items():
   rows.append({'modelo':name,'fold':fold,'inicio':str(start),**metrics(va[TARGET],p)})
 r=pd.DataFrame(rows);r.to_csv(RESULTS/'estres_v10.csv',index=False)
 print(r.groupby('modelo').agg(MAE=('MAE','mean'),SD=('MAE','std'),N=('n','sum')).round(4))
if __name__=='__main__': main()
