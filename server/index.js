import express from "express";
import dotenv from "dotenv";
import { SerialPort } from "serialport";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import { PacketParser } from "./parser.js";
import { templates, payload, diagnosticValues } from "./templates.js";
import { validateReport } from "./report.js";
import { installSecurity } from "./auth.js";
import { MLClient } from "./ml-client.js";
import { Collection } from "./collection.js";
import { normalizeConductivity } from "./conductivity.js";
import { installEnvironmentRoutes } from "./environment.js";
import { AnomalyLog } from "./anomaly-log.js";
import {
  updateDeliveries,
  verifySignature,
  webhookPath,
} from "./whatsapp-webhook.js";
const root = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: path.join(root, ".env"), quiet: true });
const env = process.env;
const conductivityUnit = env.YAKUTORING_EC_INPUT_UNIT || "uS/cm";
normalizeConductivity({}, conductivityUnit);
const portNumber = Number(env.PORT || 3001);
const app = express();
app.disable("x-powered-by");
const parseJson = express.json({ limit: "16kb" });
app.use((req, res, next) =>
  req.path === webhookPath ? next() : parseJson(req, res, next),
);
const permissions = installSecurity(app, root, portNumber);
app.use("/api", permissions.sender);
const databasePath = path.resolve(
  root,
  env.YAKUTORING_ML_DB_PATH || ".local/ml.sqlite",
);
const collection = new Collection(databasePath);
const anomalyLog = new AnomalyLog(databasePath);
const ml = new MLClient(root, { databasePath });
installEnvironmentRoutes(app, root, permissions, ml);
let serial,
  busy = false,
  buffer = "",
  connectedAt = null;
let status = { connected: false, path: null, error: null };
let collectionError = null;
const readings = [],
  odUpdates = [],
  attempts = [],
  requests = new Map();
const sessionId = crypto.randomUUID();
collection.db.exec(
  "CREATE TABLE IF NOT EXISTS whatsapp_diagnostics (id TEXT PRIMARY KEY, at TEXT NOT NULL, result TEXT NOT NULL)",
);
const saveAttempt = collection.db.prepare(
  "INSERT OR REPLACE INTO whatsapp_diagnostics VALUES (?,?,?)",
);
for (const row of collection.db
  .prepare("SELECT result FROM whatsapp_diagnostics ORDER BY at DESC LIMIT 50")
  .all()) {
  const item = JSON.parse(row.result);
  if (item.pending) {
    item.pending = false;
    item.status = "Interrumpido; estado de entrega desconocido";
  }
  attempts.push(item);
  requests.set(item.requestId, item);
}
app.get(webhookPath, (req, res) => {
  const token = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (
    !token ||
    !env.WHATSAPP_APP_SECRET ||
    req.query["hub.mode"] !== "subscribe" ||
    req.query["hub.verify_token"] !== token ||
    typeof req.query["hub.challenge"] !== "string"
  )
    return res.sendStatus(403);
  res.type("text/plain").send(req.query["hub.challenge"]);
});
app.post(
  webhookPath,
  express.raw({ type: "application/json", limit: "256kb", inflate: false }),
  (req, res) => {
    if (
      !verifySignature(
        env.WHATSAPP_APP_SECRET,
        req.body,
        req.get("X-Hub-Signature-256"),
      )
    )
      return res.sendStatus(403);
    let body;
    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.sendStatus(400);
    }
    updateDeliveries(
      body,
      env.WHATSAPP_PHONE_NUMBER_ID,
      (messageId) => attempts.find((item) => item.messageId === messageId),
      (item) => saveAttempt.run(item.requestId, item.at, JSON.stringify(item)),
    );
    res.sendStatus(200);
  },
);
const staleSeconds = Math.min(
  3600,
  Math.max(5, Number(env.STALE_SECONDS) || 30),
);
function snapshot(req) {
  const after = Number(req.query.after || 0),
    same = req.query.sessionId === sessionId,
    odAfter = Number(req.query.odAfter),
    selected = Number(req.query.collectionId);
  return {
    sessionId,
    status,
    connectedAt,
    readings: same ? readings.filter((r) => r.id > after) : readings,
    odUpdates:
      same && Number.isSafeInteger(odAfter) && odAfter >= 0
        ? odUpdates.slice(odAfter)
        : [],
    odCursor: odUpdates.length,
    attempts: req.session ? attempts : [],
    staleSeconds,
    anomalyThreshold: anomalyLog.threshold,
    count: readings.length,
    ml: ml.state,
    collection: {
      ...collection.snapshot(),
      error: collectionError,
      ...(Number.isSafeInteger(selected) && selected > 0
        ? { selected, measurements: collection.measurements(selected) }
        : {}),
    },
  };
}
function broadcast() {} // Polling HTTP compatible con Quick Tunnel.
app.get("/api/experiments/runs", permissions.sender, async (req, res, next) => {
  try {
    const before =
      req.query.before === undefined ? null : Number(req.query.before);
    if (before !== null && (!Number.isSafeInteger(before) || before < 1)) {
      throw new Error("Cursor de mediciones inválido.");
    }
    res.json(await ml.request("comparison_runs", { before }));
  } catch (error) {
    next(error);
  }
});
const parser = new PacketParser((raw) => {
  const row = normalizeConductivity(raw, conductivityUnit);
  row.id = readings.length + 1;
  readings.push(row);
  try {
    const current = readings
      .slice(-34)
      .filter((item) => !connectedAt || item.at >= connectedAt);
    anomalyLog.accept(current);
  } catch (error) {
    console.error("Error al registrar anomalías:", error.message);
  }
  try {
    const captureId = collection.accept(row);
    if (captureId) row.captureId = captureId;
    collectionError = null;
  } catch (error) {
    console.error("Error SQLite al registrar una medición:", error.message);
    collectionError =
      "No se pudo guardar una medición de la sesión. Revisa el almacenamiento del backend.";
  }
  ml.ingest(row).then((snapshot) => {
    const od = snapshot?.liveOD;
    if (od?.at !== row.at || od.packet !== (row.packet ?? null)) return;
    const update = { id: row.id, od_estimado_mg_l: od.models.catboost.value };
    row.od_estimado_mg_l = update.od_estimado_mg_l;
    odUpdates.push(update);
  });
});
app.get("/api/environment/anomalies", (_, res) =>
  res.json(anomalyLog.snapshot()),
);
app.post(
  "/api/environment/anomalies/tolerance",
  permissions.admin,
  (req, res) => {
    anomalyLog.setTolerance(req.body.value);
    res.json(anomalyLog.snapshot());
  },
);
app.post(
  "/api/environment/anomalies/settings",
  permissions.admin,
  (req, res) => {
    anomalyLog.configure(req.body?.threshold);
    res.json(anomalyLog.snapshot());
  },
);
app.post(
  "/api/environment/anomalies/:id/review",
  permissions.sender,
  (req, res) => {
    anomalyLog.review(Number(req.params.id));
    res.json(anomalyLog.snapshot());
  },
);
app.post(
  "/api/experiments/sessions",
  permissions.sender,
  async (req, res, next) => {
    try {
      res.json(await ml.request("experiment_create", { name: req.body.name }));
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/experiments/samples",
  permissions.sender,
  async (req, res, next) => {
    try {
      const { sessionId, runId, metadata } = req.body;
      res.json(
        await ml.request("experiment_sample", { sessionId, runId, metadata }),
      );
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/experiments/reference",
  permissions.sender,
  async (req, res, next) => {
    try {
      const { sampleId, value, at } = req.body;
      res.json(
        await ml.request("experiment_reference", { sampleId, value, at }),
      );
    } catch (error) {
      next(error);
    }
  },
);
app.get(
  "/api/experiments/:id/export.csv",
  permissions.sender,
  async (req, res, next) => {
    try {
      if (!/^[a-f0-9-]{36}$/.test(req.params.id))
        throw new Error("Sesión inválida.");
      const result = await ml.request("experiment_export", {
        sessionId: req.params.id,
      });
      res
        .set({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="YakuToring_Experimento_${req.params.id}.csv"`,
        })
        .send(result.csv);
    } catch (error) {
      next(error);
    }
  },
);
function collectionId(req) {
  if (
    !/^\d+$/.test(req.params.id) ||
    !Number.isSafeInteger(Number(req.params.id))
  ) {
    throw new Error("El identificador de sesión es inválido.");
  }
  return Number(req.params.id);
}
app.post("/api/collection/start", permissions.sender, (req, res) => {
  parser.flush();
  res.status(201).json({ id: collection.start(req.body) });
});
app.post("/api/collection/:id/finish", permissions.sender, (req, res) => {
  const id = collectionId(req);
  parser.flush();
  collection.finish(id);
  res.json({ id });
});
app.get("/api/collection/:id/measurements", permissions.sender, (req, res) => {
  const id = collectionId(req);
  const session = collection.snapshot().sessions.find((item) => item.id === id);
  if (!session)
    return res.status(404).json({ error: "No se encontró la sesión." });
  const rows = collection.measurements(id);
  const events = rows.length
    ? anomalyLog.between(Date.parse(rows[0].at), Date.parse(rows.at(-1).at))
    : [];
  res.json({ session, rows, events });
});
app.post("/api/collection/:id/pause", permissions.sender, (req, res) => {
  const id = collectionId(req);
  parser.flush();
  collection.pause(id);
  res.json({ id });
});
app.post("/api/collection/:id/resume", permissions.sender, (req, res) => {
  const id = collectionId(req);
  parser.flush();
  collection.resume(id);
  res.json({ id });
});
app.get(
  "/api/collection/:id/export.csv",
  permissions.sender,
  async (req, res) => {
    const id = collectionId(req);
    // La barrera permite incluir el último resultado OD si aún se está calculando.
    if (ml.pending.size) await ml.request("snapshot").catch(() => {});
    const { csv, filename } = collection.export(id);
    res
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      })
      .send(csv);
  },
);
app.get("/api/ml/state", (_, res) => res.json(ml.state));
app.get("/api/ml/od/demo", async (_, res, next) => {
  try {
    res.set("Cache-Control", "no-store").json(await ml.request("od_demo"));
  } catch (error) {
    next(error);
  }
});
app.post("/api/ml/od/reference", permissions.sender, async (req, res, next) => {
  try {
    const { measurementId, value } = req.body ?? {};
    const result = await ml.request("od_reference", { measurementId, value });
    res.json(result.experimentalOd);
  } catch (error) {
    next(error);
  }
});
app.post("/api/ml/settings", permissions.admin, async (req, res, next) => {
  try {
    res.json(await ml.request("configure", { settings: req.body }));
  } catch (e) {
    next(e);
  }
});
app.get("/api/ml/export.csv", permissions.sender, async (_, res, next) => {
  try {
    const result = await ml.request("export");
    res
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="YakuToring-validacion-OD.csv"',
      })
      .send("\uFEFF" + result.csv);
  } catch (e) {
    next(e);
  }
});
app.get("/api/state", (req, res) => res.json(snapshot(req)));
app.get("/api/events", (_, res) =>
  res.status(410).json({
    error: "Utilice /api/state: el transporte ahora es polling HTTP.",
  }),
);
app.get("/api/ports", permissions.admin, async (_, res, next) => {
  try {
    res.json(await SerialPort.list());
  } catch {
    next(
      new Error(
        "No se pudo consultar los puertos seriales. Revise los controladores USB.",
      ),
    );
  }
});
app.post("/api/connect", permissions.admin, async (req, res, next) => {
  if (busy || serial)
    return res
      .status(409)
      .json({ error: "Ya hay una conexión o una operación en curso." });
  busy = true;
  try {
    const ports = await SerialPort.list();
    if (
      typeof req.body.path !== "string" ||
      !ports.some((p) => p.path === req.body.path)
    )
      throw new Error("Seleccione un puerto disponible y actualice la lista.");
    parser.reset();
    buffer = "";
    const device = new SerialPort({
      path: req.body.path,
      baudRate: 115200,
      autoOpen: false,
      lock: true,
    });
    serial = device;
    device.on("error", () => {
      status.error =
        "Error USB/serial. Cierre el Monitor Serial de Arduino y compruebe el cable.";
      try {
        anomalyLog.add("usb", "Error de comunicación USB/serial", Date.now());
      } catch (error) {
        console.error("Error al registrar comunicación:", error.message);
      }
      broadcast();
    });
    device.on("close", () => {
      parser.reset();
      buffer = "";
      serial = undefined;
      status = {
        ...status,
        connected: false,
        error: "Puerto cerrado. Compruebe el USB antes de reconectar.",
      };
      broadcast();
    });
    device.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop();
      if (buffer.length > 8192) buffer = "";
      for (const line of lines) parser.feed(line);
    });
    await new Promise((resolve, reject) =>
      device.open((err) => (err ? reject(err) : resolve())),
    );
    connectedAt = new Date().toISOString();
    status = { connected: true, path: req.body.path, error: null };
    broadcast();
    res.json(status);
  } catch {
    serial = undefined;
    status = {
      connected: false,
      path: null,
      error:
        "No se pudo abrir el puerto. Cierre el Monitor Serial y el Serial Plotter de Arduino u otra aplicación que lo use; revise el cable y actualice los puertos.",
    };
    broadcast();
    next(new Error(status.error));
  } finally {
    busy = false;
  }
});
app.post("/api/disconnect", permissions.admin, async (_, res, next) => {
  if (busy)
    return res.status(409).json({ error: "Operación serial en curso." });
  busy = true;
  try {
    if (serial?.isOpen)
      await new Promise((resolve, reject) =>
        serial.close((e) => (e ? reject(e) : resolve())),
      );
    status = { connected: false, path: null, error: null };
    broadcast();
    res.json(status);
  } catch {
    next(new Error("No se pudo cerrar el puerto."));
  } finally {
    busy = false;
  }
});
function configCheck() {
  if (!env.WHATSAPP_ACCESS_TOKEN)
    throw new Error(
      "Introduzca WHATSAPP_ACCESS_TOKEN en .env y reinicie el backend.",
    );
  if (
    !/^v\d+\.0$/.test(env.WHATSAPP_API_VERSION || "") ||
    !/^\d+$/.test(env.WHATSAPP_WABA_ID || "") ||
    !/^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID || "") ||
    !/^\d{8,15}$/.test(env.WHATSAPP_RECIPIENT || "")
  )
    throw new Error(
      "Revise versión, WABA, Phone Number ID y destinatario en .env.",
    );
}
async function graph(endpoint, body) {
  configCheck();
  let response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${endpoint}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      },
    );
  } catch {
    throw new Error(
      body
        ? "Resultado incierto: no hubo respuesta de Meta. Revise WhatsApp/Meta antes de intentar otro envío."
        : "No fue posible consultar Meta. Compruebe Internet y vuelva a verificar.",
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const code = data.error?.code;
    throw new Error(
      `Meta rechazó la solicitud${Number.isInteger(code) ? ` (código ${code})` : ""}. ${code === 190 ? "Token vencido o inválido." : code === 10 || code === 200 ? "Revise permisos de administración y mensajería." : code === 132001 ? "Revise nombre e idioma de la plantilla." : "Revise permisos, plantilla aprobada, parámetros y destinatario autorizado en Meta."}`,
    );
  }
  return data;
}
async function verify(template) {
  const data = await graph(
    `${env.WHATSAPP_WABA_ID}/message_templates?name=${template.name}&fields=name,language,status,components&limit=100`,
  );
  const matches = (data.data || []).filter(
    (t) =>
      t.name === template.name &&
      t.status === "APPROVED" &&
      /^es(?:_|$)/.test(t.language) &&
      (!env.WHATSAPP_TEMPLATE_LANGUAGE ||
        t.language === env.WHATSAPP_TEMPLATE_LANGUAGE),
  );
  if (matches.length !== 1)
    throw new Error(
      "No se encontró un único idioma aprobado. Verifique permisos y WHATSAPP_TEMPLATE_LANGUAGE en .env con el código exacto de Meta.",
    );
  const t = matches[0];
  const body = t.components?.find((c) => c.type === "BODY");
  const variables = [
    ...new Set(body?.text?.match(/\{\{\d+\}\}/g) || []),
  ].sort();
  if (
    variables.length !== template.fields.length ||
    variables.some((v, i) => v !== `{{${i + 1}}}`) ||
    t.components?.some(
      (c) =>
        c.type === "HEADER" && (c.format !== "TEXT" || c.text?.includes("{{")),
    ) ||
    t.components?.some((c) => c.type === "BUTTONS")
  )
    throw new Error(
      "La estructura aprobada difiere de la configurada. Revise los componentes en Meta antes de enviar.",
    );
  return { language: t.language, text: body?.text || "" };
}
const maskedRecipient = () =>
  env.WHATSAPP_RECIPIENT ? `•••• ${env.WHATSAPP_RECIPIENT.slice(-4)}` : null;
app.get("/api/templates", permissions.sender, (_, res) => {
  let configurationError = null;
  try {
    configCheck();
  } catch (error) {
    configurationError = error.message;
  }
  res.json({
    templates,
    recipient: maskedRecipient(),
    configured: !configurationError,
    configurationError,
  });
});
app.post(
  "/api/templates/verify",
  permissions.sender,
  async (req, res, next) => {
    try {
      const t = templates.find((t) => t.name === req.body.name);
      if (!t) throw new Error("Plantilla desconocida.");
      res.json(await verify(t));
    } catch (e) {
      next(e);
    }
  },
);
app.post("/api/messages", permissions.sender, async (req, res, next) => {
  const { requestId, name, values, confirmed, simulated, diagnostic } =
    req.body ?? {};
  if (
    typeof requestId !== "string" ||
    !/^[\da-f-]{36}$/i.test(requestId) ||
    confirmed !== true
  )
    return res
      .status(400)
      .json({ error: "Se requiere confirmación e identificador válido." });
  if (requests.has(requestId)) {
    const existing = requests.get(requestId);
    return res.status(existing.pending ? 409 : 200).json(existing);
  }
  if ([...requests.values()].some((r) => r.pending))
    return res
      .status(409)
      .json({ error: "Hay un envío en curso. Espere el resultado." });
  const t = templates.find((t) => t.name === name);
  try {
    payload(t, values, "verified", env.WHATSAPP_RECIPIENT);
    if (t.name === "yakutoring_reporte_diario")
      validateReport(
        values,
        readings,
        req.body.period,
        req.body.reportUntil,
        simulated,
      );
  } catch (e) {
    return next(e);
  }
  if (
    diagnostic === true &&
    attempts.some(
      (item) => item.diagnostic && Date.now() - Date.parse(item.at) < 30000,
    )
  )
    return res
      .status(429)
      .json({ error: "Espera 30 segundos antes de repetir una prueba." });
  const attempt = {
    requestId,
    name,
    recipient: maskedRecipient(),
    at: new Date().toISOString(),
    pending: true,
    status: "Verificando en Meta",
    simulated: simulated === true,
    diagnostic: diagnostic === true,
    delivery: "desconocido",
  };
  requests.set(requestId, attempt);
  attempts.unshift(attempt);
  attempts.splice(50);
  saveAttempt.run(requestId, attempt.at, JSON.stringify(attempt));
  broadcast();
  try {
    const verified = await verify(t);
    if (diagnostic === true && !values.length && !/prueba/i.test(verified.text))
      throw new Error(
        "La plantilla fija aprobada debe identificar explícitamente el mensaje como prueba.",
      );
    attempt.status = "Enviando";
    broadcast();
    const data = await graph(
      `${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      payload(
        t,
        diagnostic === true ? diagnosticValues(name, values) : values,
        verified.language,
        env.WHATSAPP_RECIPIENT,
      ),
    );
    attempt.messageId = data.messages?.[0]?.id;
    attempt.status = attempt.messageId
      ? "Solicitud aceptada por Meta; entrega sin confirmar"
      : "Respuesta sin identificador; entrega sin confirmar";
  } catch (e) {
    attempt.status = e.message;
  } finally {
    attempt.pending = false;
    saveAttempt.run(requestId, attempt.at, JSON.stringify(attempt));
    broadcast();
    res.json(attempt);
  }
});
app.use(express.static(path.join(root, "dist")));
app.use((err, req, res, next) => {
  res.status(400).json({
    error:
      err instanceof SyntaxError
        ? "JSON inválido."
        : String(err.message).replaceAll(
            env.WHATSAPP_ACCESS_TOKEN || "__NO_TOKEN__",
            "[oculto]",
          ),
  });
});
const server = app.listen(portNumber, "127.0.0.1", () =>
  console.log(`YakuToring: http://127.0.0.1:${portNumber}`),
);
process.on("SIGINT", () => {
  ml.close();
  parser.reset();
  if (serial?.isOpen) serial.close();
  server.close(() => process.exit(0));
});
process.on("exit", () => ml.close());
