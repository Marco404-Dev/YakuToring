export const ecaSource =
  "https://www.digesa.minsa.gob.pe/norma_consulta/ECA%20AGUA%20DS-004-2017-MINAM.pdf";
export const profiles = {
  E3: {
    name: "Manglar o estuario · E3 estuarios",
    ph: [6.8, 8.5],
    oxygen: 4,
    delta: 2,
  },
  E1: {
    name: "Laguna o humedal · E1 lagunas y lagos",
    ph: [6.5, 9],
    oxygen: 5,
    conductivity: 1,
    delta: 3,
  },
  lab: { name: "Laboratorio" },
  custom: { name: "Perfil personalizado" },
};
export const defaults = {
  phMargin: 0.2,
  oxygenMargin: 1,
  baseline: null,
  phLow: null,
  phHigh: null,
  oxygenMin: null,
  conductivityVerified: false,
};

export function referenceBand(profile, key, options = defaults) {
  const selected = profiles[profile];
  if (!selected) return null;
  const custom = profile === "custom";
  const ph =
    custom &&
    Number.isFinite(options.phLow) &&
    Number.isFinite(options.phHigh) &&
    options.phLow < options.phHigh
      ? [options.phLow, options.phHigh]
      : selected.ph;
  const oxygen = custom ? options.oxygenMin : selected.oxygen;
  if (key === "ph" && ph)
    return {
      min: ph[0],
      max: ph[1],
      margin: Math.min(options.phMargin, (ph[1] - ph[0]) / 2),
    };
  if (key === "od_estimado_mg_l" && Number.isFinite(oxygen))
    return { min: oxygen, max: Infinity, margin: options.oxygenMargin };
  if (
    key === "conductivity" &&
    selected.conductivity &&
    options.conductivityVerified
  )
    return { min: -Infinity, max: selected.conductivity, margin: 0 };
  if (
    key === "temperature" &&
    selected.delta &&
    Number.isFinite(options.baseline)
  )
    return {
      min: options.baseline - selected.delta,
      max: options.baseline + selected.delta,
      margin: 0,
    };
  return null;
}

export function evaluateReference(profile, key, value, options = defaults) {
  const band = referenceBand(profile, key, options);
  if (!Number.isFinite(value))
    return { tone: "gray", label: "Sin datos", band };
  if (!band)
    return {
      tone: "gray",
      label: "Referencia no aplicable o sin verificar",
      band,
    };
  if (value < band.min || value > band.max)
    return { tone: "red", label: "Fuera de referencia", band };
  if (value < band.min + band.margin || value > band.max - band.margin)
    return { tone: "yellow", label: "Precaución", band };
  return { tone: "green", label: "Dentro de referencia", band };
}
