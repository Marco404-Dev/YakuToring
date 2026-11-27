export function normalizeConductivity(row, unit) {
  if (!["uS/cm", "mS/cm"].includes(unit)) {
    throw new Error("Configura YAKUTORING_EC_INPUT_UNIT como uS/cm o mS/cm.");
  }
  const original = Number.isFinite(row.conductivity) ? row.conductivity : null;
  return {
    ...row,
    conductivityOriginal: original,
    conductivityUnit: unit,
    conductivityUsCm:
      original === null ? null : unit === "uS/cm" ? original : original * 1000,
    conductivity:
      original === null ? null : unit === "uS/cm" ? original / 1000 : original,
  };
}
