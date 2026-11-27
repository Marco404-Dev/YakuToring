import { describe } from "./environment.js";

const rules = {
  temperature: {
    digits: 1,
    unit: "°C",
    floor: 0.3,
    meaning: "El agua más cálida puede disolver menos oxígeno en equilibrio.",
  },
  ph: {
    digits: 2,
    unit: "",
    floor: 0.2,
    meaning:
      "El pH describe la acidez del agua. La interpretación ecológica depende del sitio.",
  },
  conductivity: {
    digits: 3,
    unit: "mS/cm",
    floor: 0.05,
    meaning:
      "La conductividad refleja la presencia de iones disueltos. La lectura del dispositivo es derivada y su calibración sigue en revisión.",
  },
  pressure: {
    digits: 1,
    unit: "hPa",
    floor: 1,
    meaning: "La presión local influye en la saturación teórica de oxígeno.",
  },
};

export function interpretReading(rows, key) {
  const { digits, unit, floor, meaning } = rules[key];
  const latest = rows.at(-1)?.[key];
  if (!Number.isFinite(latest))
    return {
      state: "Información insuficiente",
      tone: "unknown",
      text: meaning,
      action: "Comprueba que el sensor esté conectado y espera otra lectura.",
    };
  const trend = describe(rows.slice(-31, -1).map((row) => row[key]));
  const category =
    key === "ph"
      ? ` · ${latest < 6.9 ? "ácido" : latest > 7.1 ? "alcalino" : "cercano a neutro"}`
      : "";
  const enough = trend && trend.n >= 12;
  const delta = enough ? latest - trend.median : null;
  const changed = enough && Math.abs(delta) >= Math.max(floor, trend.sd ?? 0);
  return {
    value: `${latest.toFixed(digits)} ${unit}${category}`.trim(),
    state: !enough
      ? "Historial insuficiente"
      : changed
        ? "Variación detectada"
        : "Estable respecto a la sesión",
    tone: !enough ? "unknown" : changed ? "follow" : "expected",
    text: changed
      ? `La lectura ${delta > 0 ? "subió" : "bajó"} ${Math.abs(delta).toFixed(digits)} ${unit} frente a la mediana de ${trend.n} paquetes previos. ${meaning}`
      : meaning,
    action: changed
      ? "Revisa si el cambio continúa en las siguientes lecturas."
      : enough
        ? null
        : "Reúne al menos 12 lecturas previas válidas para comparar.",
  };
}

export function connectionStatus({
  online,
  status,
  connecting,
  noData,
  hasPacket,
}) {
  if (connecting) return ["Conectando", "follow"];
  if (online && status.error) return ["Error de comunicación", "error"];
  if (!online || (status.connected && noData && hasPacket))
    return ["Conexión interrumpida", "review"];
  if (!status.connected) return ["Dispositivo desconectado", "unknown"];
  return hasPacket
    ? ["Recibiendo datos", "expected"]
    : ["Esperando mediciones", "follow"];
}
