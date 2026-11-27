import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketParser } from "./parser.js";
test("YK: once campos en orden, VOD en voltios y NA conserva paquete", () => {
  const rows = [],
    p = new PacketParser((r) => rows.push(r));
  p.feed("YK,12,27.50,7.07,1.363,1012.80,29.2,70,1.1,1.2,0.8");
  p.flush();
  assert.deepEqual(
    [
      "packet",
      "temperature",
      "ph",
      "conductivity",
      "pressure",
      "ambientTemperature",
      "humidity",
      "phVoltageV",
      "ecVoltageV",
      "odVoltageV",
    ].map((k) => rows[0][k]),
    [12, 27.5, 7.07, 1.363, 1012.8, 29.2, 70, 1.1, 1.2, 0.8],
  );
  p.feed("YK,13,NA,NA,NA,NA,NA,NA,NA,NA,NA");
  p.flush();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].odVoltageV, null);
  assert.equal(rows[1].temperature, null);
});
test("YK: descarta truncados, campos extra, números inválidos y voltajes fuera de ADC", () => {
  const rows = [],
    p = new PacketParser((r) => rows.push(r));
  for (const line of [
    "YK,1,27,7,1,1000,25,70,1,1",
    "YK,1,27,7,1,1000,25,70,1,1,1,extra",
    "YK,1,27,7,1,1000,25,101,1,1,1",
    "YK,1,27,7,1,1000,25,70,1,1,3300",
    "YK,1,27,7,1,1000,25,70,1,1,nan",
  ])
    p.feed(line);
  p.flush();
  assert.equal(rows.length, 0);
});
test("YK: resúmenes y repeticiones no duplican y reset mantiene compatibilidad DATA", () => {
  const rows = [],
    p = new PacketParser((r) => rows.push(r));
  for (const line of [
    "Paquete recibido: 1",
    "Temperatura: 27.5 C",
    "RSSI: -44 dBm",
    "SNR: 6 dB",
    "Recibido: YK,1,27.5,7,1.3,1012,25,70,1,1,NA",
    "YK,1,27.5,7,1.3,1012,25,70,1,1,NA",
    "DATA:1,27.5,7,1.3,1012",
    "Temperatura: 27.5 C",
  ])
    p.feed(line);
  p.flush();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rssi, -44);
  p.reset();
  p.feed("DATA:2,27.5,7,1.3,1012");
  p.flush();
  assert.equal(rows.length, 2);
});
