export function reportReadings(readings, period, until) {
  if (
    !["today", "session"].includes(period) ||
    !Number.isFinite(Date.parse(until))
  )
    throw new Error("Periodo del reporte inválido.");
  const cutoff = Date.parse(until);
  if (cutoff > Date.now() + 5000) throw new Error("Fecha de corte inválida.");
  const peruDay = (at) =>
    new Date(at).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  return readings.filter(
    (r) =>
      Date.parse(r.at) <= cutoff &&
      (period === "session" || peruDay(r.at) === peruDay(until)),
  );
}
export function validateReport(values, readings, period, until, simulated) {
  const rows = reportReadings(readings, period, until);
  const temperatures = rows.filter((r) => Number.isFinite(r.temperature));
  if (!temperatures.length)
    throw new Error("No hay mediciones reales para este reporte.");
  const mean = (
    temperatures.reduce((sum, r) => sum + r.temperature, 0) /
    temperatures.length
  ).toFixed(2);
  if (values[1] !== mean || values[5] !== String(rows.length))
    throw new Error(
      "El promedio o la cantidad no coincide con los datos reales. Cierre y vuelva a abrir el reporte.",
    );
  const phRows = rows.filter((r) => Number.isFinite(r.ph));
  if (
    phRows.length &&
    values[2] !==
      (phRows.reduce((s, r) => s + r.ph, 0) / phRows.length).toFixed(2)
  )
    throw new Error(
      "El promedio de pH no coincide con las lecturas reales del periodo.",
    );
  if (simulated !== true)
    throw new Error(
      "Identifique los parámetros aún no conectados como simulación.",
    );
}
