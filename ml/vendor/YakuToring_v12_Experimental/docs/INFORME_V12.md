# YakuToring v12 — Evaluación comparativa y decisiones técnicas

## 1. Propósito y alcance

Investigar mejoras del estimador de oxígeno disuelto (OD) en mg/L y mantener alternativas anteriores cuando convengan. **Es investigación retrospectiva, no validación con Hach ni en el manglar de Tumbes.** No se presume haber alcanzado MAE ≤0.5 mg/L.

Dataset: 31,163 registros de Apalachicola Bay, Florida, entre 2022–2023. Subconjunto de desarrollo con margen de 24 h antes del 20% final previamente consultado en versiones anteriores; 5,642 observaciones horarias con historial exacto a 1, 3 y 6 h. Cuatro cortes temporales progresivos con purga previa de 24 h producen 2,370 predicciones de validación. Como los cortes ya se han utilizado repetidamente para elegir modelos, **ninguno es un conjunto de prueba ciego**.

## 2. Arquitectura y entradas

Los sensores del hardware miden temperatura del agua (°C), pH, conductividad específica (mS/cm, aún por confirmar/calibrar) y presión atmosférica (hPa). Benson–Krause estima el OD a saturación, con salinidad aproximada derivada de conductividad. El modelo aprende el residuo `OD observado − OD a saturación`.

- **v5 instantáneo**: CatBoost con 9 características, utilizado cuando falta historial completo.
- **v10**: promedio de v5 + CatBoost temporal previo.
- **v11**: promedio de CatBoost temporal Huber δ=1.0, profundidad 6, 450 iteraciones y CatBoost temporal RMSE, profundidad 7, 600 iteraciones.
- **v12**: mezcla 50/50 de la v11 con otro CatBoost temporal Huber δ=1.5, profundidad 6, 450 iteraciones, learning rate=0.035, `l2_leaf_reg=8`, `random_seed=42`.

La predicción v12 completa es:

```
v12 = 0.25 * CatBoost_Huber_delta1.0
    + 0.25 * CatBoost_RMSE_profundidad7
    + 0.50 * CatBoost_Huber_delta1.5
```

En cada una de las tres salidas anteriores, primero se añade la referencia física; las salidas de OD individuales se limitan a valores no negativos. La función de pérdida Huber se probó porque combina un comportamiento cuadrático cerca del error cero con uno lineal para errores grandes. **El entrenamiento del nuevo componente utiliza los mismos 21 predictores que la v11.** No se usan como entradas OD real, OD Hach ni observaciones futuras.

## 3. Experimentos, selección y resultados

Se ejecutaron 14 modelos individuales adicionales (distintos del par entrenado en v11): varias configuraciones de Huber, RMSE, MAE, profundidades 5–8, Ordered Boosting, HistGradientBoosting, ExtraTrees y Ridge. Se compararon además ensambles fijos 50/50 frente a la v11. El registro íntegro está en `resultados/experimentos_14_variantes_y_ensambles.csv`. Se eligió la candidata de menor MAE junto con mejor estabilidad de esta ronda; por el número de pruebas, existe **optimismo de selección** en la misma validación histórica.

| Modelo | MAE medio (mg/L) | RMSE medio (mg/L) | R² medio | SD del MAE | Peor ventana MAE |
|---|---:|---:|---:|---:|---:|
| v5 | 0.7202 | 0.8927 | 0.6328 | 0.0510 | 0.7837 |
| v10 | 0.7020 | 0.8614 | 0.6662 | 0.0450 | 0.7577 |
| v11 | 0.6746 | 0.8388 | **0.6816** | 0.0566 | 0.7451 |
| **v12** | **0.6643** | **0.8308** | 0.6772 | **0.0367** | **0.7131** |

Frente a la v11, la mejora media de MAE es ~0.0103 mg/L (~1.5%). Frente a la v10, ~0.0377 mg/L (~5.4%). En la evaluación por períodos **v12 supera a v10 en cuatro ventanas y a v11 en tres de cuatro**. Su R² medio es levemente **menor** que el v11, por lo que no todas las métricas mejoran.

**No extrapolar estas diferencias a Tumbes.** El modelo v6 estacional había alcanzado 0.6690 mg/L en la validación histórica, pero mostraba desviación mucho mayor (~0.1475); v12 logra un MAE algo menor y mejor estabilidad, sin garantizar mejor generalización.

## 4. OD bajo y matriz de confusión

Con umbral de **5 mg/L únicamente ilustrativo**, 262 observaciones históricas estaban por debajo del umbral.

| Modelo | Casos bajos no detectados (de 262) | Falsos avisos en casos no bajos |
|---|---:|---:|
| v10 | **12** | 94 |
| v11 | 25 | **84** |
| v12 | 19 | 91 |

Aunque v12 reduce los casos no detectados frente a v11, **v10 sigue identificando mejor la mayoría de los casos bajos**. El indicador `revision_OD_bajo_ilustrativa` activa una revisión descriptiva si el mínimo entre la predicción v10 y v12 cae por debajo del umbral ilustrativo. **No es alarma automática ni diagnóstico ecológico.** Todos los archivos de inferencia marcan `apto_alerta_automatica=False`.

Se entrenó adicionalmente un clasificador CatBoost para OD<5. Con umbral probabilístico 0.5, pasó por alto 16 casos bajos, pero produjo 263 falsos avisos, frente a 94 de v10. **Se descartó** por ese costo; registro de sus salidas históricas en `resultados/clasificador_oxigeno_bajo_experimental.csv`.

## 5. Incertidumbre y condiciones desconocidas

Cálculo exploratorio: percentil 90 del error absoluto en ventanas 1–3, verificado en ventana 4:

| Modelo | Semiancho histórico | Cobertura observada ventana 4 |
|---|---:|---:|
| v10 | 1.385 mg/L | 88.9% |
| v11 | 1.358 mg/L | 87.7% |
| v12 | **1.349 mg/L** | 89.0% |

Esto no es una garantía de cobertura del 90%, especialmente fuera del ámbito de Florida. En inferencia v12 se incorpora una advertencia de distancia multivariante, basada en media, escala y covarianza Ledoit–Wolf de los cuatro sensores, además de los límites mínimo/máximo históricos. **No es una probabilidad de error; solo una alarma de entrada poco representada**.

## 6. Otros ensayos y descartes

- Corregir el horario de verano de Florida en la codificación horaria dio MAE medio 0.67424 mg/L frente al 0.67456 de la v11 original; diferencia diminuta, sin justificar sustituir por sí sola la configuración y sus artefactos previos. Por compatibilidad, v12 conserva el UTC−05 fijo heredado. Esto sigue siendo una limitación metodológica documentada.
- HistGradientBoosting, ExtraTrees, Ridge y otras pérdidas no superaron de forma consistente el ensamble seleccionado.
- Intentar mejoras con los mismos períodos no sustituye la evaluación en 2024, otra estación o nuevas mediciones con Hach.

## 7. Corrección de seguridad experimental

Antes, concatenar lecturas de recipientes distintos podía crear diferencias de 1, 3 o 6 horas entre muestras que no compartían el mismo cuerpo de agua. v12 incorpora `lote_id` opcional en inferencia y exige que el historial se calcule **dentro del mismo lote**. Para pruebas de laboratorio, se recomienda exigir siempre `lote_id`. El evaluador Hach conserva el identificador y empareja por fecha y lote, sin utilizar la etiqueta Hach para estimar OD.

Para uso de campo en un punto fijo puede omitirse `lote_id`, pero aparecerá la bandera `historial_sin_identificador_lote`.

## 8. Decisión y próximos pasos

- Mantener **v12** como candidata experimental de regresión sobre cuatro ventanas ya exploradas.
- Conservar **v10** como referencia de sensibilidad histórica a OD bajo; no activar alertas ecológicas.
- Conservar **v11** y **v5** en el paquete; el fallback operativo es v5 para muestras sin historial exacto.
- Para el laboratorio: calibrar conductividad en unidades adecuadas; recolectar muestras simultáneas con el Hach y separar recipientes completos entre ajuste y evaluación. Manipular OD real de forma controlada y segura; variar salinidad por sí sola no garantiza variaciones de OD.
- Evaluar en datos 2024 de NOAA/CDMO u otra estación sin reentrenar primero y después con Hach sobre lotes independientes. No se ha completado aún ninguna de estas pruebas externas.

## Referencias verificables

- CatBoost, [Huber, RMSE, MAE para regresión](https://catboost.ai/docs/en/concepts/loss-functions-regression).
- NOAA National Estuarine Research Reserve System (NERRS), [catálogo oficial SWMP](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.nodc%3ANERRS-SWMP) y [datos CDMO](https://www.nerrsdata.org/).
- USGS, [Dissolved Oxygen and Water](https://www.usgs.gov/water-science-school/science/dissolved-oxygen-and-water).
- USGS, [memorando técnico WQ.2011.03: solubilidad y presión](https://water.usgs.gov/water-resources/memos/documents/WQ.2011.03.pdf).

### Comparación y retroceso tras Hach

`validar_hach_v12.py` calcula un ranking por modelo sobre las **mismas observaciones con historial de 6 horas**. Cuando v10 o v11 tiene menor MAE, emite una recomendación preliminar de retroceso; no altera automáticamente el modelo. No es apropiado elegir modelos a partir de muy pocas lecturas de un único recipiente.
