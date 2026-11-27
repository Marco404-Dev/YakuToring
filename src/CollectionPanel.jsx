import React, { useEffect, useState } from "react";
import SessionReview from "./SessionReview.jsx";
import { profiles } from "./thresholds.js";

const labels = {
  active: "En curso",
  paused: "Pausada",
  complete: "Completada",
  finished: "Finalizada anticipadamente",
};
const name = (id) => `Sesión ${String(id).padStart(3, "0")}`;

export default function CollectionPanel({
  collection,
  canManage,
  onShowHistory,
  connection,
  api,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("100");
  const [custom, setCustom] = useState("");
  const [review, setReview] = useState(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const sessions = collection?.sessions ?? [];
  const active = sessions.find((session) => session.status === "active");
  const selected =
    sessions.find((session) => session.id === selectedId) ??
    active ??
    sessions[0];
  const limit = selected?.target ?? collection?.limit ?? 100;
  const span = selected
    ? Date.parse(selected.lastSample) - Date.parse(selected.firstSample)
    : 0;
  const eta =
    selected?.status === "active" && selected.count >= 3 && span > 0
      ? Math.ceil(
          ((limit - selected.count) * span) / (selected.count - 1) / 60000,
        )
      : null;

  async function action(route, body = {}) {
    setBusy(true);
    setError("");
    try {
      const result = await api(`collection/${route}`, body);
      setSelectedId(result.id);
      setNotice(
        {
          start: "Recolección iniciada",
          pause: "Sesión pausada",
          resume: "Recolección reanudada",
          finish: "Sesión finalizada",
        }[route.split("/").at(-1)] || "Sesión actualizada",
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="panel collection-panel"
      aria-labelledby="collection-title"
    >
      <div className="section-title">
        <div>
          <h2 id="collection-title">Recolección de mediciones LoRa</h2>
          <p>
            {connection}
            {active ? ` · ${name(active.id)} en curso` : ""}
          </p>
        </div>
      </div>
      {canManage && (
        <details>
          <summary>Nueva sesión de recolección</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const fields = Object.fromEntries(
                new FormData(event.currentTarget),
              );
              action("start", {
                ...fields,
                target: Number(preset === "custom" ? custom : preset),
                depth: fields.depth === "" ? null : Number(fields.depth),
              });
            }}
          >
            <div className="field-grid">
              <label>
                Cantidad objetivo
                <select
                  value={preset}
                  onChange={(event) => setPreset(event.target.value)}
                >
                  {[25, 50, 100, 200, 500, 1000].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                  <option value="custom">Personalizada</option>
                </select>
              </label>
              {preset === "custom" && (
                <label>
                  Cantidad personalizada
                  <input
                    required
                    type="number"
                    min="1"
                    max={collection?.max ?? 10000}
                    step="1"
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                  />
                </label>
              )}
              <label>
                Nombre
                <input name="name" maxLength={120} />
              </label>
              <label>
                Lugar de muestreo
                <input name="location" maxLength={120} />
              </label>
              <label>
                Profundidad (m)
                <input
                  name="depth"
                  type="number"
                  min="0"
                  max="11000"
                  step="any"
                />
              </label>
              <label>
                Tipo de ecosistema
                <select name="ecosystem">
                  <option value="">Sin especificar</option>
                  {Object.entries(profiles).map(([key, entry]) => (
                    <option key={key} value={key}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Observaciones
              <textarea name="notes" maxLength={1000} />
            </label>
            <button
              className="primary"
              disabled={!collection || busy || !!active}
            >
              Iniciar recolección
            </button>
          </form>
        </details>
      )}
      {selected && (
        <>
          <label>
            Sesión de recolección
            <select
              value={selected.id}
              onChange={(event) => {
                setSelectedId(Number(event.target.value));
                setError("");
              }}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name || name(session.id)} ·{" "}
                  {new Date(session.createdAt).toLocaleString("es-PE", {
                    timeZone: "America/Lima",
                  })}{" "}
                  · {labels[session.status]}
                </option>
              ))}
            </select>
          </label>
          <p role="status">
            Mediciones registradas: {selected.count} / {limit} ·{" "}
            {labels[selected.status]} ·{" "}
            {Math.floor((selected.count / limit) * 100)} %
          </p>
          <p>
            {[
              selected.location,
              profiles[selected.ecosystem]?.name || selected.ecosystem,
              selected.depth == null ? null : `${selected.depth} m`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {selected.notes && <p>{selected.notes}</p>}
          <p>
            Tiempo transcurrido:{" "}
            {Math.max(
              0,
              Math.floor(
                ((selected.status === "active"
                  ? Date.now()
                  : Date.parse(
                      selected.endedAt ??
                        selected.lastSample ??
                        selected.createdAt,
                    )) -
                  Date.parse(selected.createdAt)) /
                  60000,
              ),
            )}{" "}
            min{eta !== null && ` · Tiempo restante aproximado: ${eta} min`}
          </p>
          <progress
            aria-label="Mediciones registradas"
            value={selected.count}
            max={limit}
          />
          <div className="collection-actions">
            {canManage && selected.status === "active" && (
              <button
                disabled={busy}
                onClick={() => action(`${selected.id}/pause`)}
              >
                Pausar sesión
              </button>
            )}
            {canManage && selected.status === "paused" && (
              <button
                disabled={busy || !!active}
                onClick={() => action(`${selected.id}/resume`)}
              >
                Reanudar sesión
              </button>
            )}
            <button type="button" onClick={() => onShowHistory(selected.id)}>
              Ver mediciones
            </button>
            {canManage && ["active", "paused"].includes(selected.status) && (
              <button
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "¿Finalizar la sesión y conservar las mediciones registradas?",
                    )
                  )
                    action(`${selected.id}/finish`);
                }}
              >
                Finalizar sesión
              </button>
            )}
            {canManage ? (
              <a
                className="collection-download"
                href={`/api/collection/${selected.id}/export.csv`}
                download
              >
                Descargar CSV{selected.status === "active" ? " parcial" : ""}
              </a>
            ) : (
              <button type="button" disabled>
                Descargar CSV
              </button>
            )}
            {selected.count > 0 && (
              <button
                onClick={() => setReview({ id: selected.id, mode: "report" })}
              >
                Reporte PDF
              </button>
            )}
            {selected.count > 0 && !["active"].includes(selected.status) && (
              <button
                disabled={!connection.includes("desconectado")}
                onClick={() => setReview({ id: selected.id, mode: "demo" })}
              >
                Modo demostración
              </button>
            )}
          </div>
          {!canManage && (
            <small>
              Inicia sesión como administrador u operador para descargar el CSV.
            </small>
          )}
        </>
      )}
      {review && (
        <SessionReview
          api={api}
          {...review}
          disconnected={connection.includes("desconectado")}
          onClose={() => setReview(null)}
        />
      )}
      {(error || collection?.error) && (
        <p role="alert">{error || collection.error}</p>
      )}
      {notice && (
        <div className="operation-toast" role="status">
          {notice}
        </div>
      )}
    </section>
  );
}
