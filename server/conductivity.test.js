import { test } from "node:test";
import assert from "node:assert/strict";
import { PacketParser } from "./parser.js";
import { sensors, display, mean, formatReading } from "../src/sensors.js";
import { templates, payload } from "./templates.js";

test("DATA conserva 1.363 mS/cm sin conversión ni segunda calibración", () => {
  const rows = [],
    parser = new PacketParser((row) => rows.push(row));
  parser.feed("DATA:16,27.50,7.07,1.363,1012.80");
  parser.flush();
  assert.deepEqual(
    [
      rows[0].packet,
      rows[0].temperature,
      rows[0].ph,
      rows[0].conductivity,
      rows[0].pressure,
    ],
    [16, 27.5, 7.07, 1.363, 1012.8],
  );
  assert.equal(Object.hasOwn(rows[0], "tds"), false);
  assert.equal(display(rows[0].conductivity, "conductivity"), "1.363");
  assert.equal(
    formatReading(rows[0].conductivity, "conductivity"),
    "1.363 mS/cm",
  );
});
test("NA no es cero: conductividad ausente y ejemplo de sensores desconectados", () => {
  const rows = [],
    parser = new PacketParser((row) => rows.push(row));
  parser.feed("DATA:16,NA,7.07,1.363,NA");
  parser.feed("DATA:17,27.50,7.07,NA,1012.80");
  parser.flush();
  assert.equal(rows[0].temperature, null);
  assert.equal(rows[0].pressure, null);
  assert.equal(rows[0].conductivity, 1.363);
  assert.equal(rows[1].conductivity, null);
  assert.equal(display(rows[1].conductivity, "conductivity"), "Sin lectura");
  assert.equal(mean(rows, "conductivity"), "1.363");
  assert.equal(formatReading(null, "conductivity"), "");
  assert.equal(display(0, "conductivity"), "0.000");
  assert.equal(mean([{ conductivity: null }], "conductivity"), "");
  // La evidencia histórica de TDS no se reinterpreta como conductividad.
  assert.equal(mean([{ tds: 680.5 }], "conductivity"), "");
});
test("tarjetas, estadísticas, etiquetas y alertas comparten precisión y unidad", () => {
  const conductivity = sensors.find((s) => s.key === "conductivity");
  assert.equal(conductivity.name, "Conductividad eléctrica");
  assert.equal(conductivity.unit, "mS/cm");
  assert.equal(conductivity.decimals, 3);
  assert.equal(
    conductivity.note,
    "Conductividad estimada — calibración en verificación",
  );
  assert.equal(
    mean(
      [
        { conductivity: 1.363 },
        { conductivity: 1.413 },
        { conductivity: null },
      ],
      "conductivity",
    ),
    "1.388",
  );
  assert.equal(display(27.5, "temperature"), "27.50");
  assert.equal(display(7.07, "ph"), "7.07");
  assert.equal(display(1012.8, "pressure"), "1012.80");
  for (const name of [
    "yakutoring_alerta_ambiental",
    "yakutoring_posible_riesgo_ambiental",
  ]) {
    const t = templates.find((t) => t.name === name),
      value = formatReading(1.363, "conductivity");
    const values = [
      conductivity.name,
      value,
      ...(t.fields.length === 4 ? ["10 minutos de prueba"] : []),
      "05/11/2026 16:00",
    ];
    const body = payload(t, values, "es", "51930374595");
    assert.equal(body.template.components[0].parameters[1].text, "1.363 mS/cm");
  }
  const report = templates.find((t) => t.name === "yakutoring_reporte_diario");
  const body = payload(
    report,
    [
      "fecha",
      "27.50",
      "7.07",
      "No disponible",
      "No disponible",
      "1",
      "Sin evaluación",
      "No evaluadas",
    ],
    "es",
    "51930374595",
  );
  assert.match(report.fields[3], /Salinidad/);
  assert.equal(body.template.components[0].parameters[3].text, "No disponible");
});
