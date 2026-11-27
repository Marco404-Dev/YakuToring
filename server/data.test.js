import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketParser } from "./parser.js";
import { validateReport } from "./report.js";
test("orden real del Receiver: resumen y métricas antes de DATA, también después de emitir el anterior", () => {
  const rows = [],
    p = new PacketParser((r) => rows.push(r));
  for (let i = 1; i <= 2; i++) {
    [
      `Paquete recibido: ${i + 100}`,
      "Temperatura: 26.50 C",
      "RSSI: -33 dBm",
      "SNR: 6.5 dB",
      `DATA:${i},26.50,7.12,1.363,1012.80`,
    ].forEach((l) => p.feed(l));
    p.flush();
  }
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.format, "DATA");
    assert.equal(r.rssi, -33);
    assert.equal(r.snr, 6.5);
  }
});
test("un resumen TEMP previo no duplica el primer DATA del bloque", () => {
  const rows = [],
    p = new PacketParser((r) => rows.push(r));
  p.feed("Recibido: TEMP:26.50");
  p.feed("Temperatura: 26.50 C");
  p.feed("DATA:1,26.50,7.12,1.363,1012.80");
  p.flush();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].format, "DATA");
});
test("DATA contiene cuatro parámetros y una secuencia", () => {
  const rows = [],
    p = new PacketParser((r) => rows.push(r));
  p.feed("DATA:12,26.50,7.12,1.363,1012.80");
  p.flush();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [
      rows[0].packet,
      rows[0].temperature,
      rows[0].ph,
      rows[0].conductivity,
      rows[0].pressure,
    ],
    [12, 26.5, 7.12, 1.363, 1012.8],
  );
});
test("NA conserva el paquete y se representa como null, incluido un paquete sin sensores", () => {
  const rows = [],
    p = new PacketParser((r) => rows.push(r));
  p.feed("DATA:1,NA,7.12,NA,1012.8");
  p.feed("DATA:2,NA,NA,NA,NA");
  p.flush();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].temperature, null);
  assert.equal(rows[0].conductivity, null);
  assert.equal(rows[1].ph, null);
});
test("DATA rechaza estructura, números, secuencia y rangos inválidos sin generar lecturas", () => {
  const rows = [],
    p = new PacketParser((r) => rows.push(r));
  [
    "DATA:1,26,7,680",
    "DATA:1,26,7,680,1012,extra",
    "DATA:-1,26,7,680,1012",
    "DATA:1,26,Infinity,680,1012",
    "DATA:1,26,,680,1012",
    "DATA:1,26,15,680,1012",
    "DATA:1,26,7,-1,1012",
    "DATA:1,26,7,680,0",
    "DATA:9007199254740992,26,7,680,1012",
  ].forEach((l) => p.feed(l));
  p.flush();
  assert.equal(rows.length, 0);
});
test("DATA domina líneas informativas y TEMP; secuencia repetida no duplica y reinicio permite volver a contar", () => {
  const rows = [],
    p = new PacketParser((r) => rows.push(r));
  [
    "DATA:12,26.50,7.12,1.363,1012.80",
    "Recibido: TEMP:26.50",
    "Paquete recibido: 12",
    "Temperatura: 26.50 C",
    "RSSI: -60 dBm",
    "SNR: 9 dB",
    "DATA:12,26.50,7.12,1.363,1012.80",
    "DATA:13,26.50,7.12,1.363,1012.80",
  ].forEach((l) => p.feed(l));
  p.flush();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rssi, -60);
  p.reset();
  p.feed("DATA:12,26.50,7.12,1.363,1012.80");
  p.flush();
  assert.equal(rows.length, 3);
});
test("TEMP anterior funciona sin DATA", () => {
  const rows = [],
    p = new PacketParser((r) => rows.push(r));
  p.feed("TEMP:26.50");
  p.flush();
  assert.equal(rows[0].temperature, 26.5);
});
test("promedios del reporte excluyen NA sin convertir conductividad a salinidad", () => {
  const rows = [
    { at: "2020-01-01T12:00:00Z", temperature: 20, ph: 7 },
    { at: "2020-01-01T13:00:00Z", temperature: null, ph: 8 },
    { at: "2020-01-01T14:00:00Z", temperature: 30, ph: null },
  ];
  validateReport(
    ["hoy", "25.00", "7.50", "simulado", "simulado", "3"],
    rows,
    "session",
    "2020-01-01T15:00:00Z",
    true,
  );
  assert.throws(() =>
    validateReport(
      ["hoy", "16.67", "7.50", "", "", "3"],
      rows,
      "session",
      "2020-01-01T15:00:00Z",
      true,
    ),
  );
  assert.throws(() =>
    validateReport(
      ["hoy", "25.00", "5.00", "", "", "3"],
      rows,
      "session",
      "2020-01-01T15:00:00Z",
      true,
    ),
  );
});
