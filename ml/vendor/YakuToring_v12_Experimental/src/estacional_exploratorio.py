"""Reproduce el antecedente v6 de menor MAE histórico. SOLO desarrollo Florida.
No se recomienda para despliegue en Tumbes sin validación externa.
"""
from __future__ import annotations
import numpy as np, pandas as pd
from catboost import CatBoostRegressor
from .caracteristicas import ROOT,TIME,TARGET,BASE,REFERENCE,load_development,folds,metrics

def main():
 d,_=load_development()
 doy=d[TIME].dt.dayofyear+d[TIME].dt.hour/24
 d['season_sin']=np.sin(2*np.pi*doy/365.25)
 d['season_cos']=np.cos(2*np.pi*doy/365.25)
 feats=BASE+['season_sin','season_cos'];rows=[]
 for fold,i,j,_,_ in folds(d):
  tr,va=d.iloc[i],d.iloc[j]
  m=CatBoostRegressor(iterations=500,depth=6,learning_rate=.035,l2_leaf_reg=8,loss_function='RMSE',random_seed=42,verbose=False,thread_count=4,allow_writing_files=False)
  m.fit(tr[feats],tr[TARGET]-tr[REFERENCE]);p=np.maximum(0,m.predict(va[feats])+va[REFERENCE]);rows.append({'fold':fold,**metrics(va[TARGET],p)})
 r=pd.DataFrame(rows);r.to_csv(ROOT/'resultados'/'estacional_exploratorio.csv',index=False)
 print(r[['fold','MAE']].to_string(index=False));print('Media',r.MAE.mean(),'SD',r.MAE.std())
if __name__=='__main__':main()
