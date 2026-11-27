// Los valores ya llegan del Sender en estas unidades; aquí solo se formatean.
export const sensors = [
  {
    key: "temperature",
    name: "Temperatura del agua",
    unit: "°C",
    decimals: 2,
    note: "Temperatura real",
  },
  {
    key: "ph",
    name: "pH del agua",
    unit: "",
    decimals: 2,
    note: "Calibración de tres puntos en el Sender",
  },
  {
    key: "conductivity",
    name: "Conductividad eléctrica",
    unit: "mS/cm",
    decimals: 3,
    minPadding: 0.001,
    note: "Conductividad estimada — calibración en verificación",
  },
  {
    key: "pressure",
    name: "Presión atmosférica",
    unit: "hPa",
    decimals: 2,
    note: "Presión atmosférica local",
  },
];
export const finite = (v) => typeof v === "number" && Number.isFinite(v);
export const decimals = (key) =>
  sensors.find((s) => s.key === key)?.decimals ?? 2;
export const display = (value, key) =>
  finite(value) ? value.toFixed(decimals(key)) : "Sin lectura";
export function mean(rows, key) {
  const values = rows.map((r) => r[key]).filter(finite);
  return values.length
    ? (values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(
        decimals(key),
      )
    : "";
}
export function formatReading(value, key) {
  if (!finite(value)) return "";
  const unit = sensors.find((s) => s.key === key)?.unit;
  return `${display(value, key)}${unit ? ` ${unit}` : ""}`;
}
