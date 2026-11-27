import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AnomalyLog } from "./anomaly-log.js";
import {
  correlation,
  describe,
  oxygenSaturation,
  projectReference,
  reviewReadings,
} from "../src/environment.js";

test("historial de anomalías agrupa y conserva la revisión", () => {
  const log = new AnomalyLog(":memory:");
  try {
    log.configure(4);
    log.add("ph", "hipótesis", 1000, 7, 5);
    log.add("ph", "hipótesis", 2000, 8, 6);
    const { threshold, events } = log.snapshot();
    assert.equal(threshold, 4);
    assert.equal(events.length, 1);
    assert.equal(events[0].occurrences, 2);
    assert.equal(events[0].value, 8);
    log.review(events[0].id);
    log.add("ph", "hipótesis", 3000);
    assert.deepEqual(
      log.snapshot().events.map((event) => event.reviewed),
      [0, 1],
    );
    assert.throws(() => log.configure(0), /entre 2 y 8/);
  } finally {
    log.db.close();
  }
});

test("Benson–Krause separa temperatura, presión, salinidad y dominio nominal", () => {
  const fresh = oxygenSaturation(20, 1013.25);
  assert.ok(Math.abs(fresh - 9.09) < 0.03);
  assert.ok(oxygenSaturation(30, 1013.25) < fresh);
  assert.ok(oxygenSaturation(20, 900) < fresh);
  assert.ok(oxygenSaturation(20, 1013.25, 30) < fresh);
  assert.equal(oxygenSaturation(20, null), null);
  assert.equal(oxygenSaturation(45, 1013.25), null);
});

test("proyección Florida asigna centroides y se abstiene ante extremos", () => {
  const report = JSON.parse(
    readFileSync(
      new URL("../ml/environment_models/florida-v1.json", import.meta.url),
    ),
  );
  for (const cluster of report.clusters) {
    const center = report.projection.centers[cluster.id];
    const original = center.map(
      (v, i) => v * report.projection.scale[i] + report.projection.mean[i],
    );
    const result = projectReference(report, original);
    assert.equal(result.cluster, cluster.id);
    assert.ok(result.distance < 1e-8);
    assert.ok(
      result.pca.every(
        (v, i) => Math.abs(v - report.centroids[cluster.id][i]) < 1e-6,
      ),
    );
  }
  assert.equal(projectReference(report, [90, 9, 90, 1000]).cluster, null);
  assert.equal(projectReference(report, [null, 9, 90, 1000]), null);
});

test("estadística omite faltantes y distingue cambios de lecturas constantes", () => {
  assert.deepEqual(describe([1, null, 3]), {
    n: 2,
    min: 1,
    max: 3,
    mean: 2,
    median: 2,
    sd: Math.SQRT2,
  });
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: i,
    x: i % 5,
    y: -(i % 5),
  }));
  assert.ok(Math.abs(correlation(rows, "x", "y", "spearman") + 1) < 1e-10);
  const events = reviewReadings(
    [...rows, { id: 25, x: 100 }, { id: 26, x: null }],
    [{ key: "x" }],
  );
  assert.match(events[0].cause, /faltante/);
  assert.ok(events[1].score > 3.5);
  assert.match(
    reviewReadings(
      Array.from({ length: 10 }, (_, id) => ({ id, x: 7 })),
      [{ key: "x" }],
    )[0].cause,
    /constante/,
  );
});
