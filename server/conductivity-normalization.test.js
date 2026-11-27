import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeConductivity } from "./conductivity.js";
import { PacketParser } from "./parser.js";

test("µS/cm del Receiver se convierte una vez y conserva la lectura original", () => {
  const rows = [];
  const parser = new PacketParser((raw) =>
    rows.push(normalizeConductivity(raw, "uS/cm")),
  );
  parser.feed("DATA:1,24,7.8,1413,1013");
  parser.flush();
  assert.equal(rows[0].conductivity, 1.413);
  assert.equal(rows[0].conductivityOriginal, 1413);
  assert.equal(rows[0].conductivityUsCm, 1413);
  assert.equal(rows[0].conductivityUnit, "uS/cm");
  assert.equal(
    normalizeConductivity({ conductivity: 1.413 }, "mS/cm").conductivity,
    1.413,
  );
  assert.equal(
    normalizeConductivity({ conductivity: null }, "uS/cm").conductivity,
    null,
  );
  assert.throws(() => normalizeConductivity({ conductivity: 707 }, "ppm"));
});
