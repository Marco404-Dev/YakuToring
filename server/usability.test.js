import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionStatus, interpretReading } from "../src/interpretation.js";

test("el estado distingue conexión, espera, recepción e interrupción", () => {
  const data = { online: true, status: { connected: true } };
  assert.equal(connectionStatus(data)[0], "Esperando mediciones");
  assert.equal(
    connectionStatus({ ...data, hasPacket: true })[0],
    "Recibiendo datos",
  );
  assert.equal(
    connectionStatus({ ...data, hasPacket: true, noData: true })[0],
    "Conexión interrumpida",
  );
  assert.equal(
    connectionStatus({ ...data, connecting: true })[0],
    "Conectando",
  );
  assert.equal(
    connectionStatus({ ...data, status: { error: "USB" } })[0],
    "Error de comunicación",
  );
});

test("la interpretación usa datos de la sesión y conserva los faltantes", () => {
  const rows = Array.from({ length: 15 }, () => ({ temperature: 23, ph: 7.5 }));
  assert.equal(interpretReading(rows, "temperature").tone, "expected");
  assert.match(interpretReading(rows, "ph").value, /alcalino/);
  assert.equal(interpretReading(rows, "conductivity").tone, "unknown");
  const change = interpretReading(
    [...rows, { temperature: 25 }],
    "temperature",
  );
  assert.equal(change.state, "Variación detectada");
  assert.match(change.text, /subió 2.0 °C/);
});
