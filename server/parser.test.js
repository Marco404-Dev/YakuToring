import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketParser } from "./parser.js";
import { templates, payload } from "./templates.js";
import { validateReport, reportReadings } from "./report.js";
test("reporte respeta día de Perú, promedio real y exige simulación", () => {
  const rows = [
    { at: "2026-11-04T23:00:00Z", temperature: 20 },
    { at: "2026-11-05T15:00:00Z", temperature: 28 },
    { at: "2026-11-05T16:00:00Z", temperature: 30 },
  ];
  const until = "2026-11-05T17:00:00Z";
  assert.equal(reportReadings(rows, "today", until).length, 2);
  validateReport(["", "29.00", "", "", "", "2"], rows, "today", until, true);
  assert.throws(() =>
    validateReport(["", "26.00", "", "", "", "2"], rows, "today", until, true),
  );
  assert.throws(() =>
    validateReport(["", "29.00", "", "", "", "2"], rows, "today", until, false),
  );
  assert.throws(() => validateReport([], [], "today", until, true));
});
test("un paquete produce una medición con ambas líneas y metadatos", () => {
  const rows = [];
  const p = new PacketParser((r) => rows.push(r));
  [
    "Recibido: TEMP:26.50",
    "Paquete recibido: 12",
    "Temperatura: 26.50 C",
    "Estado: NORMAL",
    "RSSI: -65.00 dBm",
    "SNR: 9.50 dB",
  ].forEach((l) => p.feed(l));
  p.flush();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].temperature, 26.5);
  assert.equal(rows[0].rssi, -65);
  assert.equal(rows[0].snr, 9.5);
  assert.equal(rows[0].packet, 12);
});
test("paquetes consecutivos con igual temperatura no se descartan", () => {
  const rows = [];
  const p = new PacketParser((r) => rows.push(r));
  for (let i = 0; i < 3; i++) {
    p.feed("Recibido: TEMP:26.50");
    p.feed(`Paquete recibido: ${i}`);
    p.feed("Temperatura: 26.50 C");
  }
  p.flush();
  assert.equal(rows.length, 3);
});
test("líneas tardías no duplican un paquete ya emitido", () => {
  const rows = [];
  const p = new PacketParser((r) => rows.push(r));
  p.feed("Recibido: TEMP:26.50");
  p.flush();
  p.feed("Paquete recibido: 12");
  p.feed("Temperatura: 26.50 C");
  p.flush();
  assert.equal(rows.length, 1);
});
test("rechaza mensajes inválidos y temperaturas fuera del DS18B20", () => {
  const rows = [];
  const p = new PacketParser((r) => rows.push(r));
  [
    "ruido",
    "Recibido: TEMP:nan",
    "Temperatura: -127 C",
    "Temperatura: 200 C",
  ].forEach((l) => p.feed(l));
  p.flush();
  assert.equal(rows.length, 0);
});
test("bloques de paquete sin Recibido y reinicio de parser", () => {
  const rows = [];
  const p = new PacketParser((r) => rows.push(r));
  p.feed("Paquete recibido: 1");
  p.feed("Temperatura: 20 C");
  p.feed("Paquete recibido: 2");
  p.feed("Temperatura: 21 C");
  p.flush();
  assert.equal(rows.length, 2);
  p.feed("Recibido: TEMP:22");
  p.reset();
  p.flush();
  assert.equal(rows.length, 2);
});
test("plantillas conservan orden y alerta fija omite componentes", () => {
  for (const t of templates) {
    const values = t.fields.map((_, i) => `valor ${i + 1}`);
    const body = payload(t, values, "es_PE", "51930374595");
    assert.equal(body.template.language.code, "es_PE");
    if (values.length)
      assert.deepEqual(
        body.template.components[0].parameters.map((p) => p.text),
        values,
      );
    else assert.equal(body.template.components, undefined);
  }
  assert.throws(() =>
    payload(templates[1], ["incompleto"], "es", "51930374595"),
  );
  assert.throws(() => payload(undefined, [], "es", "51930374595"));
});
