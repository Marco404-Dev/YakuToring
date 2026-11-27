# YakuToring v11 — Informe de investigación de Machine Learning

## 1. Objetivo

Buscar mejoras reproducibles sobre v5/v8 y v10 sin volver a utilizar el tramo final del conjunto de Florida, previamente examinado, para elegir modelos. Priorizar un modelo que pueda inferir a partir de sensores realmente instalados (temperatura, pH, conductividad específica, presión) y que no dependa de etiquetas OD anteriores.

## 2. Protocolo

- Fuente: `data_Apalachicola Bay, FL.csv`, 31,163 registros originales.
- Desarrollo: 24,876 registros previos al tramo final excluido con un margen de 24 h.
- Protocolo comparable: 5,642 lecturas horarias con historial exacto de 1/3/6 horas.
- Validación cruzada temporal progresiva: 4 ventanas, 2,370 predicciones por variante; purga 24 h antes de cada ventana.
- Selección y entrenamiento usan SOLO el período de desarrollo de Florida. Se excluye el 20% final previamente explorado en versiones viejas; **ese 20% tampoco es un test ciego**.
- Todas las variantes físicas utilizan la misma formulación de referencia de v10. La conversión a salinidad supone composición iónica aproximada tipo marina: no ha sido verificada para el estuario de aplicación.

## 3. Experimentos

Se ensayaron 15 configuraciones de CatBoost independientes y varias mezclas fijas (sin búsqueda optimizada de coeficientes) sobre las mismas ventanas. Entre otras:

- Optimización RMSE vs Huber delta 1 vs MAE.
- Predicción residual (OD−saturación), cociente OD/saturación y transformación logarítmica.
- Árboles con profundidades 4, 5, 6 y 7; entre 450 y 650 iteraciones.
- Características físicas derivadas de históricos y pesos aumentados para registros con OD bajo.
- Ensambles sencillos 50/50. Se eligió combinación de **dos CatBoost temporales**, uno Huber y otro RMSE profundidad 7, por su mejora media y por ventana frente a v10. La elección es **exploratoria** tras probar numerosas variantes.

| Modelo | MAE (mg/L) | SD entre cuatro ventanas | RMSE (mg/L) | R² promedio | Peor ventana |
|---|---:|---:|---:|---:|---:|
| v5 instantáneo | 0.7202 | 0.0510 | 0.8927 | 0.6328 | 0.7837 |
| v10 ensamble instantáneo-temporal | 0.7020 | **0.0450** | 0.8614 | 0.6662 | 0.7577 |
| **v11 ensamble Huber + profundidad 7** | **0.6746** | 0.0566 | **0.8388** | **0.6816** | **0.7451** |
| v6 estacional (anterior) | 0.6690 | 0.1475 | 0.8286 | — | ~0.8866 |

La v11 baja el MAE promedio alrededor de 3.9% respecto a v10. Mejora en las 4 ventanas comparables. La v6 todavía tiene MAE medio histórico marginalmente menor, pero mostró mucha más variación y patrones estacionales potencialmente no transferibles a Tumbes.

### Ventanas adicionales (sensibilidad, NO conjunto independiente)

Se repitió el análisis con tres cortes adicionales de la misma estación/período. MAE medio: v5 0.6316, v10 0.6190 y v11 0.6065 mg/L. v11 mejoró dos de las tres ventanas respecto a v10. Estos cortes solapan fechas de las comparaciones anteriores: **no reportar como una nueva validación externa**.

## 4. Diagnóstico ambiental: limitación importante

Con umbral **ilustrativo** de OD <5 mg/L:

- Se encontraron 262 observaciones verdaderamente por debajo de ese umbral en las cuatro ventanas.
- v10 clasificó erróneamente 12 de ellas como OD ≥5 mg/L (**4.6% de falsos tranquilizadores entre los casos bajos**).
- v11 clasificó erróneamente 25 (**9.5%**, peor que v10).

Estos umbrales no son equivalentes a una clasificación validada de riesgo ecológico. No se debe usar el nuevo modelo para alertas automáticas. Para el trabajo sobre alarmas, primero definir umbrales con fuentes pertinentes y recopilar un dataset local con OD bajo y mediciones Hach.

## 5. Incertidumbre retrospectiva

Calculando el percentil 90 del error absoluto en las ventanas 1–3 y comparándolo con la cuarta:

| Modelo | Semiancho retrospectivo (mg/L) | Cobertura en ventana 4 |
|---|---:|---:|
| v5 | 1.447 | 89.2% |
| v10 | 1.385 | 88.9% |
| v11 | 1.358 | 87.7% |

Esto no certifica cobertura estadística de 90% bajo un cambio de estación/ambiente. La cobertura v11 cae por debajo de las anteriores; no utilizar el intervalo histórico para decisiones de riesgo en manglares.

## 6. Decisión de ingeniería y retroceso

- **Mejora de regresión experimental:** v11 con historial completo. Su MAE retrospectivo es menor en todas las cuatro ventanas principales.
- **Retroceso automático al modelo instantáneo v5:** si faltan lecturas horarias pasadas, no se imputan datos futuros.
- **Respaldo v10 para comparación conservadora:** el CSV de salida incluye también su predicción, y su script y artefacto permanecen intactos.
- **Alertas ambientales:** desactivadas por defecto. v11 no puede considerarse más segura que v10 para detectar OD bajo; validación local pendiente.

## 7. Limitaciones y próximos pasos

1. No existe evaluación externa nueva de 2024 o de otra estación. La descarga directa del CSV NOAA de 2024 no se completó en este ambiente, y no se inventaron datos.
2. No afirmar que la v11 tiene MAE ≤0.5 mg/L: el objetivo sigue sin cumplirse en desarrollo y no se midió en laboratorio.
3. Las entradas registradas pueden coincidir y sin embargo tener OD real distinto. No se mide directamente fotosíntesis, demanda biológica/química ni mezcla del agua.
4. TDS no equivale automáticamente a conductividad específica: calibrar frente a patrón y registrar temperatura de compensación.
5. Preparar agua con salinidad distinta no garantiza OD distinto. Crear lotes independientes, variar OD de manera controlada y medir cada uno con Hach; guardar timestamp y metadatos.
6. Validar primero sin reentrenar sobre los lotes de prueba. Si hace falta corrección local, separar otros lotes para adaptación.
7. Evaluar métricas por rangos de OD y falsos tranquilizadores, no sólo MAE global.

## Referencias

- CatBoost, documentación oficial, funciones de pérdida para regresión (Huber, RMSE, MAE): https://catboost.ai/docs/en/concepts/loss-functions-regression
- USGS, *Dissolved Oxygen and Water*: https://www.usgs.gov/water-science-school/science/dissolved-oxygen-and-water
- USGS, *Technical Memorandum 2011.03*, solubilidad y presión: https://water.usgs.gov/water-resources/memos/documents/WQ.2011.03.pdf
- NOAA NERRS CDMO, archivo de series ambientales: https://cdmo.baruch.sc.edu/waf/swmp_data_archives/
