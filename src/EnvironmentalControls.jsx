import React from "react";
import { ecaSource, evaluateReference, profiles } from "./thresholds.js";

const metrics = [
  ["ph", "pH"],
  ["temperature", "Temperatura"],
  ["conductivity", "Conductividad"],
  ["pressure", "Presión"],
  ["od_estimado_mg_l", "OD estimado"],
];

export function ReferenceStrip({
  profile,
  setProfile,
  options,
  row,
  rows = [],
  uncertain,
}) {
  const recent = rows.slice(-3);
  const persistent = metrics.filter(
    ([key]) =>
      key !== "od_estimado_mg_l" &&
      recent.length === 3 &&
      recent.every(
        (item) =>
          evaluateReference(profile, key, item[key], options).tone === "red",
      ),
  );
  return (
    <section className="panel guidance">
      <div className="section-title">
        <h2>Referencia ambiental</h2>
        <label>
          Entorno
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            {Object.entries(profiles).map(([key, entry]) => (
              <option value={key} key={key}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-grid">
        {metrics.map(([key, label]) => {
          const value = row?.[key],
            result = evaluateReference(profile, key, value, options);
          return (
            <div key={key}>
              <strong>{label}</strong>
              <br />
              <span className={`signal-chip ${result.tone}`}>
                {result.label}
              </span>
              {result.band && Number.isFinite(value) && (
                <RangeMarker value={value} band={result.band} />
              )}
            </div>
          );
        })}
      </div>
      {uncertain && (
        <p>
          El OD estimado presenta incertidumbre importante. Confirma con una
          sonda antes de interpretar el indicador.
        </p>
      )}
      {persistent.length > 0 && (
        <p>
          <strong>Condición fuera de referencia persistente.</strong>{" "}
          {persistent.map(([, name]) => name).join(", ")} quedó fuera del
          intervalo en los últimos tres paquetes. Repite la medición y verifica
          las condiciones del sitio.
        </p>
      )}
      <small>
        Las zonas amarillas son márgenes preventivos de YakuToring. Selección
        orientativa, sin asignación oficial de la ANA.{" "}
        <a href={ecaSource}>D. S. 004-2017-MINAM · categoría 4</a>.
      </small>
    </section>
  );
}

function RangeMarker({ value, band }) {
  const low = Number.isFinite(band.min) ? band.min : band.max - 1;
  const high = Number.isFinite(band.max)
    ? band.max
    : band.min + Math.max(1, 2 * band.margin);
  const pad = (high - low) * 0.25 || 0.2;
  const min = low - pad,
    max = high + pad;
  const x = (point) =>
    Math.min(100, Math.max(0, (100 * (point - min)) / (max - min)));
  const start = x(band.min),
    end = x(band.max);
  return (
    <svg
      viewBox="0 0 100 12"
      className="range-svg"
      role="img"
      aria-label={`Valor ${value}; referencia ${Number.isFinite(band.min) ? band.min : "sin mínimo"} a ${Number.isFinite(band.max) ? band.max : "sin máximo"}`}
    >
      <rect y="3" width="100" height="6" rx="2" fill="#daa09b" />
      <rect
        x={start}
        y="3"
        width={end - start}
        height="6"
        fill={band.margin ? "#e3c36e" : "#83c7ac"}
      />
      {band.margin > 0 && (
        <rect
          x={x(band.min + band.margin)}
          y="3"
          width={Math.max(
            0,
            x(band.max - band.margin) - x(band.min + band.margin),
          )}
          height="6"
          fill="#83c7ac"
        />
      )}
      <line
        x1={x(value)}
        x2={x(value)}
        y1="0"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function ReferenceSettings({
  options,
  setOptions,
  tolerance,
  setTolerance,
}) {
  const inputs = [
    ["phMargin", "Margen preventivo de pH", 0, 1],
    ["oxygenMargin", "Margen preventivo de OD (mg/L)", 0, 5],
    ["baseline", "Promedio mensual multianual del sitio (°C)", 0, 50],
    ["phLow", "pH mínimo personalizado", 0, 14],
    ["phHigh", "pH máximo personalizado", 0, 14],
    ["oxygenMin", "OD mínimo personalizado (mg/L)", 0, 25],
  ];
  return (
    <section className="panel guidance">
      <h2>Referencias y sensibilidad</h2>
      <div className="field-grid">
        {inputs.map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min={min}
              max={max}
              step="any"
              value={options[key] ?? ""}
              onChange={(e) => {
                const value = e.target.valueAsNumber;
                if (e.target.value === "" || (value >= min && value <= max))
                  setOptions({
                    ...options,
                    [key]:
                      e.target.value === ""
                        ? ["phMargin", "oxygenMargin"].includes(key)
                          ? 0
                          : null
                        : value,
                  });
              }}
            />
          </label>
        ))}
        <label>
          Tolerancia estadística de temperatura (°C)
          <input
            type="number"
            min="0.0625"
            max="5"
            step="any"
            value={tolerance}
            onChange={(e) => {
              const value = e.target.valueAsNumber;
              if (value >= 0.0625 && value <= 5) setTolerance(value);
            }}
          />
        </label>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={options.conductivityVerified}
          onChange={(e) =>
            setOptions({ ...options, conductivityVerified: e.target.checked })
          }
        />{" "}
        Conductividad verificada para comparar con E1
      </label>
      <p>
        Introduce la línea base de temperatura solo si corresponde al mes y al
        área evaluados. La tolerancia de alertas se aplica a la estación.
      </p>
    </section>
  );
}
