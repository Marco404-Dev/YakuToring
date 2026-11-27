# Integración V12 y validación OD

## Candidato NOAA experimental

El artefacto `models/05_candidato_ligero_HistGradientBoosting.joblib` es una copia exacta del suministrado. El proceso Python comprueba su SHA-256 antes de deserializar con scikit-learn 1.7.2 y verifica que el diccionario contenga el estimador HistGradientBoostingRegressor y las ocho columnas esperadas en orden. Usa `Temp`, `pH`, `SpCond`, `BP_hPa`, `hora_sin`, `hora_cos`, `dia_sin` y `dia_cos`.

El notebook 05 consume los datos preparados por el notebook 03. Este usa la hora y el minuto del `DateTimeStamp` de NOAA tal como viene en el dataset, sin conversión a UTC, con un ciclo de 24 h y otro de 365,25 días usando el día ordinal desde 1. Los cuatro valores cíclicos se redondean a `float32`. Los paquetes actuales carecen de fecha propia, por lo que la app guarda la llegada al PC en UTC y usa su representación civil en `America/Lima` para las características. Ese instante aproxima la fecha de toma en esta versión.

[NOAA](https://www.nerrsdata.org/data/parameters.cfm) documenta SpCond en mS/cm. La [biblioteca Gravity TDS de DFRobot](https://github.com/DFRobot/GravityTDS/blob/master/GravityTDS.cpp) calcula EC con compensación a 25 °C y deriva TDS por separado. El Sender del proyecto reporta EC con calibración provisional de un punto (1,413 mS/cm), según el README de la app. La equivalencia con NOAA sigue pendiente, incluida la compensación efectiva a 25 °C en el firmware instalado y la comparación con un instrumento de referencia en el rango del manglar. El backend conserva el valor EC recibido sin conversión de ppm. La opción `YAKUTORING_OD_ALLOW_PROVISIONAL_EC=1` permite un ensayo con advertencia visible.

Cada registro del candidato guarda la fecha de recepción, ID de paquete, lote, versión y hash del modelo, entradas, estado de sensores, advertencias y resultado en la tabla SQLite `experimental_od`. El historial V12/V5 conserva sus tablas. El panel muestra las 25 mediciones más recientes del lote activo. Para incorporar una referencia, inicia sesión como administrador u operador, selecciona el paquete de la misma toma, introduce el valor de la sonda externa en mg/L y guarda. Si corriges el dato, se actualiza el mismo par. El MAE acumula todos los pares del lote y de esta versión del candidato. Las zonas inferiores, centrales y superiores son orientativas, con 5,5 y 8,5 en la zona central.

La validación preliminar NOAA 2023–2024 reportada en el entrenamiento fue MAE 0,5183 mg/L global, MAE 0,4879 mg/L entre 4 y 10 mg/L de OD real y R² 0,8255. Falta la prueba final NOAA 2025–2026, la comparación contra una sonda externa en el manglar peruano y la calibración de intervalos de predicción. La demo usa una muestra fija simulada y queda fuera de SQLite.

## Modelos históricos V12/V5

La aplicación usa los artefactos suministrados en `YakuToring_v12_Proyecto_Completo.zip`. El contenido original se conserva en `ml/vendor/YakuToring_v12_Experimental`; el notebook externo coincide por SHA-256 con el V12 incluido. `vendor-manifest.json` identifica ZIP, notebook, código y modelos. No se ejecuta entrenamiento al instalar, iniciar ni predecir.

## Ejecutar en Windows

Node.js y Python deben ejecutarse en el PC del Receiver. Python no se instala en el Heltec ni en los celulares.

```powershell
cd C:\Users\USER\Documents\ChatGPT\Manglar\yakutoring-app
npm install
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-ml.ps1
npm run build
npm start
```

El instalador crea `.venv-ml` y descarga dependencias desde PyPI. Necesita Python 3.11 o posterior; esta integración se comprobó con Python 3.13.9 de Anaconda. Si no se detecta Python:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-ml.ps1 -Python "C:\Users\USER\anaconda3\python.exe"
```

`ml/requirements.txt` conserva los rangos del proyecto original para inferencia. `ml/requirements-verified.txt` registra las seis versiones utilizadas en las pruebas. Para reproducirlas en el entorno:

```powershell
.\.venv-ml\Scripts\python.exe -m pip install -r ml/requirements-verified.txt
```

Abre http://127.0.0.1:3001. Node inicia Python automáticamente una sola vez como proceso hijo persistente `ml/worker.py`, mediante stdin/stdout JSONL. No hace falta iniciar un segundo servidor Python ni publicar un puerto interno. Python carga el bundle entrenado una vez; no se lanza un intérprete por paquete. Para observar diagnósticos directamente, con Node detenido: `.\.venv-ml\Scripts\python.exe -u ml/worker.py`; mostrará un evento JSON ready y quedará esperando solicitudes en stdin. Detener con Ctrl+C.

Opcionalmente puedes elegir otro intérprete solo en tu terminal, sin editar `.env`: `$env:YAKUTORING_PYTHON='C:\ruta\python.exe'`. Con `npm run remote`, el mismo backend, proceso ML y polling quedan bajo el origen HTTPS existente; conserva la configuración de dominios y usuarios. No se creó ni comprobó un túnel nuevo durante esta integración.

## Recepción YK y compatibilidad

```text
YK,SEQ,TEMP,PH,EC,PRES,AMB,HUM,VPH,VEC,VOD
```

Once campos, incluido el literal YK. Se aceptan la línea sola y los envoltorios `Recibido: YK,...` o `DATA:YK,...`. TEMP y AMB están en °C, EC en mS/cm, PRES en hPa, HUM en %, VPH/VEC/VOD en voltios. NA se guarda como null, jamás cero. Para VOD se conserva el voltaje original en V; solo su visualización en mV multiplica por 1000. No se recalibra EC en Node ni en React.

El parser valida estructura, secuencia entera, números finitos y rangos de los campos. Los voltajes se consideran del ADC del Heltec de 0 a 3.3 V; entradas como 1600 no se interpretan automáticamente como milivoltios. Un paquete con todos los sensores NA sigue siendo un paquete recibido, pero no produce una predicción. Se evita duplicar resúmenes informativos o repeticiones de secuencia. Una conexión que ya entrega YK ignora resúmenes DATA/TEMP hasta reconectar. Se conserva compatibilidad con DATA de cinco campos y mensajes TEMP anteriores.

## Qué ejecuta el modelo

`worker.py` importa **sin modificar** `src.predecir_v12.predict_df` y pasa el bundle ya cargado. Las únicas entradas del predictor son fecha UTC, lote, temperatura, pH, conductividad específica y presión. AMB, HUM, VPH, VEC, VOD y cualquier OD de referencia quedan fuera de esa lista.

Se mantienen las nueve características instantáneas: cuatro sensores, seno/coseno de hora local UTC−5 fijo, saturación de agua dulce, saturación salobre y proxy de salinidad. La física y el cálculo de proxy se ejecutan dentro del código original; sus conversiones internas de unidades para esas fórmulas no son una segunda calibración del valor EC transmitido. La interpretación de EC como conductividad específica y la aproximación marina del proxy requieren comprobarse experimentalmente en Tumbes.

V12 usa 21 características (las nueve anteriores y doce diferencias de los cuatro sensores frente a 1, 3 y 6 h). Se conservan las salidas no negativas y la mezcla original de Huber δ1, RMSE depth7 y Huber δ1.5, con pesos 0.25/0.25/0.50. El respaldo V5 es el modelo instantáneo **incluido en el mismo bundle**, no un modelo inventado ni reentrenado.

## Historial real, lotes y reinicios

SQLite en `.local/ml.sqlite` almacena marca UTC, lote, lectura cruda, predicción, referencia y versión de calibración. El predictor consulta las observaciones del mismo lote que coincidan exactamente a −1, −3 y −6 horas. No interpola, redondea timestamps ni sustituye entradas ausentes. Un histórico inválido no impide el respaldo instantáneo si la lectura actual sí es válida.

**Esperar seis horas no garantiza activar V12.** El formato YK no incluye reloj del Sender: se usa la hora real de recepción del PC con milisegundos. Si las diferencias entre recepciones no son exactamente las exigidas por el original, se mantiene V5. La interfaz identifica el modelo de cada fila. Modificar este criterio necesitaría un cambio metodológico explícito, no un relleno automático del historial. Las pruebas de V12 usan timestamps horarios sintéticos identificados como SIMULADO; no aparecen en el dashboard.

El lote inicial `campo-principal` representa un único punto de campo. En laboratorio, el administrador debe cambiarlo al cambiar de recipiente. Las diferencias temporales y métricas no mezclan lotes. Node guarda además `.local/telemetry.jsonl` con lecturas crudas. Si Python falla, serial y WhatsApp siguen operativos; esas lecturas quedan en el archivo crudo, pero no se fabrican predicciones ni se reprocesa automáticamente ese archivo. Tras reparar Python y reiniciar Node, se recupera el historial que sí fue confirmado en SQLite.

No borres `.local` para actualizar el proyecto: contiene usuarios, historial y calibración. Las gráficas de sensores y el contador actuales siguen siendo de sesión; la sección ML tiene historial persistente. El navegador recibe las últimas 120 observaciones ML del lote mediante el polling existente. La exportación conserva todas las filas, incluso NA y filas sin predicción.

## Activar y desactivar validación OD

El formulario ofrece tres métodos independientes:

| Método                          | Datos requeridos                                    | Uso                                                                           |
| ------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| 100 % · un punto                | Voltaje a saturación y temperatura                  | Curva de temperatura del fabricante, pendiente de verificar experimentalmente |
| 100 % · dos temperaturas        | Dos voltajes a saturación y sus temperaturas        | Ajuste térmico de voltaje a saturación                                        |
| 0 % y 100 % · misma temperatura | Voltajes de cero y saturación, temperatura de ambos | Ajuste de desplazamiento y sensibilidad a temperatura estable                 |

El tercer método (`zero_span`) no cambia el ML. Usa `Vcorregido = Vmedido − Vcero` y `span = V100 − Vcero`, en lugar de asumir voltaje cero a 0 %; conserva la compensación física por presión y salinidad descrita más abajo. Requiere V100 al menos 1 mV mayor que Vcero. Ambos puntos deben ser mediciones reales, a la misma temperatura dentro de la tolerancia seleccionada.

```text
OD_ref = (Vmedido_mV − Vcero_mV) / ((V100_mV − Vcero_mV) × Fp)
         × Csat_dulce(T, P_actual) × Fsalinidad
```

La tolerancia inicial visible es 0.5 °C y puede configurarse entre 0 y 2 °C: es un límite operativo para restringir el uso del ajuste, no una precisión acreditada del sensor. Fuera de esa temperatura no se produce referencia y se solicita recalibrar. No se añade la pendiente de 35 mV/°C al método 0 % / 100 %, porque esos dos puntos a una temperatura no determinan una curva térmica. Por debajo del cero calibrado no se oculta el desajuste forzando el valor a cero; la referencia queda no disponible. Por encima del punto de 100 % se identifica la extrapolación expresamente.

La calibración de cero y sensibilidad es un principio general documentado por [Hamilton](https://www.hamiltoncompany.com/knowledge-base/article/do-sensor-calibration). Su implementación aquí es una alternativa experimental para el sensor confirmado por el usuario, no una nueva validación de DFRobot ni una garantía de mejor precisión. 100 % significa saturación con aire, no exposición a oxígeno puro.

El método se guarda por observación y aparece en historial y CSV (`calibration_method`). SQLite conserva las configuraciones nuevas por versión en la tabla calibrations. Las calibraciones antiguas previas a esa tabla no se reconstruyen con valores inventados. Las métricas se mantienen separadas por lote/versión; cambiar método o puntos inicia otro grupo. No se recalculan las referencias históricas al guardar otra calibración.

1. Inicia sesión como admin; operador y visitante no pueden modificar calibración ni lote.
2. En **Validación del modelo ML**, abre **Configurar lote y sensor OD**.
3. Selecciona el lote y habilita validación. Para calcular referencia debes configurar el modelo real del sensor (SEN0237 o SEN0237-A), uno o dos puntos medidos a saturación y presión durante la calibración. Para dos puntos, las temperaturas deben ser distintas y ambos puntos deben obtenerse a la presión indicada.
4. Selecciona explícitamente agua dulce conocida, salinidad medida manual o proxy por conductividad. Este último queda identificado como estimado, sin validación local.
5. Confirma únicamente una calibración que efectivamente hayas realizado y guarda. No se incluyen puntos de ejemplo como valores predeterminados.
6. Para desactivar, desmarca validación y guarda; la predicción ML continúa. Si el firmware envía VOD=NA, no hay referencia, pero los cuatro sensores del ML siguen permitiendo predecir.

Si desconectar físicamente la sonda produce un voltaje cero en vez de NA, ese dato no permite distinguir ausencia de sonda de una lectura realmente nula. No se inventa ese diagnóstico: desactiva la validación mientras la sonda esté retirada o utiliza el indicador NA del firmware. Un cero transmitido se conserva como cero, no se convierte automáticamente en dato ausente.

Se muestran OD predicho, referencia **calculada con calibración**, VOD mV, modelo, error absoluto y MAE/RMSE/R². No se presenta el voltaje como OD medido directamente. Las métricas usan parejas simultáneas del mismo lote y versión de calibración; cambiar sus puntos crea otra versión. R² es no disponible con menos de dos referencias distintas. Una serie densa de un solo recipiente no valida generalización a otros lotes o a Tumbes.

## Método de referencia y compensaciones

Se utiliza la relación lineal voltaje/OD del fabricante y su curva de voltaje a saturación: un punto con pendiente de 35 mV/°C, o recta de dos puntos. El método de un punto es apropiado para temperatura estable; fuera de ella debe verificarse. Véanse el [ejemplo oficial DFRobot](https://wiki.dfrobot.com/sen0237-a/docs/20892) y su [principio de calibración](https://wiki.dfrobot.com/sen0237-a/docs/20891).

La integración reemplaza la tabla entera de solubilidad por la función Benson–Krause del paquete original, conservando temperatura fraccionaria. Es una extensión física documentada, pendiente de contraste con una referencia independiente. En agua salobre aplica el factor salino de esa misma formulación, con salinidad manual o proxy explícito.

Para evitar una doble corrección por presión en un sensor sensible a presión parcial, se normaliza el voltaje de saturación de la calibración al P actual usando el cociente de saturaciones de agua dulce, y se aplica la solubilidad salina al P actual:

```text
Fp = Csat_dulce(T, P_actual) / Csat_dulce(T, P_calibracion)
Vsat_actual = Vsat_calibrado(T) * Fp
OD_referencia = VOD_mV / Vsat_actual * Csat_dulce(T, P_actual) * Fsalinidad
```

Por tanto, a igual voltaje, la conversión no multiplica otra vez el efecto de P que el sensor ya registra; la presión de calibración sigue importando. La saturación usa Benson–Krause/USGS tal como está citada e implementada en el proyecto original. No es una medición Hach ni una validación de laboratorio ya completada. La presión y conductividad simultáneas siempre se guardan para auditoría.

## Pruebas y evidencia

```powershell
npm test
npm run test:ml
npm run build
cd ml\vendor\YakuToring_v12_Experimental
..\..\..\.venv-ml\Scripts\python.exe -m src.pruebas_v12
```

Las seis pruebas Python comparan secuencialmente la integración con predict_df original, incluida V12 temporal, con diferencia máxima registrada 0.0; verifican historial persistido, lotes, NA, independencia de VOD/referencia y calibración. Las pruebas Node incluyen el puente persistente con un único PID y archivos temporales SIMULADO; Windows puede conservar esa carpeta de prueba bajo .local si bloquea su limpieza, sin cargarla en el dashboard.

Evidencia: `verification/ml-inference-simulated.json`. Contiene inferencias reales del artefacto entrenado con entradas sintéticas: V5 6.014204483547103 mg/L a las 00:00 UTC y V12 5.497693290163117 mg/L a las 06:00 UTC. **No son mediciones físicas.** Las 29 pruebas originales también pasan. No se ejecutaron pruebas físicas del sensor OD, calibración real ni envíos reales de WhatsApp en esta integración.

## Seguridad, exportación y diagnóstico

Python solo utiliza stdin/stdout; no se expone un servicio nuevo a Internet. El hijo no recibe variables WHATSAPP_. Cambiar configuración requiere admin y CSRF. Exportar CSV requiere admin u operador; el dashboard mantiene su modo de lectura. Ninguna predicción dispara WhatsApp. Se conservan las cuatro plantillas y el reporte diario manual: no se coloca automáticamente OD predicho como si fuera una medición o simulación del campo aprobado.

El CSV contiene sensores simultáneos, voltajes originales en V, predicción, modelo, referencia calculada, error, lote y versión de calibración; los campos textuales se protegen contra fórmulas de hojas de cálculo. La base SQLite, registros crudos y diagnósticos en `.local/ml-diagnostics.jsonl` son privados, ignorados por Git y excluidos del ZIP. Los diagnósticos registran eventos de proceso, no tokens ni muestras completas.

Si ML figura no disponible, confirma que exista `.venv-ml/Scripts/python.exe`, instala dependencias y ejecuta test:ml. Si predicción figura no disponible pero el servicio está listo, revisa las cuatro entradas del modelo: el original acepta T 0–40 °C, pH 0–14, EC 0–59.118 mS/cm y P 507–1114 hPa, además del dominio del proxy salino. Una lectura fuera del rango físico del modelo sigue visible en el monitoreo serial, pero no produce un valor ML inventado. Si falta VOD o calibración, solo la referencia queda no disponible.
