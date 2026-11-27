# Informe técnico de comparación — YakuToring v10

## Alcance y trazabilidad

- Se utilizó exclusivamente `data_Apalachicola Bay, FL.csv` (31,163 registros históricos) para esta ronda. Se conservó el 20% final ya consultado previamente fuera de la selección.
- Las predicciones y métricas pertenecen a validación temporal **de desarrollo**, no a un nuevo test ciego, un modelo de otro estuario ni al manglar de Tumbes.
- Todos los candidatos emplean los cuatro sensores: temperatura del agua, pH, conductividad específica y presión atmosférica. La versión temporal usa **historial de esos sensores**, nunca OD pasado.
- Modelo físico auxiliar: `OD_sat = C0(T) × Fs(T,S_proxy) × Fp(T,P)`, basado en Benson–Krause; la conversión de conductividad a salinidad **no está calibrada** en Tumbes. La regresión CatBoost aprende `OD_observado − OD_sat`.

## Resultados reproducidos

| Modelo | MAE medio | SD MAE | RMSE medio | R² medio |
|---|---:|---:|---:|---:|
| v5 CatBoost físico | 0.7202 | 0.0510 | 0.8927 | 0.6328 |
| v10 CatBoost físico + diferencias 1/3/6 h | 0.7009 | 0.0574 | 0.8598 | 0.6719 |
| v10 combinación 50/50 | **0.7020** | **0.0450** | **0.8614** | 0.6662 |
| v6 estacional, comparación histórica | **0.6690** | 0.1475 | 0.8286 | — |

*MAE y RMSE en mg/L; media simple de cuatro bloques temporales (2370 observaciones en total).* La diferencia promedio entre el ensamble y la v5 es de **0.0182 mg/L** (aprox. 2.5%), pequeña para afirmar superioridad general. El ensamble mejoró 3 de los 4 períodos respecto a v5, y empeoró en uno (fold 3). El modelo temporal solo mejoró dos de cuatro.

## Comprobación adicional de sensibilidad

Se cambiaron los puntos de corte **dentro del mismo conjunto de desarrollo**, manteniendo 24 h de purga. En tres ventanas alternativas (1694 observaciones en total) resultó:

- v5: MAE 0.6316 mg/L, SD 0.1169.
- Temporal: MAE 0.6276 mg/L, SD 0.0741.
- Ensamble 50/50: MAE 0.6190 mg/L, SD 0.0973.

Los datos son históricos de la misma estación y fueron utilizados para explorar. **No sustituyen la validación externa**. Los bloques alternativos se solapan en cobertura temporal con otros estudios y no deben sumarse como muestras independientes.

## Qué variantes fueron descartadas

En una ronda de diez candidatos (4 folds comparables), ExtraTrees dio MAE 0.7955 mg/L, la opción con lags crudos 0.7639 mg/L y una opción con solo diferencias 3 h de temperatura y pH 0.7298 mg/L. Añadir variables no fue una mejora automática. No se escogió la variante estacional como predeterminada pese a tener MAE 0.6690: su error en la cuarta ventana fue 0.8866 mg/L frente a 0.7837 de v5, y esa información anual de Florida puede transferirse mal a Tumbes.

## Justificación del diseño

- **Instantáneo:** funciona desde la primera medición. Se guarda sin cambios respecto al candidato conservador de v5/v8.
- **Temporal:** aprovecha cambios de los sensores a 1, 3 y 6 horas para aportar una pista indirecta sobre dinámicas del agua. CatBoost es adecuado para conjuntos tabulares y corre eficientemente en CPU; no necesita GPU para servir el modelo.
- **Ensamble 50/50:** ponderación sencilla fijada para evitar una optimización adicional de pesos sobre los mismos folds. Se usa únicamente con seis horas de historial completo. Si falta, se usa la base.
- **Evaluación:** bloques cronológicos, purga 24h, sin incluir `OD` como predictor, sin selección usando el 20% final antiguo. Por su exposición previa, ningún conjunto histórico disponible es completamente ciego después de nueve versiones.

## Diagnóstico de identificabilidad

Agrupando registros del CSV por valores **exactamente iguales** de los cuatro sensores, se identificaron **3,686 registros** con combinaciones repetidas. En **144 grupos** la diferencia entre OD máximo y mínimo fue de **al menos 0.5 mg/L**. Este hecho limita la precisión alcanzable si los procesos no medidos generan OD diferentes para las mismas entradas. Los cambios temporales pueden ayudar, pero no eliminan esa limitación.

## Próxima decisión basada en evidencia

1. Obtener y auditar un nuevo CSV SWMP/NOAA de 2024 (evaluación temporal) y otra estación (evaluación espacial), con presión meteorológica auténtica, unidades compatibles y `Historical/F_*` válidos. En este entorno no se pudieron recuperar los datos brutos por restricciones de acceso; no se afirma validación externa.
2. Congelar las versiones v5 y v10 antes de evaluar esos archivos. Comparar ambas en el mismo conjunto. Si v10 no reduce MAE o muestra mayor inestabilidad, **volver a v5**, sin ajustar después el test.
3. Para la exposición, usar las mediciones Hach de una misma muestra con los sensores en laboratorio, separar **lotes de preparación** para calibración y prueba ciega. No presentar como test datos empleados en reentrenamiento o calibración.
4. Condiciones de laboratorio: variar temperatura, composición/salinidad y OD mediante intervenciones controladas y registrar el OD observado. Recrear temperatura y salinidad no implica recrear el oxígeno del manglar.

## Referencias verificables

- USGS (2011), *Office of Water Quality Technical Memorandum 2011.03*: https://water.usgs.gov/water-resources/memos/documents/WQ.2011.03.pdf
- Sadler, J. et al. (2024), *Evaluating a process-guided deep learning approach for predicting dissolved oxygen in streams*, Hydrological Processes, DOI: 10.1002/hyp.15270. https://www.usgs.gov/publications/evaluating-a-process-guided-deep-learning-approach-predicting-dissolved-oxygen-streams
- NOAA/CDMO, archivo anual SWMP: https://cdmo.baruch.sc.edu/waf/swmp_data_archives/
- NOAA/CDMO, QAQC: https://www.nerrsdata.org/data/qaqc.cfm
