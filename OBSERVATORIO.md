# Observatorio acuático YakuToring

## Recolección y referencias ambientales

Las sesiones admiten objetivos enteros de 1 a 10.000 paquetes válidos. Los accesos rápidos son 25, 50, 100, 200, 500 y 1.000. La primera apertura con el nuevo esquema adapta las sesiones antiguas a un objetivo de 100 dentro de una transacción SQLite. La deduplicación conserva la secuencia LoRa única por sesión. El CSV parcial está disponible mientras llegan mediciones. El informe se imprime como PDF desde el navegador. La demostración reproduce una sesión guardada en un panel separado cuando el Receiver está desconectado.

Los perfiles orientativos E1 lagunas y lagos y E3 estuarios se basan en el anexo del D. S. 004-2017-MINAM, categoría 4. E1 usa pH 6,5–9, OD mínimo de 5 mg/L, conductividad máxima de 1 mS/cm y Δ3 °C. E3 usa pH 6,8–8,5, OD mínimo de 4 mg/L y Δ2 °C. La temperatura requiere el promedio mensual multianual del área. La conductividad provisional requiere verificación para E1. La presión y la conductividad en E3 carecen de criterio aplicable. El semáforo para OD estimado es orientativo y las franjas amarillas son configuraciones experimentales. [Anexo oficial publicado por DIGESA](https://www.digesa.minsa.gob.pe/norma_consulta/ECA%20AGUA%20DS-004-2017-MINAM.pdf).

La alerta estadística combina mediana móvil, MAD, 12 observaciones de base, una ventana máxima de 15 minutos, magnitud mínima y tres desviaciones consecutivas en el mismo sentido. La tolerancia térmica inicial de 0,25 °C es una decisión operativa configurable. El DS18B20 tiene resolución de 0,0625 °C a 12 bits y exactitud nominal de ±0,5 °C entre −10 y +85 °C. [Ficha técnica de Analog Devices](https://www.analog.com/en/products/DS18B20.html).

### Diagnóstico WhatsApp

Los intentos se registran localmente con su resultado de la API y un estado de entrega independiente. El diagnóstico añade una marca de prueba en un campo aprobado o exige que la plantilla fija ya identifique la prueba. Hay un intervalo mínimo de 30 segundos entre intentos. Configura un callback HTTPS estable de Meta con la ruta `/webhooks/whatsapp`, `WHATSAPP_APP_SECRET` y `WHATSAPP_WEBHOOK_VERIFY_TOKEN` para recibir y validar estados firmados. Suscribe el campo `messages`. Hasta recibir un estado, la entrega se muestra como desconocida. [Documentación de webhooks de Meta](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/).

### Créditos fotográficos

Las fotografías se redimensionaron y convirtieron a WebP. Las versiones adaptadas conservan las licencias indicadas.

- Javier Távara, CC BY 2.0. [Manglares de Tumbes](https://commons.wikimedia.org/wiki/File:Manglares_de_Tumbes.jpg).
- RiSpecchia, CC BY-SA 4.0. [Manglares Tumbes](https://commons.wikimedia.org/wiki/File:Manglares_Tumbes.jpg).
- GraceAlison, CC BY-SA 4.0. [Manglares de Tumbes – Perú](https://commons.wikimedia.org/wiki/File:Manglares_de_Tumbes_-_Per%C3%BA.jpg).
- AKTL14251527, CC BY-SA 4.0. [Paseo por los Manglares de Tumbes](https://commons.wikimedia.org/wiki/File:Paseo_por_los_Manglares_de_Tumbes.jpg).

## Uso cotidiano

Inicio muestra el estado del Receiver y el asistente **Conectar dispositivo**. El mismo asistente está en la barra superior y permite conectar, desconectar o reconectar desde cualquier módulo. La preferencia **Vista general / Vista técnica** se guarda en el navegador. **Ayuda** incluye un recorrido opcional de ocho pasos y un glosario.

El resumen compara cada lectura válida con la mediana de hasta 30 paquetes anteriores de la misma sesión. La comparación requiere al menos 12 valores válidos y marca variación cuando el cambio alcanza el mayor valor entre la desviación estándar muestral y una tolerancia descriptiva de 0,3 °C, 0,2 pH, 0,05 mS/cm o 1 hPa según la variable. El centro descriptivo de pH usa la banda 6,9–7,1. Estos criterios sirven para seguimiento y carecen de carácter normativo. Las alertas tienen un umbral estadístico propio. Las comparaciones de estabilidad usan ventanas históricas disponibles.

El servidor activa solamente **CatBoost 07** por omisión. No se ajustó de nuevo el modelo. Se conserva su contrato de ocho variables, incluidas las cuatro componentes cíclicas de hora y día. `YAKUTORING_ACTIVE_MODELS` admite una lista separada por comas. Los modos opcionales son `mlp`, `weighted`, `stacking`, `reduced`, `noaa` y `legacy`. Al habilitar un híbrido, incluye `catboost,mlp`. Reinicia Node para aplicar la lista. Los Joblib, pesos, métricas y scripts históricos se conservan. En el flujo en vivo la EC provisional requiere permiso explícito mediante `YAKUTORING_OD_ALLOW_PROVISIONAL_EC`. CatBoost muestra estimaciones extrapoladas con una advertencia cuando la muestra se aleja de la referencia. Las entradas inválidas siguen impidiendo el cálculo.

## Arquitectura

- `src/main.jsx` administra la navegación por fragmentos, la sesión y el sondeo del backend. `Workspace.jsx`, `Datasets.jsx` y `workspace.css` contienen las vistas, el modo visual y la interfaz adaptativa. Los paneles existentes conservan el historial de OD, los ensayos con sonda y las sesiones de adquisición.
- `server/index.js` conserva el parser LoRa, el puerto serial y la API original. `server/environment.js` publica referencias y métricas compactas y delega las operaciones autorizadas al proceso Python. El acceso de operador o administrador se aplica a la inferencia bajo demanda y al almacén de CSV.
- `ml/worker.py` usa un proceso persistente. `environment_inference.py` carga los artefactos bajo demanda y evalúa representatividad. `datasets.py` conserva originales UTF-8 separados de NOAA y telemetría, con huella SHA-256, búsqueda, páginas de 25 filas y diagnóstico de duplicados y faltantes. El límite de cada archivo es 12 kB.
- `train_environment.py` y `evaluate_environment.py` ejecutan el entrenamiento y la evaluación fuera del arranque. `ml/environment_models/` contiene los Joblib y sus resultados JSON versionados. El navegador recibe estadísticas y un máximo de 1.400 puntos históricos de PCA.
- Los archivos previos a la edición de frontend, backend, README y manifiesto npm están en `.local/pre-redesign-20261126-190009`. El repositorio padre carecía de commits, por lo que se hizo un respaldo en archivos. Los archivos fuentes de NOAA, la base existente, los modelos originales y las calibraciones se conservaron en sus ubicaciones.

## Reproducción

En PowerShell, desde `yakutoring-app`, prepara el entorno según el [README](README.md). Instala PyArrow 21 para leer los Parquet. Ajusta la ruta a la copia local del proyecto de entrenamiento.

```powershell
$noaa = 'C:\Users\USER\Documents\Proyectos\YakuToring_MachineLearning\data\processed\experimentos_04'
$train = Join-Path $noaa 'noaa_04_train_experimental.parquet'
$validation = Join-Path $noaa 'noaa_04_valid_experimental.parquet'
$env:LOKY_MAX_CPU_COUNT = '2'
.\.venv-ml\Scripts\python.exe -m pip install pyarrow==21.0.0
.\.venv-ml\Scripts\python.exe ml/train_environment.py --source $train
.\.venv-ml\Scripts\python.exe ml/evaluate_environment.py $train $validation
npm run build
npm start
```

La app abre en `http://127.0.0.1:3001` salvo configuración de otro puerto. Para un experimento aislado usa `--output` en ambos scripts. Reinicia el backend al sustituir artefactos para renovar la caché. Los modelos distribuidos permiten ejecutar la plataforma sin leer los Parquet originales.

## Referencia Florida y evaluación

El agrupamiento utiliza Apalachicola Bay 2015–2022. De 1.108.552 filas de la partición, 957.331 pasan los filtros de variables completas y rangos plausibles. Las marcas temporales sin zona del Parquet se utilizan tal como están codificadas para la selección de años. La estandarización se ajusta sobre temperatura, pH, conductividad específica y presión. MiniBatchKMeans explora k de 2 a 10. También se ajusta un GMM a una muestra fija de hasta 30.000 filas. BIC y AIC son descriptivos sobre esa misma muestra. La estabilidad ARI compara dos semillas sobre los mismos datos. El mayor Silhouette, 0,345, correspondió a k = 2 y su ARI fue 0,998. Los grupos reúnen 398.845 y 558.486 filas, con medias de EC de 3,62 y 34,43 mS/cm. Las dos componentes principales explican aproximadamente 79,6 % de la varianza estandarizada.

El OD histórico se usa después del agrupamiento para caracterizar los perfiles. Los percentiles 95 y 99 de la distancia al centroide definen representatividad limitada y condición fuera de distribución, respectivamente. La proyección evita asignar un grupo fuera de distribución. Se informa también si alguna variable excede el rango de referencia. Los puntajes describen similitud con Florida. El resultado de Isolation Forest usa la misma estandarización y se interpreta como un hallazgo exploratorio. La clasificación ambiental, la detección instrumental y la evaluación de OD responden a preguntas distintas.

La evaluación toma las 197.441 filas de 2024 de la partición original de validación 2023–2024. La prueba final original 2025–2026 queda reservada. El control, B, C y E se ajustan sobre la misma muestra reproducible de 100.000 filas anteriores a 2024. Se incluyen los modelos congelados y la línea base F. La comparación por grupos utiliza los centroides entrenados con 2015–2022. El archivo `noaa-experiments-v1.json` registra los hashes, MAE, RMSE, R², sesgo y métricas por rango y cluster. La evaluación de 2024 es exploratoria para modelos históricos ya comparados en ese año.

| Modelo | MAE 2024 (mg/L) |
| --- | ---: |
| CatBoost existente | 0,5124 |
| CatBoost de control | 0,5351 |
| CatBoost con cluster | 0,5318 |
| CatBoost por cluster | 0,5444 |
| CatBoost sin EC | 0,7123 |
| Mediana de entrenamiento | 1,4736 |
| MLP existente | 0,5215 |
| Híbrido ponderado existente | 0,5068 |
| Stacking existente | 0,5053 |

B mejora ligeramente al control de presupuesto comparable. C tiene mayor MAE que el control y que el CatBoost existente. La configuración de predicción en vivo se conserva. No hay cobertura predictiva establecida para Perú. El modelo sin EC se ofrece como opción experimental y solo evalúa los rangos univariados disponibles. La base local de trabajo tenía sesiones de adquisición y cero muestras con OD de referencia en el registro experimental. Para adaptación D se requieren pares locales y una separación por muestra o sesión. La validación local agrupa por código de muestra y punto dentro de cada sesión y fase, promediando las repeticiones. R² requiere al menos tres grupos y variación en el OD observado. Las mediciones de laboratorio informadas de 7–9 mg/L tienen cobertura limitada para el resto del rango.

## Métodos fisicoquímicos y telemetría

La saturación aplica Benson–Krause según el memorando USGS 2011.03. Multiplica la solubilidad en agua dulce a una atmósfera por los factores de salinidad y presión local, que incluyen vapor de agua. El cálculo opera entre 0–40 °C, 507–1114 hPa y 0–40 g/kg. Cuando la salinidad falta, el simulador usa una referencia explícita de agua dulce. El porcentaje se calcula como OD de sonda dividido por saturación teórica por 100, y puede superar 100 %. [USGS DOTABLES](https://www.usgs.gov/tools/dotables) y [memorando técnico USGS 2011.03](https://water.usgs.gov/water-resources/memos/documents/WQ.2011.03.pdf).

El Receiver transmite EC y, según la trama, voltajes. TDS ppm, ADC crudo o salinidad faltantes permanecen vacíos. La normalización de unidades aplica 1 mS/cm = 1.000 µS/cm. La calibración provisional del Sender sigue pendiente de una comparación instrumental en el rango de campo. El análisis de anomalías combina faltantes, persistencia de valores idénticos y un puntaje robusto con mediana y MAD de hasta 30 observaciones anteriores. SQLite conserva eventos instrumentales, estadísticos y de comunicación. Se agrupan eventos pendientes de la misma variable e hipótesis separados por hasta cinco minutos. Los operadores pueden revisarlos y el administrador puede guardar el umbral. Los envíos de WhatsApp requieren confirmación del operador.

El índice de estabilidad experimental usa una ventana de 24 horas, al menos 30 observaciones válidas de temperatura, pH y conductividad y una duración mínima de una hora. Cada penalización tiene peso 0,2. Tres se calculan como desviación estándar muestral dividida por 3 °C, 0,5 pH o 0,15 mS/cm y acotada a [0, 1]. Se añaden la fracción de paquetes recientes con cambios atípicos consecutivos y la fracción de faltantes de las tres variables. El índice es 100 por uno menos la suma ponderada. El divisor de conductividad se usa para seguimiento descriptivo.

## Pruebas y trabajo pendiente

```powershell
npm test
npm run test:ml
npm run test:comparison
.\.venv-ml\Scripts\python.exe -m unittest discover -s ml -p 'test*.py'
$env:YAKUTORING_CHROME = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/test-workspace.js
```

La prueba de navegador abre Chrome en modo headless con un perfil y SQLite de prueba. Verifica las nueve rutas, tema, ancho de 390 px y la carga de PCA y evaluación por HTTP. Los flujos de prueba usan fixtures aislados y la adquisición física requiere el Receiver. El repositorio carece de un linter configurado.

Quedan pendientes el clustering local independiente con campañas representativas, importaciones masivas, histogramas y boxplots por campaña y los envíos automáticos de WhatsApp con cooldown. La frecuencia del firmware, la saturación ADC y el rango operativo en campo requieren evidencia del dispositivo. También quedan pendientes la verificación en vivo con hardware, los experimentos locales con sonda y un conjunto local apropiado para intervalos predictivos.
