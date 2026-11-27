"""Regenerates experimental CatBoost v12 and historical CV comparison.

DO NOT treat the four already examined Florida windows as an independent test.
Run python -m src.entrenar_v11 first if v11 predictions need regeneration.
"""
from __future__ import annotations
import json,joblib
from pathlib import Path
import numpy as np,pandas as pd
from catboost import CatBoostRegressor
from sklearn.covariance import LedoitWolf
from .caracteristicas import ROOT,TIME,TARGET,REFERENCE,SENSORS,DYNAMIC,load_development,folds,metrics
from .entrenar_y_comparar import PARAM

NEW_PARAMS={**PARAM,'loss_function':'Huber:delta=1.5'}

def new_model():return CatBoostRegressor(**NEW_PARAMS)

def recalc_cv(d):
    parts=[]
    for f,itr,iva,_,_ in folds(d):
        tr,va=d.iloc[itr],d.iloc[iva]
        model=new_model();model.fit(tr[DYNAMIC],tr[TARGET]-tr[REFERENCE])
        yp=np.maximum(0,model.predict(va[DYNAMIC])+va[REFERENCE].to_numpy(float))
        parts.append(pd.DataFrame({'fold':f,'fecha_UTC':va[TIME].astype(str),'OD_real':va[TARGET].to_numpy(float),'pred_huber_delta15':yp}))
        print(f'Fold {f}: modelo Huber delta 1.5 evaluado',flush=True)
    return pd.concat(parts,ignore_index=True)

def make_comparison(d):
    cv=recalc_cv(d)
    prior=pd.read_csv(ROOT/'resultados/cv_predicciones_v11.csv')
    prior=prior.pivot(index=['fold','fecha_UTC'],columns='modelo',values='OD_pred').reset_index()
    z=cv.merge(prior,on=['fold','fecha_UTC'],how='inner',validate='one_to_one')
    if len(z)!=len(cv):raise ValueError('Faltan fechas en comparacion historica v11')
    z['v12_candidata']=.5*z['v11_huber_depth7']+.5*z['pred_huber_delta15']
    # v11 CV includes only OOF historical predictions, not training labels in model inputs.
    rows=[]
    for model,col in [('v5','v5_instantaneo'),('v10','v10_ensamble'),('v11','v11_huber_depth7'),('v12','v12_candidata')]:
        for fold,g in z.groupby('fold'):
            m=metrics(g.OD_real,g[col]);rows.append({'modelo':model,'fold':fold,**m})
    f=pd.DataFrame(rows)
    summary=f.groupby('modelo').agg(MAE_medio=('MAE','mean'),SD_MAE=('MAE','std'),RMSE_medio=('RMSE','mean'),R2_medio=('R2','mean'),peor_MAE=('MAE','max'),N=('n','sum')).reset_index()
    low=z.OD_real<5
    risk=[]
    for m,c in [('v10','v10_ensamble'),('v11','v11_huber_depth7'),('v12','v12_candidata')]:
        risk.append({'modelo':m,'bajo_real':int(low.sum()),'bajo_no_detectado':int(((z[c]>=5)&low).sum()),'avisos_innecesarios':int(((z[c]<5)&~low).sum())})
    # No auto alert; this threshold is only an example for understanding risk.
    z.to_csv(ROOT/'resultados/cv_predicciones_v12.csv',index=False)
    f.to_csv(ROOT/'resultados/cv_folds_v12.csv',index=False)
    summary.to_csv(ROOT/'resultados/ranking_v12.csv',index=False)
    pd.DataFrame(risk).to_csv(ROOT/'resultados/diagnostico_od_bajo_v12.csv',index=False)
    return summary,z,f

def train_final(d,audit):
    model=new_model();model.fit(d[DYNAMIC],d[TARGET]-d[REFERENCE])
    old=joblib.load(ROOT/'modelos/yakutoring_v11.joblib')
    # Check only compatible input names and reference; preserve old models unmodified.
    assert old['dynamic_columns']==DYNAMIC and old['reference']==REFERENCE
    sensor_df=d[SENSORS].to_numpy(float)
    means=sensor_df.mean(axis=0);stds=sensor_df.std(axis=0)
    stds=np.where(stds==0,1,stds)
    Z=(sensor_df-means)/stds
    lw=LedoitWolf().fit(Z)
    dist=np.sqrt(np.maximum(0,lw.mahalanobis(Z)))
    bundle={
      'version':'v12-experimental','v11_models':old['models'],
      'huber_delta15':model, 'v12_formula':'0.5 * (0.5*Huber1.0 + 0.5*RMSEdepth7) + 0.5*Huber1.5',
      'train_ranges':old['train_ranges'],
      'ood_distance':{'mean':means.tolist(),'std':stds.tolist(),
                      'mean_z':lw.location_.tolist(),'inv_cov':lw.precision_.tolist(),
                      'p99':float(np.quantile(dist,.99))},
      'info':'4 sensores; Florida 2022-23; sin validacion externa Hach/Tumbes',
      'no_automatic_alerts':True,'time':'UTC-05 fijo, heredado de v11',
      'audit':audit,'params':NEW_PARAMS,
    }
    file=ROOT/'modelos/yakutoring_v12.joblib'
    joblib.dump(bundle,file,compress=3)
    return file

def main():
    d,audit=load_development()
    summary,z,f=make_comparison(d)
    model=train_final(d,audit)
    print(summary.round(4).to_string(index=False))
    print('Nuevo modelo:',model)
if __name__=='__main__':main()
