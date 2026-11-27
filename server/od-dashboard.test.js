import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("el panel muestra OD experimental, unidades y MAE solo con pares", async () => {
  const vite = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const { default: Panel } = await vite.ssrLoadModule(
      "/src/ExperimentalODPanel.jsx",
    );
    const sample = {
      id: "campo",
      at: "2024-02-29T17:30:00Z",
      lotId: "prueba",
      sensors: {
        temperature: { value: 24 },
        ph: { value: 7.8 },
        conductivity: { value: 1.363 },
        pressure: { value: 1013 },
      },
      warnings: [],
      message: "Estimación en zona central",
      od_estimado_mg_l: 6.5,
    };
    function render(record, metrics, canReference = true) {
      return renderToStaticMarkup(
        React.createElement(Panel, {
          canReference,
          ml: {
            status: "ready",
            experimentalOd: { latest: record, history: [record], metrics },
          },
        }),
      );
    }
    const unpaired = render(sample, { n: 0, mae: null }, false);
    assert.match(unpaired, /EXPERIMENTAL/);
    assert.match(unpaired, /6\.50 mg\/L/);
    assert.match(unpaired, /1\.363 mS\/cm/);
    assert.match(unpaired, /1013\.00 hPa/);
    assert.match(unpaired, /Probar con datos simulados/);
    assert.doesNotMatch(unpaired, /MAE acumulado|Guardar referencia/);
    const paired = render(
      { ...sample, od_referencia_mg_l: 7, error_absoluto_mg_l: 0.5 },
      { n: 1, mae: 0.5 },
    );
    assert.match(paired, /OD de referencia/);
    assert.match(paired, /7\.00 mg\/L/);
    assert.match(paired, /Error absoluto/);
    assert.match(paired, /MAE acumulado/);
    assert.match(paired, /Guardar referencia/);
  } finally {
    await vite.close();
  }
});

test("el panel de recolección muestra progreso, conexión y descarga según el estado", async () => {
  const vite = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const { default: Panel } = await vite.ssrLoadModule(
      "/src/CollectionPanel.jsx",
    );
    function render(status, count) {
      return renderToStaticMarkup(
        React.createElement(Panel, {
          canManage: true,
          connection: "Receiver desconectado",
          collection: {
            limit: 100,
            sessions: [
              { id: 1, status, count, createdAt: "2026-11-17T12:00:00Z" },
            ],
          },
        }),
      );
    }
    const active = render("active", 37);
    assert.match(active, /Receiver desconectado/);
    assert.match(active, /37 \/ 100/);
    assert.match(active, /Pausar sesión/);
    assert.match(active, /Descargar CSV parcial/);
    assert.match(active, /export\.csv/);
    assert.match(active, /Ver mediciones/);
    const paused = render("paused", 37);
    assert.match(paused, /Reanudar sesión/);
    assert.match(paused, /\/api\/collection\/1\/export\.csv/);
    assert.match(render("complete", 100), /100 \/ 100.*Completada/);
  } finally {
    await vite.close();
  }
});

test("comparación muestra cuatro resultados y error absoluto de la misma muestra", async () => {
  const vite = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const { ModelResults } = await vite.ssrLoadModule(
      "/src/ComparisonPanel.jsx",
    );
    const keys = ["catboost", "mlp", "weighted", "stacking"];
    const run = {
      at: "2024-02-29T17:30:00Z",
      spread: 0.3,
      warnings: [],
      models: Object.fromEntries(
        keys.map((key, i) => [
          key,
          { value: 6 + i / 10, status: "experimental" },
        ]),
      ),
    };
    const html = renderToStaticMarkup(
      React.createElement(ModelResults, {
        run,
        sample: {
          reference: 7,
          errors: Object.fromEntries(keys.map((key) => [key, 1])),
        },
      }),
    );
    for (const label of [
      "CatBoost",
      "Deep Learning MLP",
      "Híbrido ponderado 55/45",
      "Híbrido Stacking Ridge",
    ]) {
      assert(html.includes(label));
    }
    assert.match(html, /0\.300 mg\/L/);
    assert.match(html, /OD sonda/);
    assert.match(html, /Error absoluto/);
    assert.equal((html.match(/Estimación experimental/g) || []).length, 4);
  } finally {
    await vite.close();
  }
});
