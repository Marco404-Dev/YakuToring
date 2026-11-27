import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { MLClient } from "./ml-client.js";
import { PacketParser } from "./parser.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const python =
  process.env.YAKUTORING_PYTHON ||
  path.join(
    root,
    ".venv-ml",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
test(
  "Node → Python persistente: V5/V12, sin VOD como entrada, configuración y CSV",
  { skip: !fs.existsSync(python), timeout: 60000 },
  async () => {
    const local = path.join(root, ".local");
    fs.mkdirSync(local, { recursive: true });
    const temp = fs.mkdtempSync(path.join(local, "ML-TEST-SIMULADO-"));
    const ml = new MLClient(root, {
      databasePath: path.join(temp, "simulado.sqlite"),
      telemetryPath: path.join(temp, "simulado.jsonl"),
      activeModels: "catboost,legacy,noaa",
    });
    try {
      for (let i = 0; i < 400 && ml.state.status === "starting"; i++)
        await delay(100);
      assert.equal(ml.state.status, "ready");
      const pid = ml.child.pid;
      await ml.request("configure", {
        settings: {
          lotId: "SIMULADO-INTEGRACION",
          validationEnabled: false,
          calibration: null,
        },
      });
      for (let h = 0; h <= 6; h++)
        await ml.ingest({
          at: `2020-01-01T${String(h).padStart(2, "0")}:00:00.000Z`,
          packet: h,
          temperature: 27.5,
          ph: 7.07,
          conductivity: 1.363,
          pressure: 1012.8,
          odVoltageV: null,
        });
      assert.equal(ml.state.history[0].model, "V5");
      assert.equal(ml.state.latest.model, "V12");
      assert.equal(ml.child.pid, pid);
      assert.equal(ml.state.latest.referenceMgL, null);
      const before = ml.state.latest.predictionMgL;
      const again = await ml.request("ingest", {
        row: {
          at: "2020-01-01T06:00:00.000Z",
          temperature: 27.5,
          ph: 7.07,
          conductivity: 1.363,
          pressure: 1012.8,
          odVoltageV: 1.6,
        },
      });
      assert.equal(again.latest.predictionMgL, before);
      assert.equal(again.latest.odVoltageMv, 1600);
      const csv = await ml.request("export");
      assert.match(csv.csv, /SIMULADO-INTEGRACION/);
      assert.match(csv.csv, /vod_V/);

      const operations = [];
      const parser = new PacketParser((row) =>
        operations.push(ml.ingest({ ...row, captureId: "captura-de-prueba" })),
      );
      parser.feed("DATA:17,27.50,7.07,1.363,1012.80");
      parser.flush();
      const state = await operations[0];
      const sample = state.experimentalOd.latest;
      assert.equal(sample.id, "captura-de-prueba");
      assert.equal(sample.sequence, 17);
      assert.equal(sample.sensors.conductivity.unit, "mS/cm");
      assert.equal(sample.od_referencia_mg_l, null);
      const demo = (await ml.request("od_demo")).demo;
      assert(Number.isFinite(demo.od_estimado_mg_l));
      assert.equal(demo.source, "demo");
      assert.equal(ml.state.experimentalOd.latest.id, sample.id);
      const paired = await ml.request("od_reference", {
        measurementId: sample.id,
        value: 7.2,
      });
      assert.equal(paired.experimentalOd.latest.od_referencia_mg_l, 7.2);
    } finally {
      const exited = new Promise((resolve) => ml.child.once("exit", resolve));
      ml.close();
      await exited;
      // Directorio creado y verificado dentro de .local para esta prueba.
      assert(temp.startsWith(local + path.sep));
      try {
        fs.rmSync(temp, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      } catch (error) {
        if (error.code !== "EPERM") throw error;
        console.log(
          "Windows conservó la carpeta temporal SIMULADO de la prueba; está excluida de Git y del dashboard.",
        );
      }
    }
  },
);
