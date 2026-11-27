import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { defaults, evaluateReference } from "../src/thresholds.js";
import { reviewReadings } from "../src/environment.js";
import { verifySignature, updateDeliveries } from "./whatsapp-webhook.js";
import { diagnosticValues } from "./templates.js";

test("ECA E3 y E1 conservan límites y aplicabilidad", () => {
  const tone = (profile, key, value, options) =>
    evaluateReference(profile, key, value, options).tone;
  for (const [value, expected] of [
    [6.799, "red"],
    [6.8, "yellow"],
    [7, "green"],
    [8.3, "green"],
    [8.5, "yellow"],
    [8.501, "red"],
  ])
    assert.equal(tone("E3", "ph", value), expected);
  for (const [value, expected] of [
    [3.99, "red"],
    [4, "yellow"],
    [4.99, "yellow"],
    [5, "green"],
  ])
    assert.equal(tone("E3", "od_estimado_mg_l", value), expected);
  assert.equal(tone("E1", "od_estimado_mg_l", 4.99), "red");
  assert.equal(
    tone("E3", "conductivity", 1, { ...defaults, conductivityVerified: true }),
    "gray",
  );
  assert.equal(
    tone("E1", "conductivity", 1, { ...defaults, conductivityVerified: true }),
    "green",
  );
  assert.equal(
    tone("E1", "conductivity", 1.001, {
      ...defaults,
      conductivityVerified: true,
    }),
    "red",
  );
  assert.equal(tone("E3", "pressure", 1000), "gray");
  assert.equal(tone("E3", "temperature", 28), "gray");
  assert.equal(
    tone("E3", "temperature", 28, { ...defaults, baseline: 26 }),
    "green",
  );
});

test("temperatura estable, resolución y persistencia de tres lecturas", () => {
  const checks = [{ key: "temperature" }];
  const base = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    at: new Date(i * 2000).toISOString(),
    temperature: i % 2 ? 28.25 : 28.31,
  }));
  assert.equal(reviewReadings(base, checks).length, 0);
  assert.equal(
    reviewReadings(
      base.map((row) => ({ ...row, temperature: 28.25 })),
      checks,
    ).length,
    0,
  );
  const spikes = [24, 25, 26].map((i) => ({
    id: i,
    at: new Date(i * 2000).toISOString(),
    temperature: 29.25,
  }));
  assert.equal(
    reviewReadings([...base, ...spikes.slice(0, 2)], checks).length,
    0,
  );
  assert.match(
    reviewReadings([...base, ...spikes], checks)[0].cause,
    /persistente/,
  );
});

test("webhook firmado, transición real y marca de prueba", () => {
  const bytes = Buffer.from('{"test":true}');
  const signature =
    "sha256=" + createHmac("sha256", "fixture").update(bytes).digest("hex");
  assert.equal(verifySignature("fixture", bytes, signature), true);
  assert.equal(verifySignature("incorrecta", bytes, signature), false);
  const attempt = { messageId: "wamid.test", delivery: "desconocido" };
  const update = (status) =>
    updateDeliveries(
      {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: "test" },
                  statuses: [{ id: attempt.messageId, status }],
                },
              },
            ],
          },
        ],
      },
      "test",
      () => attempt,
      () => {},
    );
  update("sent");
  assert.equal(attempt.deliveryLabel, "Enviado");
  update("delivered");
  update("sent");
  assert.equal(attempt.deliveryLabel, "Entregado");
  update("read");
  assert.equal(attempt.deliveryLabel, "Leído");
  assert.deepEqual(
    diagnosticValues("yakutoring_alerta_ambiental", ["pH", "7", "fecha"]),
    ["[PRUEBA] pH", "7", "fecha"],
  );
});
