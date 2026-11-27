// Integration fixture isolated from field sessions and physical USB ports.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { MLClient } from "../server/ml-client.js";
import { PacketParser } from "../server/parser.js";
import { normalizeConductivity } from "../server/conductivity.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const local = path.join(root, ".local");
fs.mkdirSync(local, { recursive: true });
const temp = fs.mkdtempSync(path.join(local, "COMPARACION-SIMULADA-"));
const databasePath = path.join(temp, "simulada.sqlite");
const ml = new MLClient(root, {
  databasePath, telemetryPath: path.join(temp, "simulada.jsonl"),
  activeModels: "catboost,mlp,weighted,stacking,reduced", provisionalEC: true,
});
let runId;
try {
  for (let i = 0; i < 400 && ml.state.status === "starting"; i++) await delay(100);
  assert.equal(ml.state.status, "ready");
  assert(Object.values(ml.state.comparison.availability).every(model => model.loaded));
  const manual = {
    at: "2024-02-29T17:30:00Z", temperature: 24, ph: 7.8,
    conductivity: 15, pressure: 1013,
  };
  const manualResult = (await ml.request("environment_predictions", { row: manual })).predictions[0];
  assert(Object.values(manualResult.models).every(model => Number.isFinite(model.value)));
  assert(Number.isFinite(manualResult.isolation));
  const extrapolated = (await ml.request("environment_predictions", {
    row: { ...manual, temperature: 30.06, ph: 4.71, conductivity: 1.049, pressure: 1001.33 },
  })).predictions[0];
  assert.match(extrapolated.status, /estimación extrapolada/);
  assert(Number.isFinite(extrapolated.models.catboost.value));
  const reduced = (await ml.request("environment_predictions", {
    row: { ...manual, conductivity: null }, noConductivity: true,
  })).predictions[0];
  assert(Number.isFinite(reduced.models.reduced.value));
  const operations = [];
  const parser = new PacketParser(row => operations.push(ml.ingest({
    ...normalizeConductivity(row, "uS/cm"),
    at: "2024-02-29T17:30:00Z",
  })));
  parser.feed("DATA:1,24,7.8,15000,1013");
  parser.flush();
  const result = await operations[0];
  const run = result.comparison.latest;
  runId = run.id;
  assert.equal(run.inputs.conductivity, 15);
  assert.equal(run.inputs.conductivityOriginal, 15000);
  assert(Object.values(run.models).every(model => Number.isFinite(model.value)));
} finally {
  const stopped = once(ml.child, "exit");
  ml.close();
  await stopped;
}

const port = "3194";
const base = "http://127.0.0.1:" + port;
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: root, windowsHide: true,
  env: { ...process.env, PORT: port, YAKUTORING_ML_DB_PATH: databasePath, YAKUTORING_EC_INPUT_UNIT: "uS/cm" },
  stdio: ["ignore", "pipe", "pipe"],
});
let auth = {};
async function request(route, body) {
  return fetch(base + "/api/" + route, {
    method: body ? "POST" : "GET",
    headers: { Origin: base, ...auth, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function post(route, body) {
  const response = await request(route, body);
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
try {
  await once(server.stdout, "data");
  assert.equal((await request("experiments/sessions", { name: "sin permiso" })).status, 401);
  assert.equal((await request("experiments/runs")).status, 401);
  assert.equal((await request("environment/datasets")).status, 401);
  const credentials = fs.readFileSync(path.join(local, "credenciales.txt"), "utf8");
  const password = /Usuario: admin\r?\nContraseña: ([^\r\n]+)/.exec(credentials)?.[1];
  assert(password, "Ejecuta npm run auth:setup antes de esta prueba.");
  const login = await request("auth/login", { username: "admin", password });
  assert.equal(login.status, 200);
  auth = { Cookie: login.headers.get("set-cookie").split(";")[0], "X-CSRF-Token": (await login.json()).csrf };
  for (let i = 0; i < 400; i++) {
    const state = await (await request("ml/state")).json();
    if (state.status === "ready") break;
    await delay(100);
  }
  const original = "muestra,temperatura_C\r\nSIMULADA,24\r\nSIMULADA,24\r\n";
  const importResponse = await request("environment/datasets", {
    name: "SIMULADA.csv", origin: "Laboratorio", csv: original,
  });
  assert.equal(importResponse.status, 201);
  const { id: dataset } = await importResponse.json();
  const catalog = await (await request("environment/datasets")).json();
  assert.equal(catalog.datasets[0].duplicates, 1);
  const archived = await (await request(`environment/datasets/${dataset}/original.csv`)).text();
  assert.equal(archived, original);
  const anomalies = await post("environment/anomalies/settings", { threshold: 4.5 });
  assert.equal(anomalies.threshold, 4.5);
  const created = await post("experiments/sessions", { name: "SIMULADA · prueba HTTP" });
  const sid = created.comparison.sessions[0].id;
  const runs = await (await request("experiments/runs")).json();
  assert.equal(runs.runs[0].id, runId);
  const saved = await post("experiments/samples", {
    sessionId: sid, runId,
    metadata: {
      sampleCode: "SIMULADA-01", samplingPoint: "Laboratorio simulado",
      depthM: null, collectedAt: "2024-02-29T08:00:00-05:00",
      phase: "laboratory", observations: "Datos sintéticos de integración",
    },
  });
  const sample = saved.comparison.sessions[0].samples[0];
  const frozen = JSON.stringify(sample.prediction);
  const referenced = await post("experiments/reference", {
    sampleId: sample.id, value: 7, at: "2024-02-29T12:31:00-05:00",
  });
  const session = referenced.comparison.sessions[0];
  assert.equal(JSON.stringify(session.samples[0].prediction), frozen);
  assert.equal(session.metrics.laboratory.catboost.n, 1);
  const csv = await request("experiments/" + sid + "/export.csv");
  assert.equal(csv.status, 200);
  const text = await csv.text();
  for (const key of ["catboost", "mlp", "weighted", "stacking"]) {
    assert(text.includes("od_" + key + "_mg_l"));
    assert(text.includes("error_absoluto_" + key + "_mg_l"));
  }
  assert.equal(text.trimEnd().split("\r\n").length, 2);
  console.log("Parser → normalización → Python → cuatro modelos → HTTP → referencia → MAE → CSV: correcto.");
  console.log("Base sintética aislada:", databasePath);
} finally {
  server.kill();
}
