export const numeric = Number.isFinite;

export function describe(values) {
  const sorted = values.filter(numeric).sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const median =
    (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2;
  const sd =
    n > 1
      ? Math.sqrt(
          sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1),
        )
      : null;
  return { n, min: sorted[0], max: sorted[n - 1], mean, median, sd };
}

export function oxygenSaturation(temperature, pressure, salinity = 0) {
  if (
    ![temperature, pressure, salinity].every(numeric) ||
    temperature < 0 ||
    temperature > 40 ||
    pressure < 507 ||
    pressure > 1114 ||
    salinity < 0 ||
    salinity > 40
  )
    return null;
  const t = temperature + 273.15;
  const baseline = Math.exp(
    -139.34411 +
      1.575701e5 / t -
      6.642308e7 / t ** 2 +
      1.2438e10 / t ** 3 -
      8.621949e11 / t ** 4,
  );
  const salt = Math.exp(-salinity * (0.017674 - 10.754 / t + 2140.7 / t ** 2));
  const p = pressure / 1013.25;
  const theta = 0.000975 - 1.426e-5 * temperature + 6.436e-8 * temperature ** 2;
  const vapor = Math.exp(11.8571 - 3840.7 / t - 216961 / t ** 2);
  return (
    (baseline * salt * ((p - vapor) * (1 - theta * p))) /
    ((1 - vapor) * (1 - theta))
  );
}

function ranks(values) {
  const sorted = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const result = new Array(values.length);
  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value)
      end++;
    for (let i = start; i < end; i++)
      result[sorted[i].index] = (start + end + 1) / 2;
    start = end;
  }
  return result;
}

export function correlation(rows, first, second, method) {
  const pairs = rows.filter(
    (row) => numeric(row[first]) && numeric(row[second]),
  );
  if (pairs.length < 3) return null;
  let x = pairs.map((row) => row[first]);
  let y = pairs.map((row) => row[second]);
  if (method === "spearman") [x, y] = [ranks(x), ranks(y)];
  const a = describe(x),
    b = describe(y);
  if (!a.sd || !b.sd) return null;
  return (
    x.reduce((sum, value, i) => sum + (value - a.mean) * (y[i] - b.mean), 0) /
    ((pairs.length - 1) * a.sd * b.sd)
  );
}

export function projectReference(report, values) {
  if (values.length !== report.features.length || !values.every(numeric))
    return null;
  const { mean, scale, centers, pcaMean } = report.projection;
  const standardized = values.map((value, i) => (value - mean[i]) / scale[i]);
  const pca = report.loadings.map((component) =>
    component.reduce(
      (total, weight, i) => total + weight * (standardized[i] - pcaMean[i]),
      0,
    ),
  );
  const distances = centers.map((center) =>
    Math.hypot(...center.map((value, i) => value - standardized[i])),
  );
  const distance = Math.min(...distances);
  const nearest = distances.indexOf(distance);
  const { distance95, distance99 } = report.clusters.find(
    (cluster) => cluster.id === nearest,
  );
  const outside = values.some((value, i) => {
    const [min, max] = report.ranges[report.features[i]];
    return value < min || value > max;
  });
  const status =
    distance > distance99
      ? "Fuera de distribución"
      : distance > distance95 || outside
        ? "Representatividad limitada"
        : "Dentro de la distribución de referencia";
  return {
    pca,
    distance,
    status,
    cluster: distance > distance99 ? null : nearest,
  };
}

export function reviewReadings(
  rows,
  sensors,
  threshold = 3.5,
  limit = 120,
  temperatureTolerance = 0.25,
) {
  const events = [];
  const range = rows.slice(-(limit + 33));
  const start = Math.max(0, range.length - limit);
  for (const sensor of sensors) {
    const { key } = sensor;
    range.slice(start).forEach((row, offset) => {
      const index = start + offset;
      const value = row[key];
      if (!numeric(value)) {
        events.push({
          row,
          sensor,
          value,
          cause: "Dato faltante · causa indeterminada",
        });
        return;
      }
      const elapsed = Date.parse(row.at) - Date.parse(range[0]?.at);
      if (numeric(elapsed) && elapsed < 15000 && start < 33) return;
      const floor =
        {
          temperature: temperatureTolerance,
          ph: 0.08,
          conductivity: 0.03,
          pressure: 0.8,
        }[key] ?? 0;
      const persistence = floor > 0 ? 3 : 1;
      const prior = range
        .slice(Math.max(0, index - 32), Math.max(0, index - (persistence - 1)))
        .filter(
          (reading) =>
            !numeric(Date.parse(row.at)) ||
            Date.parse(row.at) - Date.parse(reading.at) <= 15 * 60000,
        )
        .map((reading) => reading[key]);
      const baseline = describe(prior);
      if (
        floor === 0 &&
        prior.length >= 8 &&
        prior.slice(-8).every((previous) => previous === value)
      ) {
        events.push({
          row,
          sensor,
          value,
          cause: "Posible anomalía instrumental · valor constante",
        });
        return;
      }
      if (!baseline || baseline.n < 12) return;
      const mad = describe(
        prior
          .filter(numeric)
          .map((previous) => Math.abs(previous - baseline.median)),
      ).median;
      const delta = value - baseline.median;
      const needed = Math.max(floor, (threshold * mad) / 0.67449);
      const recent = range.slice(index - persistence + 1, index + 1);
      const persistent =
        recent.length === persistence &&
        recent.every(
          (row, i) =>
            numeric(row[key]) &&
            Math.sign(row[key] - baseline.median) === Math.sign(delta) &&
            Math.abs(row[key] - baseline.median) >
              needed * (i === recent.length - 1 ? 1 : 0.85),
        );
      if (persistent) {
        const score = mad > 0 ? (0.67449 * Math.abs(delta)) / mad : null;
        events.push({
          row,
          sensor,
          value,
          score,
          cause:
            persistence > 1
              ? "Cambio estadístico persistente · verificar origen"
              : "Cambio atípico · origen por revisar",
        });
      }
    });
  }
  return events.sort((a, b) => b.row.id - a.row.id);
}

export function environmentalStability(rows, sensors, threshold) {
  const last = Date.parse(rows.at(-1)?.at);
  const window = rows.filter(
    (row) => Date.parse(row.at) >= last - 24 * 3600000,
  );
  const histories = ["temperature", "ph", "conductivity"].map((key) =>
    describe(window.map((row) => row[key])),
  );
  if (
    window.length < 30 ||
    last - Date.parse(window[0]?.at) < 3600000 ||
    histories.some((stats) => !stats || stats.n < 30)
  )
    return null;
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const [temperature, ph, conductivity] = histories;
  const penalties = [
    clamp(temperature.sd / 3),
    clamp(ph.sd / 0.5),
    clamp(conductivity.sd / 0.15),
  ];
  const recent = window.slice(-120);
  const events = reviewReadings(recent, sensors, threshold);
  const consecutive = new Set(
    events
      .filter((event) => event.score)
      .map((event) => `${event.sensor.key}:${event.row.id}`),
  );
  const persistent = new Set(
    events
      .filter(
        (event) =>
          event.score &&
          consecutive.has(`${event.sensor.key}:${event.row.id - 1}`),
      )
      .map((event) => event.row.id),
  ).size;
  const qualityPenalty =
    1 -
    histories.reduce((sum, stats) => sum + stats.n, 0) / (3 * window.length);
  const score =
    100 *
    (1 -
      (penalties[0] * 0.2 +
        penalties[1] * 0.2 +
        penalties[2] * 0.2 +
        (0.2 * persistent) / recent.length +
        0.2 * qualityPenalty));
  return { score, records: window.length, penalties };
}
