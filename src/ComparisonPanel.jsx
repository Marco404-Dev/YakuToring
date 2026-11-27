import React, { useState } from "react";
import { describe } from "./environment.js";
import { Histogram } from "./Distribution.jsx";

export const modelNames = {
  catboost: "CatBoost",
  mlp: "Deep Learning MLP",
  weighted: "Híbrido ponderado 55/45",
  stacking: "Híbrido Stacking Ridge",
};
const keys = Object.keys(modelNames);
const mg = (value) => (Number.isFinite(value) ? value.toFixed(3) : "—");
const when = (value) =>
  value
    ? new Date(value).toLocaleString("es-PE", { timeZone: "America/Lima" })
    : "—";
const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const iso = (value) => new Date(value).toISOString();

function Agreement({ metrics }) {
  const [model, setModel] = useState("catboost");
  const [view, setView] = useState("observed");
  const pairs = metrics[model]?.pairs ?? [];
  if (!metrics || !keys.some((key) => metrics[key]?.n)) return null;
  const observed = view === "observed";
  const points = pairs.map((pair) => ({
    ...pair,
    x: observed ? pair.reference : (pair.reference + pair.prediction) / 2,
    y: observed ? pair.prediction : pair.prediction - pair.reference,
  }));
  const bounds = (values) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return [min - 0.1, max + 0.1];
  };
  const joint = points.flatMap((point) => [point.x, point.y]);
  const bias = metrics[model]?.bias;
  const differences = points.map((point) => point.y);
  const limitWidth =
    !observed && points.length >= 3 ? 1.96 * describe(differences).sd : null;
  const agreementLimits =
    limitWidth === null ? [] : [bias - limitWidth, bias + limitWidth];
  const [xMin, xMax] = bounds(
    observed ? joint : points.map((point) => point.x),
  );
  const [yMin, yMax] = bounds(
    observed ? joint : [0, ...differences, ...agreementLimits],
  );
  const x = (value) => 52 + (490 * (value - xMin)) / (xMax - xMin);
  const y = (value) => 210 - (178 * (value - yMin)) / (yMax - yMin);
  return (
    <details>
      <summary>Concordancia por muestra física</summary>
      <div className="field-grid">
        <label>
          Modelo
          <select
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            {keys.map((key) => (
              <option key={key} value={key}>
                {modelNames[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Gráfico
          <select
            value={view}
            onChange={(event) => setView(event.target.value)}
          >
            <option value="observed">OD medido y predicho</option>
            <option value="bland">Bland–Altman · sesgo</option>
            <option value="residual">Distribución de residuos</option>
          </select>
        </label>
      </div>
      {view === "residual" ? (
        <Histogram values={differences} unit="mg/L" />
      ) : points.length ? (
        <svg
          className="pca-plot"
          viewBox="0 0 590 250"
          role="img"
          aria-label={
            observed
              ? "Oxígeno de sonda frente al predicho"
              : "Diferencia predicción menos sonda frente al promedio de ambos"
          }
        >
          <path d="M52 27V210H552" fill="none" stroke="currentColor" />
          {observed ? (
            <line
              x1={x(xMin)}
              x2={x(xMax)}
              y1={y(yMin)}
              y2={y(yMax)}
              stroke="currentColor"
              strokeDasharray="4 3"
            />
          ) : (
            <line
              x1={x(xMin)}
              x2={x(xMax)}
              y1={y(bias)}
              y2={y(bias)}
              stroke="currentColor"
              strokeDasharray="4 3"
            />
          )}
          {agreementLimits.map((value, i) => (
            <line
              key={i}
              x1={52}
              x2={542}
              y1={y(value)}
              y2={y(value)}
              stroke="#b5541a"
              strokeDasharray="3 4"
            />
          ))}
          <text x="56" y="19">
            {observed ? "OD predicho" : "Diferencia predicho − sonda"} (mg/L)
          </text>
          <text x="56" y="239">
            {observed ? "OD sonda" : "OD promedio"} (mg/L)
          </text>
          <text x="53" y="228">
            {mg(xMin)}
          </text>
          <text x="542" y="228" textAnchor="end">
            {mg(xMax)}
          </text>
          <text x="48" y="37" textAnchor="end">
            {mg(yMax)}
          </text>
          <text x="48" y="210" textAnchor="end">
            {mg(yMin)}
          </text>
          {points.map((point) => (
            <circle
              key={`${point.point}/${point.sample}`}
              cx={x(point.x)}
              cy={y(point.y)}
              r="4"
              fill="#0d9488"
            >
              <title>
                {point.sample} · {mg(point.x)}, {mg(point.y)} mg/L ·{" "}
                {point.readings} lecturas
              </title>
            </circle>
          ))}
        </svg>
      ) : (
        <p>El modelo elegido todavía carece de pares válidos.</p>
      )}
      <p>
        Las lecturas con el mismo código y punto se promedian dentro de la
        sesión y fase.
      </p>
      {view === "bland" && (
        <p>
          {agreementLimits.length
            ? `Límites descriptivos de concordancia (sesgo ± 1,96 DE): ${agreementLimits.map(mg).join(" a ")} mg/L.`
            : "Se requieren al menos tres muestras físicas para calcular límites descriptivos."}
        </p>
      )}
    </details>
  );
}

export function ModelResults({ run, availability = {}, sample }) {
  return (
    <>
      <p>Medición de sensores · {when(run?.at)} (Lima)</p>
      {run?.inputs && (
        <p>
          Conductividad recibida {run.inputs.conductivityOriginal ?? "—"}{" "}
          {run.inputs.conductivityUnit}
          {" · "}Conductividad para modelos {run.inputs.conductivity ?? "—"}{" "}
          mS/cm
        </p>
      )}
      <div className="comparison-grid">
        {keys.map((key) => {
          const result = run?.models[key];
          return (
            <article className="panel" key={key}>
              <h3>{modelNames[key]}</h3>
              <p className="comparison-value">
                {mg(result?.value)} <small>mg/L</small>
              </p>
              <p>
                {result?.status === "experimental"
                  ? "Estimación experimental"
                  : result?.status === "invalid_inputs"
                    ? "Entradas incompletas o inválidas"
                    : availability[key]?.loaded
                      ? "Disponible · esperando medición"
                      : "Modelo no disponible"}
              </p>
              {(result?.error || availability[key]?.error) && (
                <p role="status">{result?.error || availability[key].error}</p>
              )}
            </article>
          );
        })}
      </div>
      {Number.isFinite(run?.spread) && (
        <p>
          Diferencia máxima–mínima entre modelos ·{" "}
          <strong>{mg(run.spread)} mg/L</strong>. Desacuerdo descriptivo entre
          las cuatro estimaciones.
        </p>
      )}
      {run?.warnings?.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
      {sample && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Modelo</th>
                <th>OD predicho (mg/L)</th>
                <th>OD sonda (mg/L)</th>
                <th>Error absoluto (mg/L)</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key}>
                  <td>{modelNames[key]}</td>
                  <td>{mg(run.models[key].value)}</td>
                  <td>{mg(sample.reference)}</td>
                  <td>{mg(sample.errors[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ReferenceForm({ sample, submit, busy }) {
  const [value, setValue] = useState(sample.reference ?? "");
  const [at, setAt] = useState(localNow());
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit("experiments/reference", {
          sampleId: sample.id,
          value: Number(value),
          at: iso(at),
        });
      }}
      className="experiment-form"
    >
      <label>
        OD de la sonda del laboratorio (mg/L)
        <input
          required
          type="number"
          min="0"
          max="100"
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <label>
        Fecha y hora de la sonda · hora local del equipo
        <input
          required
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
      </label>
      <button disabled={busy}>Guardar OD de referencia</button>
    </form>
  );
}

export default function ComparisonPanel({ comparison, canManage, api }) {
  const [sessionId, setSessionId] = useState("");
  const [runId, setRunId] = useState("");
  const [olderRuns, setOlderRuns] = useState([]);
  const [oldestCursor, setOldestCursor] = useState(null);
  const [historyEnd, setHistoryEnd] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [meta, setMeta] = useState({
    sampleCode: "",
    samplingPoint: "",
    depthM: "",
    collectedAt: "",
    phase: "laboratory",
    observations: "",
  });
  const sessions = comparison?.sessions ?? [];
  const session = sessions.find((item) => item.id === sessionId) ?? sessions[0];
  const runs = [
    ...new Map(
      [...(comparison?.recent ?? []), ...olderRuns].map((item) => [
        item.id,
        item,
      ]),
    ).values(),
  ];
  const run = runs.find((item) => item.id === runId);
  function field(key, value) {
    setMeta((old) => ({ ...old, [key]: value }));
  }
  async function submit(route, payload) {
    setBusy(true);
    setFeedback(null);
    try {
      await api(route, payload);
      setFeedback({
        message:
          "Datos guardados. El panel se actualizará con la siguiente lectura del servidor.",
      });
      return true;
    } catch (error) {
      setFeedback({ error: error.message });
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function loadOlder() {
    setBusy(true);
    setFeedback(null);
    try {
      const cursor = oldestCursor ?? runs.at(-1)?.cursor;
      const response = await api(
        `experiments/runs${cursor ? `?before=${cursor}` : ""}`,
      );
      setOlderRuns((old) => [...old, ...response.runs]);
      if (response.runs.length) setOldestCursor(response.runs.at(-1).cursor);
      setHistoryEnd(response.runs.length < 30);
    } catch (error) {
      setFeedback({ error: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel comparison-section"
      aria-labelledby="comparison-title"
    >
      <div className="section-title">
        <h2 id="comparison-title">
          Comparación experimental de modelos de oxígeno disuelto
        </h2>
        <span className="badge">EXPERIMENTAL</span>
      </div>
      <ModelResults
        run={comparison?.latest}
        availability={comparison?.availability}
      />
      <h3>Validación con muestras y sonda de laboratorio</h3>
      {canManage && (
        <form
          className="experiment-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await submit("experiments/sessions", { name })) {
              setName("");
              setSessionId("");
            }
          }}
        >
          <label>
            Nombre de sesión experimental
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button disabled={busy}>Crear sesión experimental</button>
        </form>
      )}
      {sessions.length > 0 && (
        <label>
          Sesión experimental
          <select
            value={session?.id ?? ""}
            onChange={(e) => setSessionId(e.target.value)}
          >
            {sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.count}/100
              </option>
            ))}
          </select>
        </label>
      )}
      {session && (
        <>
          <p>Mediciones registradas · {session.count}/100</p>
          {canManage && (
            <a
              className="collection-download"
              href={`/api/experiments/${session.id}/export.csv`}
              download
            >
              Descargar CSV experimental
            </a>
          )}
          {canManage && session.count < 100 && (
            <form
              className="experiment-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (
                  await submit("experiments/samples", {
                    sessionId: session.id,
                    runId,
                    metadata: {
                      ...meta,
                      collectedAt: iso(meta.collectedAt),
                      depthM: meta.depthM === "" ? null : Number(meta.depthM),
                    },
                  })
                ) {
                  setRunId("");
                  field("sampleCode", "");
                }
              }}
            >
              <label>
                Medición de sensores que corresponde a esta muestra
                <select
                  required
                  value={runId}
                  onChange={(e) => setRunId(e.target.value)}
                >
                  <option value="">Seleccionar medición guardada</option>
                  {runs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {when(item.at)} · Paquete {item.packet ?? "—"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || historyEnd}
                onClick={loadOlder}
              >
                {historyEnd
                  ? "Historial cargado"
                  : "Cargar mediciones anteriores"}
              </button>
              {run && (
                <p>
                  EC original {run.inputs.conductivityOriginal ?? "—"}{" "}
                  {run.inputs.conductivityUnit} · EC presentada{" "}
                  {run.inputs.conductivity ?? "—"} mS/cm
                </p>
              )}
              <label>
                Código de muestra
                <input
                  required
                  maxLength={100}
                  value={meta.sampleCode}
                  onChange={(e) => field("sampleCode", e.target.value)}
                />
              </label>
              <label>
                Punto de muestreo
                <input
                  required
                  maxLength={100}
                  value={meta.samplingPoint}
                  onChange={(e) => field("samplingPoint", e.target.value)}
                />
              </label>
              <label>
                Profundidad (m)
                <input
                  type="number"
                  min="0"
                  max="12000"
                  step="any"
                  value={meta.depthM}
                  onChange={(e) => field("depthM", e.target.value)}
                />
              </label>
              <label>
                Recolección · fecha y hora local del equipo
                <input
                  required
                  type="datetime-local"
                  value={meta.collectedAt}
                  onChange={(e) => field("collectedAt", e.target.value)}
                />
              </label>
              <label>
                ¿Dónde se midieron los sensores de esta predicción?
                <select
                  value={meta.phase}
                  onChange={(e) => field("phase", e.target.value)}
                >
                  <option value="laboratory">
                    En laboratorio, después del transporte
                  </option>
                  <option value="field">En campo, antes del transporte</option>
                </select>
              </label>
              <label>
                Observaciones
                <textarea
                  maxLength={2000}
                  value={meta.observations}
                  onChange={(e) => field("observations", e.target.value)}
                />
              </label>
              <button disabled={busy}>Registrar muestra y predicciones</button>
            </form>
          )}
          {["laboratory", "field"].map((phase) => (
            <div key={phase}>
              <h3>
                {phase === "laboratory"
                  ? "MAE local · sensores en laboratorio"
                  : "Diferencia media · sensores en campo y sonda posterior en laboratorio"}
              </h3>
              {phase === "field" && (
                <p>
                  El transporte y el tiempo transcurrido pueden cambiar el OD
                  entre ambas mediciones.
                </p>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Modelo</th>
                      <th>Muestras</th>
                      <th>MAE (mg/L)</th>
                      <th>RMSE (mg/L)</th>
                      <th>Sesgo (mg/L)</th>
                      <th>R²</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr key={key}>
                        <td>{modelNames[key]}</td>
                        <td>{session.metrics[phase][key].n}</td>
                        <td>{mg(session.metrics[phase][key].mae)}</td>
                        <td>{mg(session.metrics[phase][key].rmse)}</td>
                        <td>{mg(session.metrics[phase][key].bias)}</td>
                        <td>{mg(session.metrics[phase][key].r2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Agreement metrics={session.metrics[phase]} />
            </div>
          ))}
          {session.samples.map((sample) => (
            <details key={sample.id} className="experiment-sample">
              <summary>
                {sample.metadata.sampleCode} · {sample.metadata.samplingPoint} ·
                Sensores {when(sample.prediction.at)} · OD sonda{" "}
                {mg(sample.reference)} mg/L
              </summary>
              <p>
                Profundidad {sample.metadata.depthM ?? "—"} m · Recolección{" "}
                {when(sample.metadata.collectedAt)} · Sonda en laboratorio{" "}
                {when(sample.referenceAt)}
              </p>
              <p>
                {sample.metadata.phase === "laboratory"
                  ? "Sensores en laboratorio"
                  : "Sensores en campo"}{" "}
                · {sample.metadata.observations}
              </p>
              <ModelResults run={sample.prediction} sample={sample} />
              {canManage && (
                <ReferenceForm sample={sample} busy={busy} submit={submit} />
              )}
            </details>
          ))}
        </>
      )}
      {!canManage && (
        <p>
          Inicia sesión como administrador u operador para registrar muestras y
          descargar CSV.
        </p>
      )}
      {feedback && (
        <p role={feedback.error ? "alert" : "status"}>
          {feedback.error || feedback.message}
        </p>
      )}
    </section>
  );
}
