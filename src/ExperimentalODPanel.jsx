import React, { useState } from "react";
import { sensors, formatReading } from "./sensors.js";

const date = (at) =>
  new Date(at).toLocaleString("es-PE", { timeZone: "America/Lima" });
const oxygen = (value) =>
  Number.isFinite(value) ? `${value.toFixed(2)} mg/L` : "—";

function Result({ record }) {
  return (
    <>
      {record.at && (
        <p>
          Fecha y hora (Lima){" "}
          <time dateTime={record.at}>{date(record.at)}</time>
        </p>
      )}
      <dl>
        {sensors.map(({ key, name }) => (
          <React.Fragment key={key}>
            <dt>{name}</dt>
            <dd>
              {formatReading(record.sensors[key]?.value, key) ||
                "Sin lectura válida"}
            </dd>
          </React.Fragment>
        ))}
        <dt>OD estimado</dt>
        <dd>
          <strong>{oxygen(record.od_estimado_mg_l)}</strong>
        </dd>
        {record.od_referencia_mg_l != null && (
          <>
            <dt>OD de referencia</dt>
            <dd>{oxygen(record.od_referencia_mg_l)}</dd>
          </>
        )}
        {record.error_absoluto_mg_l != null && (
          <>
            <dt>Error absoluto</dt>
            <dd>{oxygen(record.error_absoluto_mg_l)}</dd>
          </>
        )}
      </dl>
      <p role="status">{record.message}</p>
      {record.warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
    </>
  );
}

export default function ExperimentalODPanel({
  ml,
  canReference,
  api,
  enabled = true,
}) {
  const [selectedId, setSelectedId] = useState("");
  const [reference, setReference] = useState("");
  const [demo, setDemo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const od = ml?.experimentalOd;
  const selected = od?.history.find((record) => record.id === selectedId);
  const displayed = selected ?? od?.latest;

  async function tryDemo() {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await api("ml/od/demo");
      setDemo(response.demo);
    } catch (error) {
      setFeedback({ error: error.message });
    } finally {
      setBusy(false);
    }
  }

  async function saveReference(event) {
    event.preventDefault();
    if (!selected || reference.trim() === "") return;
    setBusy(true);
    setFeedback(null);
    try {
      await api("ml/od/reference", {
        measurementId: selected.id,
        value: Number(reference),
      });
      setReference("");
      setFeedback({
        message: "Referencia guardada en la medición seleccionada.",
      });
    } catch (error) {
      setFeedback({ error: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="notifications" aria-labelledby="experimental-od-title">
      <div className="section-title">
        <div>
          <h2 id="experimental-od-title">Oxígeno disuelto estimado</h2>
          <p>
            HistGradientBoosting · NOAA · Pendiente de validación en el manglar
            peruano.
          </p>
        </div>
        <span className="badge">EXPERIMENTAL</span>
      </div>
      <p>
        Las zonas son orientativas. Los límites describen dónde cae la
        estimación en el intervalo prioritario de 4 a 10 mg/L.
      </p>
      <p>
        {od?.allowProvisionalEc
          ? "Ensayo habilitado con EC provisional."
          : "Predicción de campo bloqueada mientras se valida la EC."}
      </p>
      {ml?.error && <p role="alert">{ml.error}</p>}
      {od?.error && <p role="alert">{od.error}</p>}
      {od?.history.length > 0 && (
        <label>
          Medición del lote {od.latest.lotId}
          <select
            value={selected?.id ?? ""}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setReference("");
              setFeedback(null);
            }}
          >
            <option value="">Última medición recibida</option>
            {od.history.map((record) => (
              <option key={record.id} value={record.id}>
                {date(record.at)} · Paquete {record.sequence ?? "—"}
              </option>
            ))}
          </select>
        </label>
      )}
      {displayed ? (
        <Result record={displayed} />
      ) : (
        <p>Sin mediciones de campo para este lote.</p>
      )}
      {od?.metrics.n > 0 && (
        <p>
          MAE acumulado del lote <strong>{oxygen(od.metrics.mae)}</strong> (
          {od.metrics.n} pares de campo)
        </p>
      )}
      {canReference && od?.latest && (
        <form onSubmit={saveReference}>
          <label>
            OD de la sonda externa (mg/L)
            <input
              type="number"
              required
              min="0"
              step="any"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              disabled={!selected || busy}
            />
          </label>
          <button disabled={!selected || busy}>Guardar referencia</button>
          {!selected && (
            <p>
              Selecciona el paquete correspondiente a la misma toma de la sonda.
            </p>
          )}
        </form>
      )}
      {enabled && (
        <button
          type="button"
          disabled={busy || ml?.status !== "ready" || !!od?.error}
          onClick={tryDemo}
        >
          Probar con datos simulados
        </button>
      )}
      {feedback?.error && <p role="alert">{feedback.error}</p>}
      {feedback?.message && <p role="status">{feedback.message}</p>}
      {demo && (
        <div>
          <h3>Demostración con datos simulados</h3>
          <Result record={demo} />
        </div>
      )}
    </section>
  );
}
