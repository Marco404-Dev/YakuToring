# YakuToring · observatorio acuático

Plataforma React/Vite, Express, serialport y Python para telemetría LoRa, estimación experimental de OD, agrupamiento ambiental y análisis fisicoquímico. El Receiver se conecta por USB al PC Windows. Los visitantes consultan ese mismo backend mediante HTTP.

La barra lateral ofrece **Inicio**, **Monitoreo**, **Análisis ambiental**, **Alertas** e **Historial**. Abre **Conectar dispositivo** desde la barra superior para elegir el puerto USB. En Análisis ambiental están Oxígeno disuelto, Perfiles ambientales, Análisis fisicoquímico e Investigación y validación. En Historial están las mediciones, las sesiones de 100 lecturas, los datasets, las campañas y la transferencia CSV. WhatsApp está en Alertas. El menú de usuario reúne ayuda, preferencias visuales y configuración de modelos.

La [guía de arquitectura y metodología](OBSERVATORIO.md) describe el respaldo, la reproducción del entrenamiento, los artefactos, las pruebas y las limitaciones de la validación en Perú.

## Oxígeno disuelto estimado · EXPERIMENTAL

### Comparación de cuatro modelos y sonda

El panel **Comparación experimental de modelos de oxígeno disuelto** muestra CatBoost, MLP PyTorch, híbrido ponderado 55/45 y Stacking Ridge para el mismo paquete. Consulta [la guía de comparación](ml/COMPARACION.md) para el registro de muestras, la referencia de laboratorio, las unidades, los endpoints y las pruebas.

El dashboard usa **CatBoost 07** por defecto. Los otros modelos quedan disponibles en la configuración avanzada y sus resultados históricos se conservan. La demostración histórica de HistGradientBoosting se habilita agregando `noaa` a `YAKUTORING_ACTIVE_MODELS` y reiniciando el servidor.

En campo, usa un Sender/Receiver que ya transmita `DATA:SEQ,TEMP,PH,EC,PRES` o `YK,SEQ,TEMP,PH,EC,PRES,AMB,HUM,VPH,VEC,VOD` con `VOD=NA` al retirar la sonda. Si el Sender aún exige la sonda para emitir, haz que emita los cuatro sensores y reserve `NA` para VOD. El Receiver debe entregar la trama por USB a 115200 baudios. La EC transmitida debe venir expresada en mS/cm y la presión en hPa. Las tramas antiguas que usaban ppm en el mismo campo son indistinguibles por su sintaxis.

La estimación serial queda bloqueada por defecto. Para ensayar conscientemente con la EC provisional en mS/cm, configura `YAKUTORING_OD_ALLOW_PROVISIONAL_EC=1` en el entorno o en el `.env` local y reinicia Node. El panel mantiene visible la advertencia. Consulta el [contrato del modelo, la calibración pendiente y el flujo de referencia](ml/README.md#candidato-noaa-experimental).

El panel desplegable **Validación histórica V12/V5 y configuración del lote** conserva los modelos anteriores, su historial SQLite, la calibración y la exportación CSV. Node arranca un único proceso Python persistente local para ambos flujos.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-ml.ps1
```

Instala el entorno ML antes de npm start. Node lo inicia automáticamente. La validación OD está desactivada por defecto y no se calcula referencia sin calibración confirmada.

## Ejecutar en Windows

Requiere Node.js 22.13 o posterior (verificado con Node 24), con SQLite incorporado, y un cable USB de datos para la captura de campo. En PowerShell:

```powershell
cd C:\Users\USER\Documents\ChatGPT\Manglar\yakutoring-app
npm install
npm run auth:setup
npm run build
npm start
```

Abre http://127.0.0.1:3001. La primera preparación crea dos usuarios y contraseñas aleatorias en `.local/credenciales.txt`. Abre ese archivo localmente para consultarlas; nunca se imprimen en consola. La configuración almacena hashes scrypt con sal en `.local/users.json`. Volver a ejecutar `auth:setup` conserva las cuentas existentes. Conserva `.local` en el PC principal; no la subas ni incluyas en ZIP. En Windows, los permisos efectivos del archivo dependen de las ACL de tu cuenta; no lo coloques en carpetas compartidas.

### Recolección de 100 mediciones

En **Recolección de mediciones LoRa**, inicia sesión como administrador u operador y pulsa **Iniciar 100 mediciones**. Solo hay una sesión activa a la vez. Se cuentan tramas DATA/YK nuevas con temperatura, pH, EC y presión válidas. El OD es opcional. La sesión sigue en curso si se pierde el USB y continúa cuando el administrador reconecta el Receiver. Al llegar a 100 se completa automáticamente.

Pulsa **Detener sesión** para dejarla pausada. El selector conserva el historial y permite **Reanudar sesión** o **Descargar CSV** para la sesión seleccionada. SQLite conserva sesiones y registros tras recargar el dashboard o reiniciar Node. La captura usa el ritmo del Sender. La deduplicación usa la secuencia por sesión, incluso tras reconectar. Si el Sender se reinicia y reutiliza números durante la misma sesión, esas secuencias se consideran repetidas porque el protocolo actual carece de un identificador de arranque.

El CSV usa fechas ISO 8601 UTC, coma como separador y punto decimal. Incluye la EC provisional en mS/cm y el estado de calibración. El campo TDS queda vacío porque las tramas actuales no transmiten ppm. Cuando está disponible, el CSV vincula el resultado de OD y la referencia de la misma medición mediante su identificador de captura. Los resultados de la demo quedan fuera de la captura. Si el motor ML no produjo un resultado, el estado se exporta como `sin_resultado_ml`.

Inicia sesión como `admin`, cierra el Monitor Serial y Serial Plotter de Arduino, actualiza los puertos, selecciona el COM del Receiver y pulsa Conectar. El puerto no está fijado en código. COM16 fue el puerto utilizado en las pruebas previas. Los controles siempre representan los puertos del PC principal, incluso cuando el administrador entra desde otro dispositivo. Desconectar libera el USB. Ctrl+C detiene el servidor.

Si PowerShell bloquea npm.ps1, usa `npm.cmd`. Para desarrollar localmente puedes ejecutar `npm run dev` y abrir http://127.0.0.1:5173; este modo no debe publicarse. El proxy de Vite apunta a 3001: si cambias PORT, actualiza `vite.config.js` solo para desarrollo.

## Formato YK y compatibilidad

El formato preferido para ML/validación es `YK,SEQ,TEMP,PH,EC,PRES,AMB,HUM,VPH,VEC,VOD`: once campos, incluidos voltajes en V. NA indica falta de lectura. El modelo usa únicamente los cuatro sensores principales y fecha UTC; VOD queda reservado para validación y no es una entrada del modelo. Los formatos anteriores siguientes siguen siendo compatibles.

## Cuatro sensores y NA

El cuarto campo DATA ahora corresponde exclusivamente a conductividad en mS/cm; el formato no incluye un identificador de unidad. Usa el firmware actualizado del Sender/Receiver y reinicia Node tras esta actualización para empezar una sesión con el esquema nuevo. No mezcles transmisiones antiguas de TDS con el formato actual: no es posible distinguir sus unidades solo por la cadena DATA. La evidencia histórica en verification conserva sus unidades originales y no se carga en el dashboard.

Formato serial preferido, una línea terminada en salto de línea a 115200 baudios:

```text
DATA:16,27.50,7.07,1.363,1012.80
DATA:17,NA,7.07,1.363,NA
```

Orden: secuencia entera no negativa, temperatura °C, pH, conductividad eléctrica mS/cm y presión atmosférica hPa. Se exigen exactamente cinco campos. NA se guarda como null; también se acepta un paquete con los cuatro sensores NA y se cuenta como paquete recibido. Números vacíos, infinitos, campos extra o faltantes y secuencias fuera del rango entero seguro se descartan. Se validan temperatura entre -55 y 125, pH entre 0 y 14, conductividad no negativa y presión mayor que 0 y hasta 2000 hPa. Estos son controles de validez de datos, no umbrales de alerta ambiental.

Después de detectar DATA, esa es la única fuente de mediciones de la conexión; las líneas informativas TEMP/Temperatura/Paquete no duplican mediciones. Repetir consecutivamente la misma secuencia DATA no cuenta otra vez. Una secuencia menor se admite como posible reinicio del Sender, sin deducir pérdida o anomalías. Al reconectar se reinicia el parser. Se mantienen mensajes anteriores `TEMP:26.50`, `Recibido: TEMP:26.50` y bloques Temperatura/Paquete cuando no hay DATA. La agrupación de metadatos utiliza 180 ms; RSSI/SNR solo se muestran si llegan dentro de ese bloque. No se inventan métricas ausentes.

Cuatro tarjetas muestran los valores del último paquete: NA aparece como **Sin lectura**, incluso si hubo una lectura anterior válida. Las cuatro gráficas muestran los últimos 120 paquetes y dejan huecos donde hay NA. Los promedios usan únicamente valores numéricos de cada sensor. El historial paginado conserva los paquetes de la sesión en memoria. Reiniciar Node borra historial y actividad. El historial ML y sus datos crudos se conservan aparte en .local/ml.sqlite y .local/telemetry.jsonl; no se cargan datos de ejemplo en el dashboard.

El pH ya se calibra en el Sender: no se aplica calibración adicional. La conductividad se muestra en **mS/cm y con tres decimales**, con la descripción **Conductividad estimada — calibración en verificación**. El Sender ya convierte y ajusta la lectura mediante una calibración provisional de un punto: solución estándar de 1413 µS/cm (1.413 mS/cm), factor provisional 9.576. La web conserva el número recibido: no divide entre 1000, no aplica ese factor y no convierte conductividad a salinidad. Esta calibración no se presenta como validada definitivamente. La hora corresponde a recepción en el PC y se muestra en America/Lima.

El cliente consulta `/api/state` cada dos segundos, con cursor incremental y detección de nueva sesión. El transporte ya no depende de SSE: `/api/events` informa su sustitución. El aviso sin paquetes se configura en pantalla entre 5 y 3600 segundos (valor inicial STALE_SECONDS en `.env`).

## Acceso remoto mediante Quick Tunnel

El PC principal debe permanecer encendido, con Internet, Node ejecutándose y el Receiver conectado. Los celulares visitantes solo necesitan navegador. No se despliega otro backend ni se abre el servidor de Vite al público.

Instala cloudflared en el propio proyecto desde el ejecutable oficial de Cloudflare (Windows x64):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-cloudflared.ps1
npm run remote
```

El instalador descarga desde el [repositorio oficial de Cloudflare](https://github.com/cloudflare/cloudflared/releases/latest). No requiere instalar un servicio de Windows ni modificar PATH; el binario queda en tools, ignorado por Git. Para Windows de otra arquitectura utiliza la [descarga oficial correspondiente](https://developers.cloudflare.com/tunnel/downloads/) y deja el ejecutable como `tools/cloudflared.exe`, o instala cloudflared en PATH.

`npm run remote` conserva los usuarios existentes, compila React, inicia Express y ejecuta `cloudflared tunnel --url http://127.0.0.1:PORT`. No ejecutes a la vez npm start/npm run dev. La consola muestra una URL HTTPS temporal real `https://...trycloudflare.com` cuando Cloudflare la devuelve. Esa URL se registra en `.local/tunnel.json` y se autoriza mientras su proceso permanezca activo. También se admiten exclusivamente los orígenes exactos de la lista `config/access.json`, para túneles iniciados manualmente. No se permiten dominios arbitrarios ni allowedHosts:true. Todas las solicitudes usan rutas relativas `/api`, por lo que frontend, autenticación, polling y WhatsApp comparten origen. Las cookies remotas son Secure, HttpOnly y SameSite=Strict. No copies una URL localhost al teléfono.

### Corregir Host no autorizado y permitir otro enlace temporal

El middleware de `server/auth.js` valida Host mediante `server/origins.js`. Un cloudflared iniciado manualmente no crea `.local/tunnel.json`; por eso, antes de esta corrección, podía generar un enlace que el backend rechazaba.

La lista explícita está en `config/access.json`, separada de `.env`:

```json
{
  "allowedRemoteOrigins": [
    "https://scott-exit-republican-governmental.trycloudflare.com"
  ]
}
```

Cuando cambie el enlace, sustituye ese origen o añade otro elemento al array. Utiliza el origen HTTPS completo, sin barra final, ruta, puerto, credenciales ni comodines. Se admiten solo subdominios exactos de trycloudflare.com. Elimina los enlaces anteriores cuando dejes de usarlos. La lista se relee en cada solicitud, por lo que sus cambios no necesitan reiniciar Node una vez instalada esta versión del middleware. Un JSON inválido no amplía el acceso: los dominios de esa lista quedan denegados hasta corregirlo; localhost/127.0.0.1 siguen disponibles.

Host no es autenticación: aceptar un dominio únicamente permite llegar a la aplicación. COM y WhatsApp conservan sus permisos. Los POST remotos deben llevar Origin igual al origen HTTPS de ese Host, además de la sesión y token CSRF para acciones protegidas. Las sesiones remotas se vinculan al dominio donde se iniciaron. No se confía en X-Forwarded-Host ni se autoriza todo *.trycloudflare.com. Mantén el Host público original al usar cloudflared; no lo sustituyas por localhost con --http-host-header.

Para cargar por primera vez la corrección conservando el enlace ya activo:

1. Mantén abierta la terminal del cloudflared que generó el enlace actual.
2. En la terminal de Node, pulsa Ctrl+C y, desde yakutoring-app, ejecuta `npm run build` y `npm start`.
3. Abre de nuevo el enlace HTTPS, inicia sesión otra vez y conecta el COM desde la cuenta admin si fuera necesario. Reiniciar Node borra el historial de sesión y libera el USB.

Si utilizas el lanzador integrado, detén su terminal con Ctrl+C y ejecuta `npm run remote`. Ese reinicio crea una URL nueva y la registra automáticamente; comparte el nuevo enlace. No es necesario cambiar el token de WhatsApp ni sobrescribir `.env`.

La URL abre la pantalla de acceso. Solo las cuentas autorizadas pueden consultar el observatorio y sus API. Entrega a cada operador sus propias credenciales por un canal privado.

Para detener el túnel y Node, pulsa Ctrl+C en su terminal. También puedes hacerlo desde otra PowerShell dentro del proyecto:

```powershell
npm run remote:stop
```

Al detenerse el proceso cloudflared, el enlace deja de funcionar y se elimina el origen autorizado. Cada arranque crea otra URL. El archivo stop-tunnel es una señal local al lanzador, no un endpoint público. No mates solo el lanzador con el Administrador de tareas: si fuera necesario, comprueba que también terminó su proceso cloudflared. El lanzador y el backend validan que el proceso registrado siga activo.

Quick Tunnel es para pruebas, no tiene garantía de disponibilidad y no admite SSE; por eso se usa polling. Referencia: [Quick Tunnels, documentación oficial](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/). Si cloudflared ya tiene `%USERPROFILE%\.cloudflared\config.yml` o config.yaml, revisa si interfiere con Quick Tunnel y conserva una copia antes de cambiarlo. Un firewall puede bloquear la conexión saliente de cloudflared (puerto 7844); no es necesario publicar un puerto entrante del router.

## Permisos y seguridad

| Acceso               | Dashboard e historial de sensores | Puertos y conectar/desconectar | Plantillas y enviar WhatsApp |
| -------------------- | --------------------------------- | ------------------------------ | ---------------------------- |
| Visitante sin sesión | No                                | No                             | No                           |
| operator             | Sí                                | No                             | Sí, manual                   |
| admin                | Sí                                | Sí                             | Sí, manual                   |

El backend aplica los permisos en cada endpoint; ocultar botones solo refleja los permisos. La actividad de mensajes y el destinatario configurado no se incluyen en la respuesta anónima. Las sesiones caducan a las ocho horas y se invalidan al cerrar sesión o reiniciar Node. Las acciones requieren cookie de sesión, token CSRF y Origin permitido. Se limitan los intentos de login. No se confía en X-Forwarded-Host para permitir dominios. Express sigue enlazado a 127.0.0.1 y solo sirve dist; .env, .local y código del backend no son archivos públicos.

Para revocar todas las sesiones reinicia Node. Para regenerar usuarios, detén Node, mueve los archivos users.json y credenciales.txt fuera de .local a una ubicación privada y ejecuta auth:setup. No hay contraseñas predeterminadas en el código. No introduzcas credenciales en la URL ni en React.

## WhatsApp conservado

Se conservan `.env`, token, identificadores, destinatario autorizado y estos nombres exactos:

- yakutoring_alerta_prueba: texto fijo, sin componentes body.
- yakutoring_alerta_ambiental: parámetro, valor y fecha/hora.
- yakutoring_posible_riesgo_ambiental: parámetro, valor, persistencia manual y fecha/hora.
- yakutoring_reporte_diario: los ocho campos aprobados en su orden original.

En las dos alertas con variables se puede seleccionar temperatura, pH, conductividad eléctrica (mS/cm) o presión. Se toma la última lectura numérica disponible del parámetro, con su fecha visible: puede ser anterior al último paquete si este contiene NA. Revisa la antigüedad antes de confirmar. Si no hay una lectura válida el valor queda vacío; puedes introducir un dato manual de prueba y marcar simulación. Para conductividad, tanto la selección como la lectura de las alertas utilizan tres decimales (por ejemplo, `1.363 mS/cm`). No se envía nada automáticamente.

El reporte toma temperatura y pH reales del periodo (hoy en Perú o toda la sesión), excluyendo NA por separado; el número de mediciones representa paquetes recibidos, no el número de lecturas válidas de todos los sensores. El backend contrasta promedio y cantidad antes de enviar. Sin temperaturas válidas no se inventa un promedio y el reporte queda bloqueado. Si faltan lecturas de pH puede introducirse una simulación. Salinidad en ppt y oxígeno disuelto en mg/L siguen sin medirse y requieren datos simulados identificados; conductividad en mS/cm y presión no se agregan a una plantilla cuya estructura aprobada no los contempla. La nueva sección ML estima OD como resultado experimental independiente; este formulario conserva su contenido manual. No hay evaluación ambiental ni detección automática de anomalías.

El backend consulta el idioma exacto APPROVED de Meta al revisar y al enviar: no asume es ni es_PE. Conserva WHATSAPP_TEMPLATE_LANGUAGE y WHATSAPP_API_VERSION configurables. Para una instalación nueva, copia `.env.example` a `.env` e introduce los identificadores y el token en el backend. Usa permisos whatsapp_business_management y whatsapp_business_messaging. Referencias: [plantillas, colección oficial Meta](https://www.postman.com/meta/whatsapp-business-platform/request/o65u5m5/send-message-template-text) y [versiones Graph API](https://developers.facebook.com/docs/graph-api/changelog/).

Un identificador devuelto por Meta significa solicitud aceptada, no entrega. Un timeout deja resultado incierto: comprueba Meta/WhatsApp antes de repetir. Se mantiene la idempotencia por intento y el bloqueo de envíos simultáneos. La entrega definitiva requiere un webhook posterior. El token nunca se devuelve al navegador ni se incluye en logs. Los errores externos se resumen sin devolver respuestas crudas de Meta.

## Pruebas y diagnóstico

```powershell
npm test
npm run build
# Con el backend iniciado y los usuarios preparados:
npm run test:local
# Prueba física explícita: ocupa y libera COM16, no envía WhatsApp:
node scripts/check-serial.js COM16
```

Las pruebas unitarias usan líneas sintéticas y un servidor de autenticación temporal, sin mostrar esas lecturas en el dashboard ni llamar a Meta. test:local consulta el servidor real, comprueba endpoints protegidos y archivos privados, pero no abre COM ni envía mensajes. check-serial necesita el puerto libre y observa 20 segundos, reconecta y observa otros 10, guarda evidencia real y libera el puerto. No ejecutarlo durante una exposición en curso.

- Puerto ocupado: cierra Monitor Serial, Plotter y otras aplicaciones seriales. No abras dos procesos backend a la vez.
- No aparece COM: cable de datos, controlador USB y Administrador de dispositivos.
- Conectado sin lecturas: alimentación y enlace LoRa, 915 MHz, formato DATA exacto y salto de línea. No hay datos ficticios de respaldo.
- NA: sensor sin lectura válida. Revisa el sensor/firmware; no se rellena con cero.
- Mensaje 401/403: inicia sesión con el rol adecuado; si expiró, vuelve a entrar. La sesión localhost no se reutiliza automáticamente en el dominio HTTPS.
- Meta 190: token vencido o inválido; 10/200: permisos; 132001: nombre o idioma. No sustituyas el token a través del frontend.
- Túnel sin URL: revisa instalación, Internet, configuración y firewall. El lanzador informa un timeout; no inventa un enlace.

Consulta VERIFICACION.md para distinguir pruebas realmente ejecutadas de las pendientes. La conexión física desde un celular en otra red requiere que una persona abra la URL; no se afirma verificada sin observarla.
