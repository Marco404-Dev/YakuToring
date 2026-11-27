// Prueba local sin abrir COM ni enviar mensajes.
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
const root = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
const base = `http://127.0.0.1:${process.env.PORT || 3001}`;
let session = {};
async function request(route, body, headers = {}) {
  const response = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: base,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...session,
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie"),
  };
}
assert.equal((await request("/api/state")).status, 401);
for (const route of [
  "/api/connect",
  "/api/disconnect",
  "/api/messages",
  "/api/ml/od/reference",
  "/api/collection/start",
  "/api/collection/1/pause",
  "/api/collection/1/resume",
])
  assert.equal((await request(route, {})).status, 401);
for (const route of [
  "/api/ports",
  "/api/templates",
  "/api/collection/1/export.csv",
])
  assert.equal((await request(route)).status, 401);
assert.equal(
  (await request("/api/disconnect", {}, { Origin: "https://example.com" }))
    .status,
  403,
);
for (const route of [
  "/.env",
  "/.local/users.json",
  "/.local/credenciales.txt",
  "/server/index.js",
])
  assert.equal((await fetch(base + route)).status, 404);
const credentials = fs.readFileSync(
  new URL("../.local/credenciales.txt", import.meta.url),
  "utf8",
);
const password = /Usuario: admin\r?\nContraseña: ([^\r\n]+)/.exec(
  credentials,
)?.[1];
assert(password, "Ejecuta npm run auth:setup.");
const auth = await request("/api/auth/login", { username: "admin", password });
assert.equal(auth.status, 200);
session = { Cookie: auth.cookie.split(";")[0], "X-CSRF-Token": auth.data.csrf };
const state = await request("/api/state");
assert.equal(state.status, 200);
assert(Array.isArray(state.data.readings));
assert.equal(state.data.collection.limit, 100);
assert(Array.isArray(state.data.collection.sessions));
const ports = await request("/api/ports");
assert.equal(ports.status, 200);
console.log(
  "Puertos detectados:",
  ports.data.map((p) => p.path).join(", ") || "ninguno",
);
const catalog = await request("/api/templates");
assert.equal(catalog.status, 200);
assert.equal(catalog.data.templates.length, 4);
assert.equal(
  (await request("/api/messages", { confirmed: false })).status,
  400,
);
assert.equal(
  (
    await request("/api/messages", {
      confirmed: true,
      requestId: crypto.randomUUID(),
      name: "desconocida",
      values: [],
    })
  ).status,
  400,
);
assert.equal(
  (
    await request("/api/messages", {
      confirmed: true,
      requestId: crypto.randomUUID(),
      name: "yakutoring_reporte_diario",
      values: ["hoy", "99", "7", "35", "5", "999", "prueba", "0"],
      period: "today",
      reportUntil: "invalid",
      simulated: true,
    })
  ).status,
  400,
);
const next = await request(
  `/api/state?sessionId=${state.data.sessionId}&after=${state.data.count}`,
);
assert.equal(next.status, 200);
assert(next.data.readings.every((r) => r.id > state.data.count));
assert.equal((await request("/api/events")).status, 410);
for (let retry = 0; retry < 75; retry++) {
  if ((await request("/api/ml/state")).data.status !== "starting") break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
const candidate = await request("/api/ml/od/demo");
const model = (await request("/api/ml/state")).data;
if (model.activeModels?.includes("noaa")) {
  assert.equal(candidate.status, 200);
  assert.equal(candidate.data.demo.source, "demo");
  assert.equal(candidate.data.demo.status, "experimental");
  assert(Number.isFinite(candidate.data.demo.od_estimado_mg_l));
} else {
  assert.equal(candidate.status, 400);
  assert.match(candidate.data.error, /desactivado/);
}
assert.equal(
  (await request("/api/ml/od/reference", { measurementId: "demo", value: 6 }))
    .status,
  400,
);
assert.equal((await request("/api/auth/logout", {})).status, 200);
assert.equal((await request("/api/ports")).status, 401);
console.log(
  "HTTP, polling incremental, archivos privados, roles, sesión, CSRF y validaciones: correctos. Sin envíos ni datos inyectados.",
);
