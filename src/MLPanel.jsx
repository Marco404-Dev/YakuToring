import React, { useState } from "react";
const numeric = (v) => typeof v === "number" && Number.isFinite(v);
const show = (v, d = 3) => (numeric(v) ? v.toFixed(d) : "No disponible");
const time = (at) =>
  at
    ? new Date(at).toLocaleString("es-PE", { timeZone: "America/Lima" })
    : "Sin observaciones";
function ODChart({ rows }) {
  const data = rows.slice(-120),
    values = data
      .flatMap((r) => [r.predictionMgL, r.referenceMgL])
      .filter(numeric);
  if (!values.length)
    return (
      <div className="empty">
        <span>≈</span>Esperando una predicción válida
        <small>
          No se generan datos de ejemplo ni referencias sin calibración.
        </small>
      </div>
    );
  const min = Math.max(0, Math.min(...values) - 0.5),
    max = Math.max(...values) + 0.5;
  const x = (i) => 55 + (i / Math.max(1, data.length - 1)) * 390,
    y = (v) => 185 - ((v - min) / (max - min)) * 145;
  const curve = (key, color) => {
    const segments = [];
    let current = [];
    data.forEach((r, i) => {
      if (numeric(r[key])) current.push(`${x(i)},${y(r[key])}`);
      else if (current.length) {
        segments.push(current);
        current = [];
      }
    });
    if (current.length) segments.push(current);
    return (
      <g>
        {segments.map((s, i) => (
          <polyline
            key={i}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            points={s.join(" ")}
          />
        ))}
        {data.map((r, i) =>
          numeric(r[key]) ? (
            <circle key={i} cx={x(i)} cy={y(r[key])} r="3" fill={color}>
              <title>
                {time(r.at)} · {show(r[key])} mg/L
              </title>
            </circle>
          ) : null,
        )}
      </g>
    );
  };
  return (
    <>
      <svg
        viewBox="0 0 470 235"
        role="img"
        aria-label="OD estimado por ML frente a referencia calculada de sensor calibrado"
      >
        <text x="55" y="17">
          mg/L
        </text>
        {[0, 1, 2, 3].map((i) => {
          const v = min + ((max - min) * i) / 3;
          return (
            <g key={i}>
              <line x1="55" x2="445" y1={y(v)} y2={y(v)} stroke="#dce8ed" />
              <text x="0" y={y(v) + 4}>
                {v.toFixed(2)}
              </text>
            </g>
          );
        })}
        {curve("predictionMgL", "#009c9b")}
        {curve("referenceMgL", "#d98531")}
        <text x="55" y="218">
          {new Date(data[0].at).toLocaleTimeString("es-PE", {
            timeZone: "America/Lima",
          })}
        </text>
        <text x="445" y="218" textAnchor="end">
          {new Date(data.at(-1).at).toLocaleTimeString("es-PE", {
            timeZone: "America/Lima",
          })}
        </text>
      </svg>
      <p className="od-legend">
        <span>● OD estimado ML</span>
        <span>● Referencia calculada con calibración</span>
      </p>
    </>
  );
}
const blankCalibration = {
  sensor: "SEN0237",
  mode: "one_point",
  voltage1Mv: "",
  temperature1C: "",
  voltage2Mv: "",
  temperature2C: "",
  zeroVoltageMv: "",
  zeroTemperatureC: "",
  temperatureToleranceC: 0.5,
  calibrationPressureHpa: "",
  salinityMode: "",
  salinityPpt: "",
  confirmed: false,
};
const calibrationNames = {
  one_point: "100 % · un punto",
  two_point: "100 % · dos temperaturas",
  zero_span: "0 % y 100 % · misma temperatura",
};
export default function MLPanel({ ml, isAdmin, canExport, api }) {
  const [editor, setEditor] = useState(null),
    [useCalibration, setUseCalibration] = useState(false),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const s = ml?.settings || {},
    last = ml?.latest,
    metrics = ml?.metrics || {},
    rows = ml?.history || [];
  function open() {
    setEditor({
      lotId: s.lotId || "campo-principal",
      validationEnabled: !!s.validationEnabled,
      calibration: { ...blankCalibration, ...s.calibration },
    });
    setUseCalibration(!!s.calibration);
    setError("");
  }
  function field(key, value) {
    setEditor((e) => ({
      ...e,
      calibration: { ...e.calibration, [key]: value },
    }));
  }
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const c = useCalibration ? { ...editor.calibration } : null;
      if (c)
        for (const k of [
          "voltage1Mv",
          "temperature1C",
          "voltage2Mv",
          "temperature2C",
          "calibrationPressureHpa",
          "zeroVoltageMv",
          "zeroTemperatureC",
          "temperatureToleranceC",
          "salinityPpt",
        ])
          c[k] = c[k] === "" ? null : Number(c[k]);
      await api("ml/settings", {
        lotId: editor.lotId,
        validationEnabled: editor.validationEnabled,
        calibration: c,
      });
      setEditor(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  const calInput = (key, label, required = true) => (
    <label key={key}>
      {label}
      <input
        required={required}
        type="number"
        step="any"
        value={editor.calibration[key] ?? ""}
        onChange={(e) => field(key, e.target.value)}
      />
    </label>
  );
  return (
    <section className="ml-section" aria-labelledby="ml-title">
      <div className="section-title">
        <div>
          <p className="eyebrow">ESTIMACIÓN EXPERIMENTAL · V12 / V5</p>
          <h2 id="ml-title">Validación del modelo ML</h2>
          <p>
            Oxígeno disuelto estimado por modelo entrenado; referencia analógica
            temporal de validación.
          </p>
        </div>
        <span className="badge">
          {ml?.status === "ready"
            ? "Servicio ML listo"
            : ml?.status === "unavailable"
              ? "ML no disponible"
              : "Cargando modelos…"}
        </span>
      </div>
      {(ml?.error || ml?.status === "unavailable") && (
        <div role="status" className="notice error">
          {ml.error ||
            "Servicio Python no disponible. El monitoreo serial sigue funcionando."}
        </div>
      )}
      <div className="notice">
        Modelo entrenado en Florida, sin validación local en Tumbes. V12
        requiere historial exacto a 1, 3 y 6 horas del mismo lote; sin él se usa
        V5. No hay alarmas automáticas ni garantía de precisión.
      </div>
      <div className="metrics ml-metrics">
        <div className="panel temperature">
          <p className="eyebrow">OD PREDICHO · mg/L</p>
          <div className="number">{show(last?.predictionMgL)}</div>
          <small>
            {last?.model || "Sin predicción"} ·{" "}
            {last?.predictionStatus || "Esperando entradas válidas"}
          </small>
        </div>
        <div className="panel">
          <p className="eyebrow">OD DE REFERENCIA · mg/L</p>
          <div className="number">{show(last?.referenceMgL)}</div>
          <small>{last?.referenceStatus || "Sin referencia calibrada"}</small>
        </div>
        <div className="panel">
          <p className="eyebrow">VOLTAJE OD ORIGINAL · mV</p>
          <div className="number">{show(last?.odVoltageMv, 1)}</div>
          <small>VOD del Sender en V × 1000 · no entra al modelo</small>
        </div>
        <div className="panel">
          <p className="eyebrow">ERROR ABSOLUTO · mg/L</p>
          <div className="number">{show(last?.absoluteError)}</div>
          <small>Solo parejas simultáneas con referencia calculada</small>
        </div>
      </div>
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>OD estimado frente a referencia</h2>
            <p>
              Última observación ML: {time(last?.at)} · lote:{" "}
              {last?.lotId || s.lotId || "—"}
            </p>
          </div>
          {canExport && (
            <a className="download-link" href="/api/ml/export.csv">
              Exportar CSV
            </a>
          )}
        </div>
        <p>
          {last?.warning ||
            "Las predicciones no se calculan si faltan temperatura, pH, conductividad o presión válidas."}
        </p>
        {last?.outOfDistribution && (
          <div className="notice">
            Entrada fuera de la distribución histórica aproximada: revisar
            experimentalmente. No es una probabilidad de error.
          </div>
        )}
        <div className="chart">
          <ODChart rows={rows} />
        </div>
        <div className="ml-statistics">
          <div>
            <small>PAREJAS VÁLIDAS</small>
            <strong>{metrics.n || 0}</strong>
          </div>
          <div>
            <small>MAE · mg/L</small>
            <strong>{show(metrics.mae)}</strong>
          </div>
          <div>
            <small>RMSE · mg/L</small>
            <strong>{show(metrics.rmse)}</strong>
          </div>
          <div>
            <small>R²</small>
            <strong>{show(metrics.r2)}</strong>
          </div>
        </div>
        <small>
          Métricas del lote y calibración activos. R² requiere al menos dos
          referencias distintas; las muestras consecutivas no equivalen a lotes
          independientes.
        </small>
      </section>
      <section className="panel ml-calibration">
        <div className="section-title">
          <div>
            <h2>Calibración y validación OD</h2>
            <p>
              {s.validationEnabled
                ? "Validación habilitada"
                : "Validación desactivada"}{" "}
              ·{" "}
              {s.calibration
                ? "Calibración configurada por el usuario"
                : "Sin calibración: no se calcula OD de referencia"}
            </p>
            {s.calibration && (
              <p>
                Método:{" "}
                {calibrationNames[s.calibration.mode] || "No registrado"}
              </p>
            )}
          </div>
          {isAdmin && (
            <button disabled={ml?.status !== "ready"} onClick={open}>
              Configurar lote y sensor OD
            </button>
          )}
        </div>
        <p>
          Sensor prestado, no parte del producto final. Retirarlo no detiene las
          predicciones si los cuatro sensores del ML siguen disponibles.
        </p>
      </section>
      <section className="panel history measurements">
        <h2>Historial de predicción y validación</h2>
        <p>
          Últimas 120 observaciones del lote; archivo completo persistido en el
          PC y exportable con sesión autorizada.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Hora (Perú)</th>
                <th>Modelo</th>
                <th>OD predicho mg/L</th>
                <th>Referencia mg/L</th>
                <th>VOD mV</th>
                <th>Error mg/L</th>
                <th>Método de referencia</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .reverse()
                .map((r, i) => (
                  <tr key={`${r.at}-${i}`}>
                    <td data-label="Hora (Perú)">{time(r.at)}</td>
                    <td data-label="Modelo">{r.model || "No disponible"}</td>
                    <td data-label="OD predicho mg/L">
                      {show(r.predictionMgL)}
                    </td>
                    <td data-label="Referencia calculada mg/L">
                      {show(r.referenceMgL)}
                    </td>
                    <td data-label="VOD mV">{show(r.odVoltageMv, 1)}</td>
                    <td data-label="Error absoluto mg/L">
                      {show(r.absoluteError)}
                    </td>
                    <td data-label="Método de referencia">
                      {calibrationNames[r.calibrationMode] || "No registrado"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="history-empty">
            Sin observaciones registradas para este lote.
          </p>
        )}
      </section>
      {editor && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cal-title"
          >
            <div className="section-title">
              <h2 id="cal-title">Configurar validación OD</h2>
              <button
                aria-label="Cerrar calibración"
                disabled={saving}
                onClick={() => setEditor(null)}
              >
                ×
              </button>
            </div>
            <form onSubmit={save}>
              <label>
                Lote / cuerpo de agua
                <input
                  required
                  maxLength="80"
                  value={editor.lotId}
                  onChange={(e) =>
                    setEditor({ ...editor, lotId: e.target.value })
                  }
                />
              </label>
              <p>
                Cambia el lote al cambiar de recipiente. No se mezcla su
                historial de 1/3/6 horas ni sus métricas.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={editor.validationEnabled}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      validationEnabled: e.target.checked,
                    })
                  }
                />
                Activar validación con el sensor OD prestado
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={useCalibration}
                  onChange={(e) => setUseCalibration(e.target.checked)}
                />
                Configurar una calibración realizada (sin ella no hay
                referencia)
              </label>
              {useCalibration && (
                <>
                  <label>
                    Sensor confirmado
                    <select
                      value={editor.calibration.sensor}
                      onChange={(e) => field("sensor", e.target.value)}
                    >
                      <option>SEN0237</option>
                      <option>SEN0237-A</option>
                    </select>
                  </label>
                  <label>
                    Método de calibración
                    <select
                      value={editor.calibration.mode}
                      onChange={(e) =>
                        setEditor((old) => ({
                          ...old,
                          calibration: {
                            ...old.calibration,
                            mode: e.target.value,
                            confirmed: false,
                          },
                        }))
                      }
                    >
                      <option value="one_point">
                        100 % · un punto de saturación
                      </option>
                      <option value="two_point">
                        100 % · dos temperaturas distintas
                      </option>
                      <option value="zero_span">
                        0 % y 100 % · misma temperatura
                      </option>
                    </select>
                  </label>
                  {calInput(
                    "voltage1Mv",
                    editor.calibration.mode === "zero_span"
                      ? "Voltaje medido a 100 % (mV)"
                      : "Voltaje de saturación, punto 1 (mV)",
                  )}
                  {calInput(
                    "temperature1C",
                    editor.calibration.mode === "zero_span"
                      ? "Temperatura al medir 100 % (°C)"
                      : "Temperatura del punto 1 (°C)",
                  )}
                  {editor.calibration.mode === "zero_span" && (
                    <>
                      {calInput("zeroVoltageMv", "Voltaje medido a 0 % (mV)")}
                      {calInput(
                        "zeroTemperatureC",
                        "Temperatura al medir 0 % (°C)",
                      )}
                      {calInput(
                        "temperatureToleranceC",
                        "Tolerancia de temperatura admitida (°C, entre 0 y 2)",
                      )}
                      <div className="notice">
                        Mide ambos puntos a la misma temperatura: 100 % es agua
                        en equilibrio con aire, no oxígeno puro. El cero debe
                        proceder de una referencia preparada y comprobada. Se
                        resta el voltaje de cero; no se aplica la pendiente de
                        35 mV/°C. Fuera de la tolerancia indicada no se calcula
                        referencia. Esa tolerancia es un límite operativo
                        elegido, no una exactitud validada.
                      </div>
                    </>
                  )}
                  {editor.calibration.mode === "two_point" && (
                    <>
                      {calInput(
                        "voltage2Mv",
                        "Voltaje de saturación, punto 2 (mV)",
                      )}
                      {calInput(
                        "temperature2C",
                        "Temperatura del punto 2 (°C)",
                      )}
                    </>
                  )}
                  {calInput(
                    "calibrationPressureHpa",
                    "Presión durante la calibración (hPa)",
                  )}
                  <label>
                    Compensación salina
                    <select
                      required
                      value={editor.calibration.salinityMode}
                      onChange={(e) => field("salinityMode", e.target.value)}
                    >
                      <option value="">
                        Selecciona un método explícitamente
                      </option>
                      <option value="freshwater">
                        Agua dulce conocida · salinidad 0
                      </option>
                      <option value="manual">
                        Salinidad medida introducida manualmente
                      </option>
                      <option value="conductivity_proxy">
                        Proxy de conductividad · estimado y no validado
                        localmente
                      </option>
                    </select>
                  </label>
                  {editor.calibration.salinityMode === "manual" &&
                    calInput("salinityPpt", "Salinidad medida (ppt)")}
                  <div className="notice">
                    {editor.calibration.mode === "zero_span"
                      ? "0 % / 100 %: ajuste lineal de cero y sensibilidad, limitado a la temperatura de calibración. No sustituye una validación independiente."
                      : "Un punto: curva DFRobot de 35 mV/°C. Dos temperaturas: interpolación de voltaje a saturación."}{" "}
                    Los puntos deben medirse a la presión indicada. Se usa
                    Benson–Krause para solubilidad y compensaciones; la
                    referencia es calculada y requiere validación independiente.
                  </div>
                  <label className="checkbox">
                    <input
                      required
                      type="checkbox"
                      checked={editor.calibration.confirmed}
                      onChange={(e) => field("confirmed", e.target.checked)}
                    />
                    Confirmo el modelo del sensor y que estos puntos de
                    calibración se midieron realmente.
                  </label>
                </>
              )}
              {error && (
                <div role="alert" className="notice error">
                  {error}
                </div>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setEditor(null)}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={saving}>
                  {saving ? "Guardando…" : "Guardar configuración"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
