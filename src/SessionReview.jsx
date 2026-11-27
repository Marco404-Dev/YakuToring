import React, { useEffect, useState } from "react";
import { Dialog } from "./Guidance.jsx";
import { describe, oxygenSaturation } from "./environment.js";
import { sensors } from "./sensors.js";
import { evaluateReference, profiles } from "./thresholds.js";
import "./refinement.css";

const fields = [
  ...sensors,
  { key: "od_estimado_mg_l", name: "OD estimado", unit: "mg/L" },
];
const format = (value) => (Number.isFinite(value) ? value.toFixed(2) : "—");
const date = (value) =>
  value
    ? new Date(value).toLocaleString("es-PE", { timeZone: "America/Lima" })
    : "—";

function Trace({ rows, field, stats }) {
  if (!stats || stats.n < 2) return null;
  const width = 360;
  const step = Math.max(1, Math.ceil(rows.length / width));
  let pen = false;
  const trace = [];
  for (let i = 0; i < rows.length; i += step) {
    const value = rows[i][field.key];
    if (!Number.isFinite(value)) {
      pen = false;
      continue;
    }
    trace.push(
      `${pen ? "L" : "M"}${(i * width) / (rows.length - 1)},${46 - ((value - stats.min) * 38) / (stats.max - stats.min || 1)}`,
    );
    pen = true;
  }
  return (
    <svg
      viewBox="0 0 360 52"
      role="img"
      aria-label={`Serie de ${field.name} en ${field.unit || "unidades de pH"}`}
    >
      <path
        d={trace.join(" ")}
        fill="none"
        stroke="#117c72"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export default function SessionReview({
  api,
  id,
  mode,
  disconnected,
  onClose,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    let active = true;
    api(`collection/${id}/measurements`)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [api, id]);
  const total = data?.rows.length ?? 0;
  useEffect(() => {
    if (!disconnected || !playing || index >= total - 1) return;
    const timer = setTimeout(() => setIndex((i) => i + 1), 1000 / speed);
    return () => clearTimeout(timer);
  }, [disconnected, playing, index, speed, total]);
  const demo = mode === "demo";
  const record = data?.rows[index];
  const last = data?.rows.at(-1);
  const saturation = oxygenSaturation(last?.temperature, last?.pressure);
  return (
    <Dialog
      title={
        demo ? "Modo demostración — datos históricos" : "Reporte de sesión"
      }
      onClose={onClose}
    >
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">Cargando mediciones guardadas…</p>}
      {data &&
        (demo ? (
          !disconnected ? (
            <p>
              La reproducción está suspendida mientras el Receiver está
              conectado.
            </p>
          ) : (
            <>
              <p>
                {data.session.name || `Sesión ${id}`} · {index + 1}/{total} ·{" "}
                {date(record?.at)}
              </p>
              <div className="controls">
                <button
                  disabled={!total}
                  onClick={() => {
                    if (index >= total - 1) {
                      setIndex(0);
                      setPlaying(true);
                    } else setPlaying(!playing);
                  }}
                >
                  {playing && index < total - 1 ? "Pausar" : "Reproducir"}
                </button>
                <label>
                  Velocidad
                  <select
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  >
                    {[0.5, 1, 2, 4].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Medición
                <input
                  type="range"
                  min="0"
                  max={Math.max(total - 1, 0)}
                  value={index}
                  onChange={(e) => {
                    setIndex(Number(e.target.value));
                    setPlaying(false);
                  }}
                />
              </label>
              <dl>
                {fields.map((field) => (
                  <div key={field.key}>
                    <dt>{field.name}</dt>
                    <dd>
                      {format(record?.[field.key])} {field.unit}
                    </dd>
                  </div>
                ))}
              </dl>
              <p>
                Reproducción aislada de registros guardados. No se emiten
                notificaciones.
              </p>
            </>
          )
        ) : (
          <>
            <button
              className="primary print-session-button"
              onClick={() => window.print()}
            >
              Guardar como PDF
            </button>
            <article className="session-print">
              <h1>YakuToring · Reporte de monitoreo</h1>
              <h2>{data.session.name || `Sesión ${id}`}</h2>
              <p>
                Inicio {date(data.session.createdAt)} · {total} de{" "}
                {data.session.target} mediciones · Lugar{" "}
                {data.session.location || "Sin registrar"} · Profundidad{" "}
                {data.session.depth ?? "—"} m
              </p>
              <p>Ecosistema {data.session.ecosystem || "Sin registrar"}</p>
              {data.session.notes && <p>{data.session.notes}</p>}
              {fields.map((field) => {
                const stats = describe(data.rows.map((row) => row[field.key]));
                return (
                  <section key={field.key}>
                    <h3>
                      {field.name} {field.unit}
                    </h3>
                    <p>
                      {field.key === "od_estimado_mg_l"
                        ? "Estimación predictiva"
                        : field.key === "conductivity"
                          ? "Valor derivado de calibración provisional"
                          : "Medición directa"}{" "}
                      · N {stats?.n ?? 0} · Mín. {format(stats?.min)} · Media{" "}
                      {format(stats?.mean)} · Máx. {format(stats?.max)} · DE{" "}
                      {format(stats?.sd)}
                    </p>
                    <Trace rows={data.rows} field={field} stats={stats} />
                  </section>
                );
              })}
              <h3>Interpretación y límites</h3>
              {Number.isFinite(saturation) && (
                <p>
                  Saturación teórica en agua dulce para el último paquete:{" "}
                  {format(saturation)} mg/L. Referencia de equilibrio sin
                  salinidad validada.
                </p>
              )}
              <p>
                Perfil de referencia:{" "}
                {profiles[data.session.ecosystem]?.name ||
                  "Sin referencia asignada"}
                .{" "}
                {
                  evaluateReference(
                    data.session.ecosystem,
                    "ph",
                    data.rows.at(-1)?.ph,
                  ).label
                }
                . La comparación es orientativa. El OD estimado requiere
                contraste con sonda y la conductividad requiere verificación
                instrumental.
              </p>
              <p>
                Fuente para perfiles E1/E3: D. S. N.° 004-2017-MINAM, categoría
                4.
              </p>
              <h3>Eventos detectados</h3>
              {data.events?.length ? (
                <ul>
                  {data.events.map((event) => (
                    <li key={event.id}>
                      {date(event.lastAt)} · {event.cause} · {event.occurrences}{" "}
                      detecciones
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  Sin eventos en el historial disponible para este intervalo.
                </p>
              )}
            </article>
          </>
        ))}
    </Dialog>
  );
}
