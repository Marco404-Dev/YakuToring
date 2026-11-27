"""Evaluación temporal, comparación con v5/v6 y entrenamiento del ensamble v10.

IMPORTANTE: los cortes de Florida ya fueron consultados en versiones anteriores;
los resultados son exploratorios, NO equivalen a evaluación externa ciega.
"""
from __future__ import annotations
import argparse,json,time,joblib
from pathlib import Path
import numpy as np,pandas as pd
from catboost import CatBoostRegressor
from .caracteristicas import ROOT, TIME,TARGET,SENSORS,BASE,DYNAMIC,REFERENCE,load_development,folds,metrics

MODELS=ROOT/'modelos'; RESULTS=ROOT/'resultados'
PARAM=dict(iterations=450,depth=6,learning_rate=.035,l2_leaf_reg=8,
           loss_function='RMSE',random_seed=42,verbose=False,
           thread_count=4,allow_writing_files=False)

def build_model(): return CatBoostRegressor(**PARAM)

def fit_pair(train):
    residual=train[TARGET].to_numpy(float)-train[REFERENCE].to_numpy(float)
    m0=build_model();m0.fit(train[BASE],residual)
    m1=build_model();m1.fit(train[DYNAMIC],residual)
    return m0,m1

def predict_pair(d,m0,m1):
    ref=d[REFERENCE].to_numpy(float)
    base=np.maximum(0,m0.predict(d[BASE])+ref)
    dynamic=np.maximum(0,m1.predict(d[DYNAMIC])+ref)
    return {'v5_reproducido':base, 'v10_dinamico':dynamic,
            'v10_ensamble_50':.5*base+.5*dynamic}

def evaluate():
    d,audit=load_development();cv=[];pred=[]
    for fold,tridx,validx,start,end in folds(d):
        tr,va=d.iloc[tridx],d.iloc[validx]
        m0,m1=fit_pair(tr)
        for name, yp in predict_pair(va,m0,m1).items():
            res=metrics(va[TARGET],yp)
            cv.append({'modelo':name,'fold':fold,'inicio':start,'fin':end,**res})
            pred.append(pd.DataFrame({'modelo':name,'fold':fold,'fecha_UTC':va[TIME].astype(str),
                                      'OD_real':va[TARGET].to_numpy(),'OD_pred':yp}))
            print(f'Fold {fold}, {name}: MAE={res["MAE"]:.4f} mg/L',flush=True)
    cv=pd.DataFrame(cv); pred=pd.concat(pred,ignore_index=True)
    cv.to_csv(RESULTS/'cv_folds_v10.csv',index=False)
    pred.to_csv(RESULTS/'cv_predicciones_v10.csv',index=False)
    summary=cv.groupby('modelo',as_index=False).agg(
        MAE_medio=('MAE','mean'),SD_MAE=('MAE','std'),RMSE_medio=('RMSE','mean'),
        R2_medio=('R2','mean'),n=('n','sum')).sort_values('MAE_medio')
    summary.to_csv(RESULTS/'ranking_v10.csv',index=False)
    (RESULTS/'auditoria_datos.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf8')
    print('\nResumen (validación de desarrollo, NO test externo):\n',summary.round(4).to_string(index=False))
    return d,audit,cv,pred,summary

def train_final(d,audit):
    m0,m1=fit_pair(d)
    bundle={'model_base':m0,'model_dynamic':m1,'base_columns':BASE,'dynamic_columns':DYNAMIC,
            'sensor_columns':SENSORS,'reference':REFERENCE,
            'default_mode':'ensamble_si_hay_6h_sino_base',
            'warning':'VALIDADO SOLO EN PERIODOS HISTORICOS DE FLORIDA; NO HACH/TUMBES',
            'train_ranges':{s:[float(d[s].min()),float(d[s].max())] for s in SENSORS},
            'audit':audit,'params':PARAM,'version':'v10'}
    path=MODELS/'yakutoring_v10.joblib'
    joblib.dump(bundle,path,compress=3)
    return path

def plot_results(cv,pred):
    import matplotlib.pyplot as plt
    order=['v5_reproducido','v10_dinamico','v10_ensamble_50']
    summary=cv.groupby('modelo')['MAE'].agg(['mean','std']).reindex(order)
    fig,ax=plt.subplots(figsize=(9,4.5)); xx=np.arange(len(order));
    ax.bar(xx, summary['mean'], yerr=summary['std'], capsize=6)
    ax.set_xticks(xx, ['v5 anterior','v10 temporal','v10 ensamble 50/50']);ax.set_ylabel('MAE (mg/L)');
    ax.set_title('Validación temporal de desarrollo: promedio y variación (4 folds)')
    ax.grid(axis='y',alpha=.2);fig.tight_layout();fig.savefig(RESULTS/'comparacion_cv_v10.png',dpi=160);plt.close(fig)
    pivot=cv.pivot(index='fold',columns='modelo',values='MAE')[order]
    fig,ax=plt.subplots(figsize=(9,4.5))
    for k in order: ax.plot(pivot.index,pivot[k],marker='o',label=k)
    ax.set_xticks([1,2,3,4]);ax.set_xlabel('Fold cronológico');ax.set_ylabel('MAE (mg/L)');ax.legend();ax.grid(alpha=.25)
    fig.tight_layout();fig.savefig(RESULTS/'mae_por_fold_v10.png',dpi=160);plt.close(fig)
    q=pred[pred['modelo']=='v10_ensamble_50'].copy()
    fig,ax=plt.subplots(figsize=(8,4.5));ax.scatter(q['OD_real'],q['OD_pred'],s=7,alpha=.3)
    lo=min(q.OD_real.min(),q.OD_pred.min());hi=max(q.OD_real.max(),q.OD_pred.max())
    ax.plot([lo,hi],[lo,hi],linestyle='--',color='gray');ax.set_xlabel('OD observado en Florida (mg/L)');ax.set_ylabel('OD estimado (mg/L)')
    ax.set_title('Predicciones fuera de entrenamiento (folds de desarrollo)');fig.tight_layout()
    fig.savefig(RESULTS/'observado_vs_estimado_v10.png',dpi=160);plt.close(fig)

def main():
    RESULTS.mkdir(exist_ok=True);MODELS.mkdir(exist_ok=True)
    t=time.perf_counter();d,a,cv,pred,s=evaluate();plot_results(cv,pred)
    path=train_final(d,a)
    print('Modelo guardado:',path,'duración',round(time.perf_counter()-t,2),'s')
if __name__=='__main__':main()
