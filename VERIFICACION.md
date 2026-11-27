# Verificación · tercer método de calibración OD

- Añadida opción 0 % y 100 % a la misma temperatura (zero_span), conservando un punto a saturación y dos temperaturas a saturación.
- Cálculo con desplazamiento de cero y span; sin usar la pendiente térmica de 35 mV/°C en el nuevo método. Validación de voltajes, diferencia mínima de 1 mV, temperaturas y tolerancia operacional explícita. Referencia no disponible fuera de temperatura o por debajo del cero calibrado; extrapolación superior identificada.
- Método registrado en historial y CSV; configuraciones nuevas archivadas por versión en SQLite. Los grupos de MAE/RMSE/R² siguen separados por lote y versión de calibración. Modelos ML y .env sin cambios.
- Nuevas pruebas sintéticas aisladas: cero, mitad y 100 %, temperaturas incompatibles, puntos invertidos/iguales, NA/parámetros inválidos, señal inferior/superior, persistencia de método y configuraciones, independencia del ML y separación de métricas. No se aplicó una calibración ficticia a la base de datos real.
- Compilación de producción correcta. `npm test`: 25/25; `npm run test:ml`: 12/12 (seis de integración anteriores y seis nuevas de cero/span). Las pruebas comprueban los cálculos; no constituyen una calibración física del sensor ni acreditan precisión experimental.
- Reiniciar Node para cargar el Python actualizado; refrescar el navegador para ver el selector de tres métodos. No se cambia automáticamente el método ni los puntos que el usuario ya tenga guardados.

## Historial: Receiver USB sin lecturas · 10 de noviembre de 2026

- Incidencia: COM16 abría, pero el dashboard tenía 0 paquetes mientras el contador OLED del Receiver avanzaba. Se midieron 0 bytes USB en 35 segundos; una prueba con DTR activada tampoco produjo bytes.
- Causa confirmada en metadatos de Arduino: última compilación Receiver con USBMode=hwcdc,CDCOnBoot=default. En la definición de Heltec ESP32 3.3.8, default significa Disabled.
- Se compiló y cargó el mismo sketch del Receiver en COM16 con CDCOnBoot=cdc (Enabled). Fuente sin cambios, SHA-256 8ABEEDD5742EC2739F1B2C721B6E0319A06F5A8AA4CBEE95B3EF965315AA9611. Carga y verificación de escritura correctas. No se tocó el Sender COM15 ni su Monitor Serial.
- Verificación real después de cargar y conectar: paquetes YK 272–273, temperatura 27.37 °C, pH 3.16, conductividad 3.263 mS/cm, presión 1002.27 hPa. Se preservaron ambiente, humedad y los tres voltajes.
- ML operativo con esas lecturas reales: V5 de respaldo, 3.5685751753835016 mg/L, con advertencia de entrada poco representada. Validación OD desactivada; ninguna referencia inventada ni notificación enviada.
- Evidencia: verification/receiver-usbcdc-after.json y receiver-usbcdc-diagnosis.md. La aplicación quedó conectada a COM16 recibiendo datos; no se cambió .env ni código del backend/frontend.
- Para próximas cargas desde Arduino IDE: Herramientas → USB CDC On Boot → Enabled, con USB Mode → Hardware CDC and JTAG. Cerrar COM desde la aplicación antes de cargar.

## Historial: integración ML V12 · 9 de noviembre de 2026

- Se inspeccionaron ZIP, notebook y código actual. Notebook externo idéntico al incluido por SHA-256. Código y artefactos originales conservados en ml/vendor; manifest en ml/vendor-manifest.json. No se entrenó ni sobrescribió ningún modelo.
- Bundle V12 original cargado con CatBoost 1.2.10. Contiene V5 de respaldo y los modelos temporales. Python persistente por stdin/stdout; ningún puerto nuevo publicado. Entorno local .venv-ml, sin modificar .env ni las cuentas de usuario.
- `npm test`: 25/25, incluyendo YK de once campos, NA, orden/unidades, duplicados y formatos anteriores, puente Node-Python con un solo PID, autenticación, Host/Origin/CSRF y estructuras WhatsApp.
- `npm run test:ml`: 6/6 pruebas Python; comparación con inferencia original, persistencia SQLite, aislamiento de lotes, coincidencias horarias exactas, independencia de VOD/OD observado, calibración y métricas por versión.
- Batería ORIGINAL `python -m src.pruebas_v12`: 29/29 correctas. No se ejecutaron scripts de entrenamiento.
- `npm run build`: compilación correcta.
- Evidencia numérica real del artefacto entrenado con ENTRADAS SIMULADAS: V5 6.014204483547103 mg/L y V12 5.497693290163117 mg/L, diferencia máxima contra predict_df original 0.0. Archivo verification/ml-inference-simulated.json. No son lecturas físicas ni se precargan en el dashboard.
- Instancia aislada de revisión en puerto 3101 y SQLite separado: frontend 200, /api/ml/state listo, validación desactivada, sin lecturas ficticias; /api/ml/settings y /api/ml/export.csv respondieron 401 sin sesión. No se ocupó el COM de la aplicación principal.
- Interfaz revisada en navegador y a 390 px: sección Validación del modelo ML, estados no disponibles sin entradas, referencia condicionada a calibración, tarjetas, métricas e historial. Sin controles de configuración para visitantes.
- Diagnósticos locales mínimos en .local/ml-diagnostics.jsonl, registros crudos en telemetry.jsonl y memoria histórica SQLite por lote. Nada de esto se sirve como archivo público ni se incluye en ZIP.
- Sin pruebas físicas de recepción YK, sensor OD prestado o calibración real durante esta integración. No se activó un túnel nuevo ni se hicieron envíos reales a Meta. Cloudflare conserva el transporte polling y los controles de acceso ya existentes.
- Limitación deliberada y visible: V12 requiere timestamps exactos a 1/3/6 h. Se mantienen marcas reales de recepción; no se redondean ni inventan. Con muestreo serial irregular puede continuar V5 incluso tras seis horas.
- El método de referencia adapta la curva de voltaje a saturación documentada por DFRobot y utiliza Benson–Krause para temperatura/salinidad/presión. Su validez experimental local sigue pendiente; sin calibración confirmada no se calcula referencia.

## Archivos de esta integración

- Backend: server/parser.js, server/index.js, server/ml-client.js y nuevas pruebas yk.test.js/ml-bridge.test.js.
- Python: ml/worker.py, ml/validation.py, ml/test_integration.py, requirements.txt, requirements-verified.txt, vendor-manifest.json y paquete original completo en ml/vendor.
- Frontend: src/MLPanel.jsx, src/main.jsx y src/style.css.
- Ejecución/documentación: scripts/setup-ml.ps1, scripts/test-ml.js, package.json, .gitignore, README.md y ml/README.md.
- Evidencia: verification/ml-inference-simulated.json.

## Historial: corrección de Host en acceso remoto

- Causa: server/auth.js solo reconocía el origen temporal registrado por el lanzador en .local/tunnel.json. Un túnel iniciado manualmente no disponía de ese registro.
- Se añadió config/access.json con el origen exacto https://scott-exit-republican-governmental.trycloudflare.com y server/origins.js para combinar una lista explícita validada con el dominio generado por un lanzador activo. Sin comodines ni autorización global de Cloudflare.
- Se mantuvieron localhost/127.0.0.1, sesiones, permisos y CSRF. Los POST remotos exigen Origin coincidente con su Host autorizado; las sesiones quedan vinculadas a ese origen. No se modificaron .env, usuarios, WhatsApp ni serial.
- npm test: 21 pruebas correctas. Incluyen dominio manual actual/futuro, hosts no listados, sufijos maliciosos, comodines, rutas y puertos inválidos, configuración ilegible, localhost, X-Forwarded-Host no confiable, roles, sesiones, CSRF y revocación al quitar un dominio.
- npm run build: correcto.
- Verificación HTTPS ejecutada sobre el túnel real proporcionado: / respondió HTML 200, ambos recursos JS/CSS respondieron 200, /api/auth/me y /api/state respondieron JSON 200. El polling incremental respondió 200 y respetó el cursor.
- Verificación remota de seguridad: puertos y catálogo respondieron 401 sin sesión; conectar, desconectar y mensajes respondieron 401 sin sesión; Origin ajeno respondió 403; .env y .local/users.json respondieron 404. Las acciones de prueba no abrieron COM ni enviaron WhatsApp.
- La prueba HTTP externa confirma recursos y API a través del túnel. No se ha realizado una prueba desde un celular físico ni se han enviado mensajes reales en esta corrección. Las pruebas autenticadas de permisos se ejecutaron en un servidor de prueba local.

## Historial: conductividad eléctrica en mS/cm

Actualización del 5 de noviembre de 2026 (Perú):

- Parser actualizado: el cuarto campo DATA se guarda como conductivity, sin dividir ni aplicar el factor de calibración del firmware. El ejemplo DATA:16,27.50,7.07,1.363,1012.80 conserva exactamente el número 1.363.
- Formato centralizado en src/sensors.js: conductividad con tres decimales y mS/cm en tarjetas, gráfica/eje vertical, estadísticas, historial y parámetros de alertas. Descripción: Conductividad estimada — calibración en verificación. No quedan etiquetas TDS/ppm en src.
- `npm test`: 19 pruebas correctas, incluidas las dos cadenas DATA solicitadas, NA, cero real, ausencia de doble conversión, promedios, parámetros de las dos alertas y conservación del campo de salinidad independiente.
- `npm run build`: compilación correcta. `npm run test:local`: endpoints, polling incremental, autenticación y protección de archivos privados correctos.
- Prueba física en COM16 a 115200: cuatro paquetes DATA reales, secuencias 172–175, tres antes de reconectar y uno después. El Receiver transmitió conductividad 0 (mostrada como 0.000 mS/cm), pH entre 4.10 y 4.12, temperatura NA y presión NA. NA se mostró como Sin lectura y no entró en promedios. No se infiere validez de calibración a partir de esta muestra.
- Evidencia física: verification/receiver-conductivity.json, con unidades explícitas. Se conserva por separado la evidencia histórica de TDS; no se convierte ni se carga como conductividad.
- El valor 1.363 mS/cm se verificó en pruebas automatizadas de parser y formato compartido; no se observó ese valor en la muestra física de esta actualización. No se agregaron lecturas de ejemplo al dashboard.
- Navegador: tarjeta con tres decimales, descripción provisional, gráficas, historial y NA comprobados con los datos reales anteriores. Distribución revisada a 390 px. Se ajustó el tamaño de la unidad en la tarjeta móvil y se preservó su escritura mS/cm en tablas.
- `.env`, usuarios, permisos y configuración del túnel no se modificaron. Las pruebas de roles y origen remoto exacto siguen pasando. No se creó un nuevo túnel ni se verificó acceso desde una red externa durante esta actualización.
- No se solicitaron envíos reales a Meta: se verificaron los nombres/orden de parámetros y el valor 1.363 mS/cm de las alertas mediante tests. El campo de salinidad del reporte permanece manual/no disponible o simulado, sin conductividad automática.
- La prueba serial desconectó y liberó COM16 al terminar. No se modificó el firmware.

## Historial: actualización anterior de cuatro sensores y acceso remoto

Fecha: 5 de noviembre de 2026 (Perú).

- `npm test`: 16 pruebas correctas. Incluyen DATA, NA, rangos/formato, secuencia repetida, compatibilidad TEMP, orden real de líneas, promedios sin NA, estructuras WhatsApp, roles, cookie, CSRF, logout y host remoto exacto.
- `npm run build`: compilación de producción correcta. Frontend compilado servido por Express en 127.0.0.1:3001; no se publica Vite.
- `npm run test:local`: comprobados HTTP, polling incremental, denegación de COM/WhatsApp sin sesión, catálogo autenticado, cierre de sesión y respuestas 404 para `.env`, `.local` y código del backend. Sin envíos a Meta.
- Hardware real en COM16 a 115200 baudios: muestra final de cuatro paquetes DATA, secuencias 272–275, sin mediciones TEMP adicionales. Dos antes y dos después de desconectar/reconectar desde la aplicación. RSSI/SNR conservados.
- Primera medición de esa muestra: temperatura 27.56 °C, pH 4.05, TDS estimado 64.28 ppm, presión 999.44 hPa, RSSI -33 dBm y SNR 6 dB. Última: 27.56 °C, pH 4.06, 64.13 ppm y 999.40 hPa.
- Evidencia real: `verification/receiver-four-sensors.json` (16:12:08–16:12:31, Perú). No se precarga como datos de ejemplo en la interfaz.
- La captura serial confirmó que el firmware imprime Paquete/Temperatura/RSSI/SNR antes de DATA. Se corrigió la agrupación inicial y se repitió la prueba física con el resultado anterior.
- Navegador: cuatro tarjetas, cuatro gráficas y tabla de historial con lecturas reales. Modo visitante sin controles COM ni formularios WhatsApp. Distribución revisada a 1280 px y 390 px; gráficas en dos columnas y una columna, respectivamente.
- `NA`: probado con mensajes sintéticos en pruebas automatizadas; no se observaron NA en los cuatro paquetes DATA de la muestra física final.
- `.env` existente conservado sin editar. `.env`, `.local/users.json`, `.local/credenciales.txt` y tools/cloudflared.exe comprobados como ignorados por Git. No se imprimieron contraseñas ni token.
- cloudflared oficial descargado en tools: versión 2026.10.7, ejecutable comprobado mediante --version.
- Quick Tunnel: la revisión automática de permisos rechazó crearlo por exposición pública del dashboard/lecturas mediante Cloudflare. No se creó una URL y no se ha intentado eludir ese bloqueo. Pendiente autorización explícita del usuario.
- Acceso desde celular físico en otra red: pendiente de túnel autorizado y verificación en el teléfono. La revisión responsive en navegador no equivale a esa prueba.
- Envíos reales de WhatsApp: no ejecutados durante esta actualización. Se conservaron las plantillas y la construcción de payload; las pruebas de estructuras y control de acceso pasan. Falta verificar con Meta los envíos confirmados por el usuario.
- Retirada física del USB: no probada; sí se probó desconectar/reconectar mediante backend autenticado.

## Historial de verificación inicial de la versión TEMP

- `npm test`: siete pruebas correctas de agrupación serial, duplicados, rango de temperatura, parámetros y reporte real.
- `npm run build`: compilación de producción correcta.
- `npm run test:local`: HTTP, catálogo de cuatro plantillas, SSE, rechazo de origen externo y validación de solicitudes correctos. No inyecta mediciones ni envía mensajes.
- `npm install`: auditoría de dependencias sin vulnerabilidades notificadas al instalar; versiones resueltas en `package-lock.json`.
- Navegador: dashboard, selector COM, formulario de alerta sin token y botón de envío bloqueado comprobados. Diseño revisado también a 390 px de ancho.
- Detección real de puertos: COM15 y COM16.
- Apertura inicial de COM16: rechazada por Windows. Tras el usuario cerrar el Monitor Serial, se pudo abrir COM16 a 115200 baudios.
- Recepción real verificada: registro guardado con 14 mediciones correspondientes a los paquetes 27–40, sin números repetidos ni huecos en esa muestra. Primera y última temperatura: 27.44 °C. RSSI y SNR recibidos y mostrados.
- Dashboard verificado con datos reales: temperatura, contador, gráfica, hora de recepción y promedio se actualizan mediante SSE. La gráfica mostró 15 puntos reales durante la observación posterior al registro.
- Desconexión y reconexión desde la aplicación: ambas respondieron HTTP 200. El contador pasó de 9 a 11 con dos nuevas mediciones después de reconectar. No se modificó el firmware.
- Retirada física del USB: no probada.
- `.env` comprobado como ignorado por Git. Token vacío, nunca enviado al frontend.
- Consulta de idiomas aprobados y envíos reales a Meta pendientes de token válido. No se ha enviado ningún mensaje ni confirmado entregas.

La muestra real está en `verification/receiver-session.json`, recibida el 5 de noviembre de 2026 entre las 14:53:33 y 14:54:51 (Perú). Sus fechas se guardan en UTC. No son datos simulados ni se cargan automáticamente al dashboard.

Para completar la validación con hardware falta contrastar la pantalla física del Receiver y retirar/reconectar el USB. Después configurar el token, verificar el idioma devuelto por Meta y probar cada plantilla confirmando los parámetros en la interfaz. La aceptación de Meta no confirma entrega.
