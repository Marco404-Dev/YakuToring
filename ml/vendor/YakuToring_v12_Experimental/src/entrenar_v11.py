"""YakuToring v11: comparación temporal auditable. Datos históricos ya explorados.

Entrena tres algoritmos CatBoost con objetivos/hiperparámetros fijos:
base (RMSE 450 x depth 6); temporal (RMSE 450 x depth6),
temporal Huber delta1 (450 x depth6), temporal RMSE (600 x depth7).

v11 = 0.5 * Huber temporal + 0.5 * RMSE temporal depth7.
Si falta historial exacto de 1/3/6 h, cae al base v5.
No utiliza OD pasado como característica ni vuelve a explorar el test expuesto.
"""
from __future__ import annotations
import json, joblib
from pathlib import Path
import numpy as np, pandas as pd
from catboost import CatBoostRegressor
from .caracteristicas import ROOT, TIME, TARGET, BASE, DYNAMIC, SENSORS, REFERENCE, load_development, folds, metrics
from .entrenar_y_comparar import PARAM

RESULTS = ROOT / 'resultados'
MODELS = ROOT / 'modelos'
VARIANTS = ('v5_instantaneo', 'v10_ensamble', 'v11_huber_depth7')


def train_models(train):
    y = train[TARGET].to_numpy(float) - train[REFERENCE].to_numpy(float)
    p_base = PARAM.copy()
    p_huber = {**PARAM, 'loss_function': 'Huber:delta=1'}
    p_depth7 = {**PARAM, 'depth': 7, 'iterations': 600}
    out = {}
    for key, cols, params in [
        ('base', BASE, p_base),
        ('dynamic', DYNAMIC, p_base),
        ('huber', DYNAMIC, p_huber),
        ('depth7', DYNAMIC, p_depth7),
    ]:
        model = CatBoostRegressor(**params)
        model.fit(train[cols], y)
        out[key] = model
    return out


def predictions_on_full_history(va, models):
    ref = va[REFERENCE].to_numpy(float)
    preds = {}
    for key in ('base', 'dynamic', 'huber', 'depth7'):
        cols = BASE if key == 'base' else DYNAMIC
        preds[key] = np.maximum(0, models[key].predict(va[cols]) + ref)
    return {
        'v5_instantaneo': preds['base'],
        'v10_ensamble': 0.5 * (preds['base'] + preds['dynamic']),
        'v11_huber_depth7': 0.5 * (preds['huber'] + preds['depth7']),
    }


def run_cv(d):
    rows, predictions = [], []
    for fold, train_idx, test_idx, start, end in folds(d):
        tr, va = d.iloc[train_idx], d.iloc[test_idx]
        models = train_models(tr)
        for name, yp in predictions_on_full_history(va, models).items():
            rows.append(dict(modelo=name, fold=fold, inicio=start, fin=end, **metrics(va[TARGET], yp)))
            predictions.append(pd.DataFrame({
                'modelo': name, 'fold': fold, 'fecha_UTC': va[TIME].astype(str),
                'OD_real': va[TARGET].to_numpy(float), 'OD_pred': yp}))
        print(f'  Ventana {fold} validada sobre {len(va)} observaciones; sin usar fechas futuras.', flush=True)
    cv = pd.DataFrame(rows)
    pred = pd.concat(predictions, ignore_index=True)
    # La categoría OD <5 mg/L es un análisis ilustrativo de riesgo, NO umbral ambiental autorizado.
    pred['bajo_OD_ilustrativo'] = pred.OD_real < 5
    pred['falso_tranquilizador'] = pred.bajo_OD_ilustrativo & (pred.OD_pred >= 5)
    rank = cv.groupby('modelo').agg(
        MAE_medio=('MAE', 'mean'), SD_MAE=('MAE', 'std'),
        RMSE_medio=('RMSE', 'mean'), R2_medio=('R2', 'mean'),
        peor_MAE=('MAE', 'max'), N=('n', 'sum')).sort_values('MAE_medio')
    return cv, pred, rank


def calibration_diagnostic(pred):
    """Retrospectiva: calibrar errores con folds 1–3 y examinar cobertura en fold 4.
    No es intervalo universal, ni se exporta para alarmas.
    """
    rows = []
    for name in VARIANTS:
        sample = pred[pred.modelo == name]
        cal = (sample[sample.fold.isin([1, 2, 3])].OD_pred -
               sample[sample.fold.isin([1, 2, 3])].OD_real).abs().to_numpy()
        q = float(np.quantile(cal, .90, method='higher'))
        fourth = sample[sample.fold == 4]
        cov = float(np.mean((fourth.OD_pred-fourth.OD_real).abs() <= q))
        all_low = sample[sample.bajo_OD_ilustrativo]
        rows.append({'modelo': name, 'error_abs_q90_folds_1a3_mg_L': q,
                     'cobertura_fold4': cov, 'n_bajo_OD': int(len(all_low)),
                     'falsos_tranquilizadores_umbral_5': int(all_low.falso_tranquilizador.sum()),
                     'tasa_falsos_tranquilizadores': float(all_low.falso_tranquilizador.mean())})
    return pd.DataFrame(rows)


def save_plots(cv, pred):
    import matplotlib.pyplot as plt
    order = ['v5_instantaneo', 'v10_ensamble', 'v11_huber_depth7']
    summary = cv.groupby('modelo')['MAE'].agg(['mean', 'std']).reindex(order)
    fig, ax = plt.subplots(figsize=(8.5, 4.5))
    ax.bar(range(len(order)), summary['mean'], yerr=summary['std'], capsize=5)
    ax.set_xticks(range(len(order)), ['v5 base', 'v10 ensamble', 'v11 Huber + d7'])
    ax.set_ylabel('MAE (mg/L)');ax.set_title('Comparación de desarrollo: cuatro ventanas temporales')
    ax.grid(axis='y', alpha=.2);fig.tight_layout();fig.savefig(RESULTS/'comparacion_v11.png', dpi=160);plt.close(fig)

    piv = cv.pivot(index='fold', columns='modelo', values='MAE')[order]
    fig, ax = plt.subplots(figsize=(8.5,4.5))
    for label in order: ax.plot(piv.index, piv[label], 'o-', label=label)
    ax.set_xticks([1,2,3,4]);ax.set_xlabel('Ventana de desarrollo');ax.set_ylabel('MAE (mg/L)')
    ax.grid(alpha=.2);ax.legend();fig.tight_layout();fig.savefig(RESULTS/'mae_por_ventana_v11.png',dpi=160);plt.close(fig)

    va = pred[pred.modelo=='v11_huber_depth7']
    fig, ax = plt.subplots(figsize=(7.5,5))
    ax.scatter(va.OD_real, va.OD_pred, s=6, alpha=.3)
    lo = float(min(va.OD_real.min(),va.OD_pred.min()))
    hi = float(max(va.OD_real.max(),va.OD_pred.max()))
    ax.plot([lo,hi],[lo,hi], '--', color='gray')
    ax.set_xlabel('OD observado (mg/L)');ax.set_ylabel('OD estimado (mg/L)')
    ax.set_title('v11: estimación frente a medición histórica de Florida')
    fig.tight_layout();fig.savefig(RESULTS/'observado_vs_estimado_v11.png',dpi=160);plt.close(fig)


def main():
    MODELS.mkdir(exist_ok=True); RESULTS.mkdir(exist_ok=True)
    d, audit = load_development()
    cv, pred, rank = run_cv(d)
    cv.to_csv(RESULTS/'cv_folds_v11.csv',index=False)
    pred.to_csv(RESULTS/'cv_predicciones_v11.csv',index=False)
    rank.to_csv(RESULTS/'ranking_v11.csv')
    diag = calibration_diagnostic(pred)
    diag.to_csv(RESULTS/'diagnostico_riesgo_v11.csv',index=False)
    save_plots(cv,pred)
    models = train_models(d)
    bundle = {
        'version': 'v11-experimental', 'models': models,
        'base_columns': BASE, 'dynamic_columns': DYNAMIC,
        'reference': REFERENCE,
        'train_ranges': {s: [float(d[s].min()),float(d[s].max())] for s in SENSORS},
        'model_output': 'OD estimado en mg/L, NO medido',
        'no_automatic_alerts': True,
        'validation_note': 'Sólo Florida 2022–2023; no validación Hach ni Tumbes',
        'source_audit': audit,
        'candidate_definition': '0.5 Huber delta=1 temporal depth6 450 + 0.5 RMSE temporal depth7 600; v5 respaldo',
    }
    joblib.dump(bundle, MODELS/'yakutoring_v11.joblib', compress=3)
    (RESULTS/'auditoria_datos_v11.json').write_text(json.dumps(audit,indent=2,ensure_ascii=False),encoding='utf-8')
    print('\nMAE y estabilidad (desarrollo, no test ciego):\n',rank.round(4).to_string())
    print('\nDiagnóstico OD bajo e intervalos retrospectivos:\n', diag.round(3).to_string(index=False))
    return rank

if __name__=='__main__': main()
