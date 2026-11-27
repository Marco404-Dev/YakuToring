# YakuToring v12 — CatBoost físico-temporal (investigación)

Versión experimental reproducible con modelo entrenado, notebook con gráficas, comparaciones v5/v10/v11/v12 y scripts de predicción y validación. **No está validada con agua de Tumbes ni con Hach.** El conjunto Florida 2022–2023 ya ha sido explorado; **sus MAE no equivalen a una prueba externa ciega**.

## Resultados históricos comparables

| Modelo | MAE (mg/L) | Desviación MAE entre ventanas | Advertencia |
|---|---:|---:|---|
| v5 instantáneo | 0.7202 | 0.0510 | Respaldo sin historial |
| v10 ensamble | 0.7020 | 0.0450 | Mejor detección histórica de OD bajo |
| v11 Huber+d7 | 0.6746 | 0.0566 | Peor detección que v10 |
| **v12 Huber 1.5 + v11** | **0.6643** | **0.0367** | Mejor regresión histórica, alertas NO habilitadas |

**v12 = 0.25·Huber(δ=1) + 0.25·RMSE(depth=7) + 0.50·Huber(δ=1.5)**, cada salida en OD mg/L tras añadir la saturación física. La v12 necesita historial horario exacto de 1/3/6 h; de lo contrario, usa la v5.

## Abrir en Anaconda (Windows)

```bat
conda create -n yakutoring_v12 python=3.11 -y
conda activate yakutoring_v12
cd /d "RUTA\YakuToring_v12_Experimental"
python -m pip install -r requirements.txt
python -m src.pruebas_v12
jupyter notebook
```

Abre **`YakuToring_V12_PRINCIPAL.ipynb`**. Ya contiene las gráficas y tablas guardadas, y puedes ejecutarlo de nuevo con **Run All**. No hay necesidad de reentrenar para visualizar resultados.

## Reproducir la comparación (mismos folds, no evaluación externa)

```bat
python -m src.entrenar_v12
```

Para volver a generar desde cero los artefactos heredados v11 (opcional), primero ejecuta `python -m src.entrenar_v11`, y después `python -m src.entrenar_v12`.

## Predecir con los sensores

En laboratorio, registra `lote_id` para distinguir recipientes. Usa `plantilla_lecturas_por_lote.csv`.

```bat
python -m src.predecir_v12 --archivo MIS_SENSORES.csv --salida predicciones_v12.csv
```

Columnas: `lote_id`, `fecha_hora_UTC` (ISO 8601 UTC), `temperatura_agua_C`, `pH`, `conductividad_especifica_mS_cm`, `presion_atmosferica_hPa`. Para monitoreo en un punto fijo, `lote_id` puede omitirse con advertencia. La lógica no mezcla historiales de lotes distintos si se proporciona este campo.

La salida incluye OD estimado v12, OD de referencia v10 y v11, modo (v12 o respaldo v5), distancia a condiciones históricas, indicadores descriptivos de riesgo y `apto_alerta_automatica=False`.

## Evaluar con Hach — solo nuevos lotes independientes

Usa `plantilla_hach.csv`, conserva `lote_id` y añade una lectura Hach junto con los sensores en cada timestamp:

```bat
python -m src.validar_hach_v12 --archivo MIS_LOTES_INDEPENDIENTES_HACH.csv --salida evaluacion_hach.csv
```

No introduzcas `OD_Hach_mg_L` al sistema de inferencia. Esta columna se usa **después** para calcular MAE, RMSE y R². No ajustes el modelo y evalúes con los mismos recipientes. Si las pruebas duran menos de 6 h por lote, todas las predicciones serán de respaldo v5, no de v12 temporal.

## Principales archivos

- `YakuToring_V12_PRINCIPAL.ipynb`: notebook con resultados y gráficos **ejecutado**.
- `src/entrenar_v12.py`: CV progresiva, modelo Huber 1.5 y ensamble final.
- `src/predecir_v12.py`: inferencia con aislamiento entre lotes y respaldo v5.
- `src/validar_hach_v12.py`: comparación por timestamp y lote, sin etiquetas como entrada.
- `src/pruebas_v12.py`: pruebas automatizadas.
- `modelos/yakutoring_v12.joblib`: modelos entrenados y controles de entrada.
- `resultados/ranking_v12.csv`, `cv_folds_v12.csv`, `cv_predicciones_v12.csv`: comparaciones reproducidas.
- `resultados/experimentos_14_variantes_y_ensambles.csv`: registro de variantes exploratorias.
- `docs/INFORME_V12.md`: análisis científico, riesgos, descartes y fuentes.
- `documentacion/PROTOCOLO_HACH.md`: protocolo experimental heredado.

## Advertencias

1. Salinidad derivada del TDS/conductividad requiere calibración; el modelo supone sales semejantes a agua marina.
2. Florida presenta procesos ambientales propios y no representa automáticamente al manglar de Tumbes.
3. Con pocas mediciones locales NO se garantiza MAE ≤0.5 mg/L.
4. Umbral OD<5 mg/L **solamente ilustrativo**; no es regulación local ni condición automática de alerta.
5. La hora codificada del modelo heredado es UTC−05 fijo, no ajusta el horario estacional de Florida.
6. Las entradas atípicas se **marcan para revisión**, sin afirmar una probabilidad validada de error.

El evaluador Hach v12 incluye **comparación justa de v5/v10/v11/v12 sobre las mismas filas con 6 h completas**, y emite una sugerencia preliminar de retroceso si v10/v11 obtiene menor MAE en esos lotes. Esta sugerencia no cambia automáticamente modelos ni implica validez ecológica; requiere nuevos lotes independientes.
