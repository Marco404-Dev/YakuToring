# Comparación experimental de cuatro modelos

## Iniciar y comprobar

Requiere Node.js 22.13+ y Python 3.11+. Desde la carpeta de la aplicación, en PowerShell, ejecuta lo siguiente.

```powershell
npm.cmd install
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-ml.ps1
npm.cmd run auth:setup
npm.cmd run build
npm.cmd start
```

Node inicia un proceso Python persistente por stdin/stdout. Abre http://127.0.0.1:3001, inicia sesión, conecta el Receiver y consulta **Comparación experimental de modelos de oxígeno disuelto** debajo del historial. Las cuatro tarjetas se actualizan con el mismo paquete y muestran su fecha. La diferencia máxima–mínima describe el desacuerdo de los modelos. Todos los resultados se presentan como experimentales.

Se agregó PyTorch (`torch>=2.6,<3`) a las dependencias de inferencia. El entorno verificado usa torch 2.15.0+cpu, NumPy 2.3.5, pandas 2.3.3, scikit-learn 1.7.2, CatBoost 1.2.10 y joblib 1.5.2. En este PC el entorno hereda paquetes de Anaconda. NumPy, sklearn y CatBoost se importan antes de PyTorch para compartir la biblioteca OpenMP inicializada. El instalador crea entornos nuevos aislados.

## Artefactos y preprocesamiento

Los seis archivos se copiaron desde `C:/Users/USER/Documents/Proyectos/YakuToring_MachineLearning/models` a `ml/models/comparison` conservando estas rutas relativas.

| Artefacto | Ruta relativa |
| --- | --- |
| CatBoost | entrenamiento_07/07_CatBoost_base05_300k.joblib |
| MLP | deep_learning_08/08_MLP_128-64-32_experimental.pt |
| Escalador | deep_learning_08/08_MLP_128-64-32_experimental_scaler.joblib |
| Metadatos MLP | deep_learning_08/08_MLP_128-64-32_experimental.json |
| Mezcla | hibrido_09/09_mezcla_ponderada_experimental.json |
| Ridge | hibrido_09/09_stacking_Ridge_experimental.joblib |

`manifest.json` registra las rutas de origen y los SHA-256. Al iniciar se comprueban los hashes y los contratos de los artefactos. Cada modelo informa su disponibilidad. Un fallo de CatBoost o MLP deja a los híbridos dependientes sin resultado, manteniendo explícito el error.

El notebook 07 utiliza CatBoostRegressor serializado dentro de `estimador`. El notebook 08 usa Linear/ReLU 8→128→64→32→1, salida sin activación, StandardScaler ajustado previamente y arrays float32. Se cargan los pesos con `weights_only=True` en CPU y se ejecuta en modo evaluación. El notebook 09 utiliza las predicciones base en el orden CatBoost, MLP, ponderación almacenada 0,55/0,45 y el Ridge serializado. Cada base se ejecuta una vez por paquete.

Las ocho variables son `Temp,pH,SpCond,BP_hPa,hora_sin,hora_cos,dia_sin,dia_cos`. Se reutilizan los ciclos del notebook 03, consumidos por 07–09. Hora = hora + minuto/60, ciclo de 24 horas, día ordinal desde 1 y ciclo de 365,25 días, redondeados a float32. La aplicación usa el timestamp del registro. El protocolo DATA/YK actual carece de fecha de toma, por lo que registra la recepción USB y calcula los ciclos en America/Lima, aplicando la misma transformación de hora civil del notebook.

## Conductividad

La configuración `YAKUTORING_EC_INPUT_UNIT=uS/cm` corresponde al nuevo Sender confirmado por el usuario. El backend guarda el valor original y su unidad, mantiene la EC en µS/cm y divide entre 1000 una vez para la representación en mS/cm y la entrada SpCond. Ejemplo, 1413 µS/cm produce 1,413 mS/cm.

Para equipos con firmware anterior que ya entregue mS/cm, configura `YAKUTORING_EC_INPUT_UNIT=mS/cm` antes de iniciar Node. El backend respeta ese valor y calcula su equivalente en µS/cm mediante la relación de unidades. Los formatos DATA/YK carecen de etiqueta de unidad, por lo que la aplicación requiere esta configuración explícita del dispositivo.

NOAA define SpCond en mS/cm. La conversión de unidades mantiene pendiente la equivalencia metrológica entre el Gravity TDS y la conductividad específica NOAA, incluida la compensación de temperatura efectiva. Las tarjetas mantienen esa advertencia. Cada registro histórico conserva las unidades y valores con los que se guardó.

## Registrar muestras y la sonda

1. Entra como administrador u operador.
2. Crea una sesión experimental con un nombre que identifique la salida o ensayo. La sesión permite hasta 100 mediciones guardadas.
3. Selecciona el paquete correspondiente a la muestra. Puedes cargar mediciones anteriores para recuperar tomas previas al transporte.
4. Registra código, punto, profundidad opcional, fecha/hora de recolección, contexto de sensores (campo o laboratorio) y observaciones. Las fechas introducidas usan la zona local configurada en el navegador y se envían con desplazamiento explícito.
5. Pulsa **Registrar muestra y predicciones**. Se vinculan las cuatro predicciones congeladas del paquete con sus entradas, versión y hashes.
6. Abre el detalle de la muestra. Introduce OD de la sonda y fecha/hora de medición en laboratorio. Pulsa **Guardar OD de referencia**.
7. Consulta los cuatro errores absolutos y los MAE con su número de pares. El resumen muestra por separado los sensores medidos en campo y en laboratorio. El contraste campo–sonda posterior incluye efectos del transporte y tiempo transcurrido.
8. Pulsa **Descargar CSV experimental** para exportar la sesión seleccionada. Incluye las fechas de recolección, sensores y sonda, unidades, predicciones, estados de modelos, errores, entradas y hashes. Los valores ausentes quedan vacíos.

Al guardar o corregir la referencia, las predicciones congeladas mantienen sus valores originales. Las tablas `comparison_runs`, `experiment_sessions` y `experiment_samples` son adicionales y persisten en la misma SQLite. La recolección automática de 100 paquetes y las sesiones experimentales de muestras tienen sus propios controles. El registro experimental requiere asignar cada paquete a su muestra.

## Endpoints y pruebas

| Método | Endpoint | Uso |
| --- | --- | --- |
| GET | /api/state y /api/ml/state | Cuatro resultados, disponibilidad y sesiones bajo ml.comparison |
| GET | /api/experiments/runs?before=cursor | Historial paginado de predicciones congeladas |
| POST | /api/experiments/sessions | Crear sesión con name |
| POST | /api/experiments/samples | Asociar sessionId, runId y metadata |
| POST | /api/experiments/reference | Guardar sampleId, value y at |
| GET | /api/experiments/:id/export.csv | CSV UTF-8 de sesión seleccionada |

Las operaciones de registro y exportación exigen rol administrador u operador y las mutaciones verifican CSRF.

```powershell
npm.cmd test
npm.cmd run test:ml
npm.cmd run test:comparison
```

La última prueba usa una SQLite identificada como simulada dentro de .local y el puerto HTTP 3194. Verifica parser→conversión→Python→cuatro modelos→referencia→MAE→CSV, manteniendo los datos de prueba en esa base aislada. Las pruebas Python verifican las ocho variables, coincidencia con el procesamiento del notebook, reutilización de bases, fallos, referencias congeladas y límite de 100.

Las cifras NOAA 2024 suministradas son referencias históricas de validación exploratoria. La precisión local requiere pares con la sonda calibrada y condiciones de medición documentadas. Para sensores y sonda en laboratorio se debe registrar el mismo estado de la muestra, considerando el tiempo entre ambas tomas. El conjunto TEST NOAA 2025–2026 sigue pendiente de evaluación.
