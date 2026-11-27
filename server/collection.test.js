import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { Collection } from "./collection.js";
import { PacketParser } from "./parser.js";

const lines = (csv) =>
  csv
    .trimEnd()
    .split("\r\n")
    .map((line) => line.split(","));

test("sesiones persistentes: recepción LoRa, duplicados, pausa, reconexión y límite de 100", (t) => {
  // Tramas sintéticas y base aislada. El servidor operativo nunca recibe estas filas.
  const folder = mkdtempSync(join(tmpdir(), "yakutoring-collection-test-"));
  const file = join(folder, "simulado.sqlite");
  let collection = new Collection(file);
  t.after(() => {
    collection.db.close();
    rmSync(folder, { recursive: true });
  });
  const captures = new Map();
  const receiver = new PacketParser((row) => {
    const key = collection.accept(row);
    if (key) captures.set(row.packet, key);
  });
  function feed(line) {
    receiver.feed(line);
    receiver.flush();
  }
  const packet = (sequence) => `DATA:${sequence},23.7,7.3,1.413,1013.2`;
  const current = () => collection.snapshot().sessions[0];
  feed(packet(0));
  const first = collection.start();
  assert.equal(current().count, 0);
  assert.throws(() => collection.start(), /activa/);
  assert.equal(lines(collection.export(first).csv).length, 1);

  feed(packet(1));
  feed("DATA:2,23.7,NA,1.413,1013.2");
  feed("YK,3,23.7,7.3,1.413,1013.2,28,78,1,1,NA");
  receiver.reset(); // Pérdida del USB y reinicio del parser.
  assert.equal(current().count, 2);
  assert.equal(current().status, "active");
  feed(packet(1)); // Retransmisión después de reconectar y de recibir otra secuencia.
  feed(packet(4));
  assert.equal(current().count, 3);
  collection.pause(first);
  feed(packet(5));
  assert.equal(current().status, "paused");
  const partial = lines(collection.export(first).csv);
  assert.equal(partial.length, 4);
  assert.equal(partial[1][2], new Date(partial[1][2]).toISOString());
  assert.equal(partial[1][5], "");
  assert.equal(partial[1][6], "1.413");
  assert.equal(partial[1][10], "");
  assert.equal(partial[1][11], "");

  collection.db.close();
  collection = new Collection(file);
  assert.equal(current().count, 3);
  assert.equal(current().status, "paused");
  collection.resume(first);
  for (let seq = 5; seq <= 125; seq++) feed(packet(seq));
  assert.equal(current().count, 100);
  assert.equal(current().status, "complete");
  assert.throws(() => collection.resume(first), /pausada/);

  collection.db.exec(
    "CREATE TABLE experimental_od (id TEXT PRIMARY KEY, result TEXT)",
  );
  collection.db.prepare("INSERT INTO experimental_od VALUES (?, ?)").run(
    captures.get(1),
    JSON.stringify({
      status: "experimental",
      od_estimado_mg_l: 6.5,
      od_referencia_mg_l: 7,
      error_absoluto_mg_l: 0.5,
    }),
  );
  const completed = collection.export(first);
  assert.match(
    completed.filename,
    /^YakuToring_Mediciones_\d{4}-\d{2}-\d{2}_Sesion001\.csv$/,
  );
  const exported = lines(completed.csv);
  assert.equal(exported.length, 101);
  assert.equal(collection.measurements(first)[0].od_estimado_mg_l, 6.5);
  assert.equal(collection.measurements(first)[1].od_estimado_mg_l, null);
  assert.deepEqual(exported[1].slice(8, 13), [
    "6.5",
    "experimental",
    "7",
    "0.5",
    "provisional_calibracion_en_verificacion",
  ]);
  assert.equal(exported.at(-1)[1], "100");
  assert.equal(new Set(exported.slice(1).map((row) => row.at(-1))).size, 100);

  const second = collection.start();
  assert.notEqual(second, first);
  receiver.reset();
  feed(packet(1));
  assert.equal(current().count, 1);
  collection.pause(second);
  assert.equal(lines(collection.export(second).csv).length, 2);
  assert.deepEqual(collection.export(first), completed);
});

test("objetivos configurables, finalización anticipada y validación", () => {
  const collection = new Collection(":memory:");
  try {
    for (const target of [25, 50, 100, 200, 500, 1000, 327]) {
      const id = collection.start({
        target,
        name: "Campaña",
        location: "Tumbes",
        depth: 0,
        ecosystem: "E3",
      });
      const row = {
        format: "DATA",
        at: "2026-11-26T13:00:00Z",
        temperature: 22,
        ph: 7.3,
        conductivity: 2,
        pressure: 1011,
      };
      for (let i = 0; i <= target; i++)
        collection.accept({ ...row, packet: i });
      const session = collection.snapshot().sessions[0];
      assert.equal(session.target, target);
      assert.equal(session.count, target);
      assert.equal(session.status, "complete");
      assert.equal(session.name, "Campaña");
      assert.equal(session.depth, 0);
      assert.equal(collection.measurements(id).length, target);
    }
    const id = collection.start({ target: 500 });
    collection.pause(id);
    collection.finish(id);
    assert.equal(collection.snapshot().sessions[0].status, "finished");
    assert.throws(() => collection.resume(id), /pausada/);
    for (const target of [0, 10001, 1.5, "25"])
      assert.throws(() => collection.start({ target }), /entero/);
  } finally {
    collection.db.close();
  }
});

test("migra sesiones históricas de 100 conservando capturas", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "yakutoring-migration-"));
  const filename = join(folder, "legacy.sqlite");
  t.after(() => rmSync(folder, { recursive: true }));
  const old = new DatabaseSync(filename);
  old.exec(`
    CREATE TABLE collection_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, status TEXT, count INTEGER CHECK(count<=100));
    CREATE TABLE collection_samples (session_id INTEGER REFERENCES collection_sessions(id), number INTEGER CHECK(number<=100), capture_id TEXT, sequence INTEGER, at TEXT, temperature REAL, ph REAL, conductivity REAL, pressure REAL, ec_status TEXT);
    INSERT INTO collection_sessions VALUES(3,'2026-11-25T00:00:00Z','paused',1);
    INSERT INTO collection_samples VALUES(3,1,'test',7,'2026-11-25T01:00:00Z',24,7,1,1001,'provisional');
  `);
  old.close();
  const collection = new Collection(filename);
  try {
    assert.equal(collection.snapshot().sessions[0].target, 100);
    assert.equal(collection.measurements(3)[0].packet, 7);
    assert.equal(collection.start({ target: 1000 }), 4);
  } finally {
    collection.db.close();
  }
});
