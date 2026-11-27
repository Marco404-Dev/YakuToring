# Instalación y despliegue

## Render

1. En Render, crea un **Blueprint** a partir de `Marco404-Dev/YakuToring`, rama `main`, archivo `render.yaml`. La configuración gratuita usa SQLite temporal y puede perder capturas en un reinicio o despliegue.
2. Copia a `YAKUTORING_FRONTEND_ORIGIN` el origen HTTPS exacto de Vercel, por ejemplo `https://tu-proyecto.vercel.app`. Deja que Render establezca `PORT` y `RENDER_EXTERNAL_URL`. El indicador de salud es `/healthz`.
3. Configura como variable secreta `YAKUTORING_USERS_JSON` un JSON de cuentas con hashes scrypt generado por `node scripts/setup-auth.js`. Utiliza una cuenta exclusiva de demostración y guarda sus credenciales en privado. Cada reinicio invalida las sesiones web.
4. Descarga los CSV de cualquier sesión de interés. Para conservar archivos entre reinicios, mantén una estación local o migra a un servicio con disco persistente y respaldo SQLite.
5. CatBoost y las referencias se cargan desde archivos versionados. El contenedor por defecto usa CatBoost y no instala PyTorch. Para habilitar MLP e híbridos, usa una compilación con `INSTALL_TORCH=1` y verifica el presupuesto de memoria. Valida los primeros arranques y amplía la instancia si lo requieren las métricas.
6. WhatsApp es opcional. Usa el grupo `WHATSAPP_*` de `.env.example` como referencia. Configura el webhook directamente en el origen HTTPS de Render si necesitas estados de entrega. Guarda todos los valores privados como secretos de Render.

[Blueprint de Render](https://render.com/docs/blueprint-spec) · [Discos persistentes](https://render.com/docs/disks) · [Docker en Render](https://render.com/docs/docker)

## Vercel

1. Importa el mismo repositorio y selecciona **Vite**. Usa la raíz del repositorio, Node 24, `npm ci`, `npm run build` y salida `dist`.
2. En `vercel.json`, confirma que `rewrites[0].destination` sea `https://<servicio-render>.onrender.com/api/:path*`. Si Render asignó otro nombre, actualiza ese valor y vuelve a desplegar.
3. Los navegadores llaman a `/api` en el mismo origen de Vercel. El proxy conserva el flujo de cookies HttpOnly y CSRF. Render valida el origen exacto que configuraste. No se requieren variables públicas `VITE_*`. Autoriza los orígenes de vista previa únicamente de forma deliberada.
4. Comprueba que una solicitud anónima a `/api/state` devuelva 401 y que el login y la lectura funcionen desde la URL publicada.

[Rewrites externos en Vercel](https://vercel.com/docs/routing/rewrites)

## Receiver por HTTPS

En el equipo con el Receiver, define `YAKUTORING_AGENT_URL=https://<servicio-render>.onrender.com` y el mismo `YAKUTORING_INGEST_TOKEN` generado en Render. Ejecuta `node scripts/heltec-agent.js COM16` desde la raíz, sustituyendo el puerto real. Cierra el monitor serial y libera el puerto en la app local antes de abrir el agente. El servicio deduce la conexión de paquetes LoRa válidos y marca desconexión al dejar de recibirlos. El agente actual alerta de lotes fallidos y los descarta. El modo USB local se conserva con `YAKUTORING_SERIAL_MODE=local`.

## Datasets y modelos futuros

`config/environments.json` registra dataset, unidades, referencias y artefactos. Para el cálculo automático de una estación usa `YAKUTORING_MONITOR_ENVIRONMENT`. Cambiar el selector web actúa sobre la vista. El perfil personalizado modifica umbrales.

Importación offline con originales y Parquet en `ml/datasets/`, directorio ignorado por Git.

```powershell
.\.venv-ml\Scripts\python.exe -m pip install pyarrow==21.0.0
.\.venv-ml\Scripts\python.exe ml/import_environment.py --source ruta.csv --output ml/datasets/humedal/normalizado.parquet --environment humedal --provenance "Campaña y responsable"
.\.venv-ml\Scripts\python.exe ml/train_environment.py --source ml/datasets/humedal/normalizado.parquet --environment humedal --version humedal-v1 --output ml/environment_models/humedal --holdout-from 2026-01-01 --algorithm minibatch --features temperatura_agua_C pH conductividad_especifica_mS_cm
```

La importación trabaja en lotes de 25.000 filas. Reconoce conductividad en µS/cm y presión en Pa por el nombre explícito de sus columnas, guarda huella SHA‑256 y resume faltantes. Usa `--mapping` para equivalencias adicionales y `--synthetic` para ensayos sintéticos. El CSV de inferencia continúa limitado a 12.000 caracteres y 100 filas. El formulario de archivos pequeños conserva su límite independiente.

Después de verificar el nuevo artefacto, agrega rutas relativas a `ml`, versión, estados y SHA‑256 de CatBoost al registro. El cargador usa el contrato de características de CatBoost actual. La variante sin conductividad requiere artefacto compatible, bandera `reduced` y selección explícita. El clustering excluye OD como entrada y lo utiliza si está disponible para caracterizar grupos. Para laboratorio exige identificadores independientes y rechaza muestras que cruzan el corte temporal. Los datos sintéticos marcados se excluyen del entrenamiento de referencia.

Los artefactos de Florida se preservan como referencia provisional de NOAA NERRS SWMP/CDMO. El conjunto de entrenamiento publicado en forma de métricas y agregados describe Florida y requiere verificación adicional de sus estaciones y hábitats. Los originales locales quedan separados. [Archivo NOAA](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.nodc%3ANERRS-SWMP) · [Política CDMO](https://cdmo.baruch.sc.edu/data/policy.cfm)
