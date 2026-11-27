import React, { useEffect, useState } from "react";
import {
  correlation,
  describe,
  environmentalStability,
  numeric,
  oxygenSaturation,
  projectReference,
  reviewReadings,
} from "./environment.js";
import { sensors, display } from "./sensors.js";
import { Boxplot, Histogram } from "./Distribution.jsx";
import { Guidance, Info, Status } from "./Guidance.jsx";
import { interpretReading } from "./interpretation.js";
import "./workspace.css";

export const modules = [
  [
    "resumen",
    "Inicio",
    "M2 2h7v7H2z M11 2h7v7h-7z M2 11h7v7H2z M11 11h7v7h-7z",
  ],
  ["iot", "Monitoreo", "M1 11h4l3-7 4 13 3-6h4"],
  ["anomalias", "Alertas", "M10 2 19 18H1z M10 7v5 M10 14v1"],
  [
    "oxigeno",
    "Oxígeno disuelto",
    "M10 2C7 7 4 9 4 13a6 6 0 0 0 12 0c0-4-3-6-6-11Z",
  ],
  [
    "clustering",
    "Perfiles ambientales",
    "M5 3a2 2 0 1 0 .1 0 M14 4a2 2 0 1 0 .1 0 M8 13a2 2 0 1 0 .1 0 M16 14a2 2 0 1 0 .1 0",
  ],
  [
    "fisicoquimica",
    "Análisis fisicoquímico",
    "M7 2h6 M8 2v6l-5 8q-1 2 2 2h10q3 0 2-2l-5-8V2 M6 12h8",
  ],
  ["validacion", "Validación experimental", "M4 2h12v16H4z M7 10l2 2 4-5"],
  ["datasets", "Datasets e historial", "M2 5h6l2 2h8v10H2z"],
  ["historial", "Mediciones registradas"],
  ["sesiones", "Sesiones de monitoreo"],
  ["campanas", "Campañas experimentales"],
  ["transferencias", "Importación y exportación"],
  ["whatsapp", "Notificaciones WhatsApp"],
  ["dispositivo", "Dispositivo y sensores", "M3 3h14v11H3z M6 18h8 M10 14v4"],
  [
    "configuracion",
    "Configuración",
    "M3 5h14 M3 10h14 M3 15h14 M7 3v4 M13 8v4 M8 13v4",
  ],
];

export const route = () => {
  const id = location.hash.slice(1);
  return modules.some(([key]) => key === id) ? id : "resumen";
};

const sections = [
  ["resumen", "Inicio", ["resumen"]],
  ["iot", "Monitoreo", ["iot", "dispositivo"]],
  [
    "oxigeno",
    "Análisis ambiental",
    ["oxigeno", "clustering", "fisicoquimica", "validacion"],
  ],
  ["anomalias", "Alertas", ["anomalias", "whatsapp"]],
  [
    "historial",
    "Historial",
    ["historial", "sesiones", "datasets", "campanas", "transferencias"],
  ],
];

export function SectionNav({ page }) {
  const section = sections.find(([, , routes]) => routes.includes(page));
  if (!section || section[2].length < 2 || section[0] === "iot") return null;
  const names = {
    validacion: "Investigación y validación",
    datasets: "Datasets",
    anomalias: "Eventos y anomalías",
  };
  return (
    <nav aria-label={section[1]} className="section-tabs">
      {section[2].map((id) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={id === page ? "page" : undefined}
        >
          {names[id] || modules.find(([key]) => key === id)?.[1]}
        </a>
      ))}
    </nav>
  );
}

export const sectionName = (page) =>
  sections.find(([, , routes]) => routes.includes(page))?.[1] ||
  "Configuración";

export function Sidebar({ page, onLogout }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside className={`workspace-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="workspace-brand">
        <span className="brand-mark" aria-hidden="true">
          ≈
        </span>
        <div>
          <strong>YakuToring</strong>
          <small>Observatorio acuático</small>
        </div>
        <button
          type="button"
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>
      <nav aria-label="Módulos">
        {sections.map(([id, name, routes]) => (
          <a
            key={id}
            href={`#${id}`}
            title={name}
            aria-label={name}
            aria-current={routes.includes(page) ? "page" : undefined}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path
                d={
                  modules.find(
                    ([key]) => key === (id === "historial" ? "datasets" : id),
                  )?.[2]
                }
              />
            </svg>
            <span>{name}</span>
          </a>
        ))}
      </nav>
      <button
        className="sidebar-logout"
        onClick={onLogout}
        aria-label="Cerrar sesión"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M10 17l5-5-5-5m5 5H3m12-9h5a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-5" />
        </svg>
        <span>Cerrar sesión</span>
      </button>
    </aside>
  );
}

const format = (value, digits = 2) =>
  numeric(value) ? value.toFixed(digits) : "—";
const labels = [
  "Temperatura (°C)",
  "pH",
  "Conductividad específica (mS/cm)",
  "Presión (hPa)",
];
const colors = [
  "#0d9488",
  "#b45923",
  "#367eae",
  "#a35a96",
  "#8b750b",
  "#6856ba",
  "#51804a",
  "#ad4d5e",
  "#485eba",
  "#715136",
];

export function useReference(api, enabled, environment = "manglar") {
  const [state, setState] = useState({});
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api(`environment/reference?environment=${encodeURIComponent(environment)}`)
      .then((report) => {
        if (active) setState({ report, environment });
      })
      .catch((error) => {
        if (active) setState({ error: error.message, environment });
      });
    return () => {
      active = false;
    };
  }, [api, enabled, environment]);
  return state.environment === environment ? state : {};
}

export function Table({ headings, rows }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading} scope="col">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} data-label={headings[j]}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Summary({ rows, last, state, chart, events, compact, live }) {
  const [key, setKey] = useState("temperature");
  const sensor = sensors.find((item) => item.key === key);
  const readings = [
    ...sensors.map((item) => [
      item.name,
      last?.[item.key],
      item.unit,
      item.key === "conductivity"
        ? "Derivada · calibración en revisión"
        : "Medición directa",
      item.decimals,
      item.key,
    ]),
    [
      "Oxígeno disuelto",
      live?.models?.catboost?.value,
      "mg/L",
      "Estimación experimental",
      2,
      "od_estimado_mg_l",
    ],
  ];
  return (
    <>
      <div className="overview-grid">
        {readings.map(([name, value, unit, type, digits, metric]) => (
          <section
            className={`panel overview-metric metric-${metric}`}
            key={name}
          >
            <div className="metric-meta">
              <MetricIcon metric={metric} />
              <small>{type}</small>
            </div>
            <h2>{name}</h2>
            {name === "Oxígeno disuelto" && !numeric(value) ? (
              <>
                <p>{live?.status || "Sin estimación para el último paquete"}</p>
                {live?.reason && <small>{live.reason}</small>}
                <p>
                  <a href="#oxigeno">Ver detalle de oxígeno</a>
                </p>
              </>
            ) : (
              <>
                <strong key={value} className="metric-value">
                  {format(value, digits)}
                </strong>{" "}
                <span>{unit}</span>
              </>
            )}
            <Sparkline
              rows={rows}
              field={metric}
              name={name}
              unit={unit}
              digits={digits}
            />
            {metric !== "od_estimado_mg_l" && (
              <small className="metric-quality">
                {interpretReading(rows, metric).state}
              </small>
            )}
            {name === "Oxígeno disuelto" && live?.at && (
              <p>
                <small>
                  Paquete evaluado ·{" "}
                  {new Date(live.at).toLocaleTimeString("es-PE", {
                    timeZone: "America/Lima",
                  })}
                </small>
              </p>
            )}
          </section>
        ))}
      </div>
      {!compact && (
        <div className="overview-detail">
          <section className="panel overview-chart">
            <div className="section-title">
              <div>
                <h2>Serie de monitoreo</h2>
                <p>Últimas 120 lecturas de la sesión</p>
              </div>
              <label>
                Variable
                <select value={key} onChange={(e) => setKey(e.target.value)}>
                  {sensors.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {chart(rows, sensor)}
          </section>
          <section className="panel overview-status">
            <h2>Estado de la estación</h2>
            <dl>
              <div>
                <dt>Puerto USB</dt>
                <dd>
                  {state.status.connected ? state.status.path : "Desconectado"}
                </dd>
              </div>
              <div>
                <dt>Último paquete</dt>
                <dd>
                  {last
                    ? new Date(last.at).toLocaleString("es-PE", {
                        timeZone: "America/Lima",
                      })
                    : "Sin lecturas"}
                </dd>
              </div>
              <div>
                <dt>Paquetes de sesión</dt>
                <dd>{state.count ?? rows.length}</dd>
              </div>
              <div>
                <dt>Hallazgos en 120 lecturas</dt>
                <dd>{rows.length ? events.length : "—"}</dd>
              </div>
              <div>
                <dt>Perfil ambiental</dt>
                <dd>Requiere EC validada</dd>
              </div>
            </dl>
            <a href="#iot">Abrir monitoreo IoT →</a>
          </section>
        </div>
      )}
    </>
  );
}

function MetricIcon({ metric }) {
  const icons = {
    temperature: "M9 13V4a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0ZM11 9v8",
    ph: "M8 3h8m-7 0v7l-5 8a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-8V3M7 15h10",
    conductivity: "M13 2 5 14h6l-1 8 9-12h-6z",
    pressure: "M4 18a9 9 0 1 1 16 0H4Zm8-2 4-5",
    od_estimado_mg_l: "M12 2C8 8 5 11 5 15a7 7 0 1 0 14 0c0-4-3-7-7-13Z",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={icons[metric]} />
    </svg>
  );
}

function Sparkline({ rows, field, name, unit, digits }) {
  const recent = rows.slice(-24).map((row) => row[field]);
  const values = recent.filter(numeric);
  if (values.length < 2) return null;
  const min = Math.min(...values),
    max = Math.max(...values);
  const trace = recent
    .map((value, index) =>
      numeric(value)
        ? `${numeric(recent[index - 1]) ? "L" : "M"}${(index * 116) / (recent.length - 1)},${27 - (max === min ? 10 : ((value - min) * 22) / (max - min))}`
        : "",
    )
    .join(" ");
  const delta = values.at(-1) - values[0];
  return (
    <div className="metric-trend">
      <svg
        viewBox="0 0 116 32"
        role="img"
        aria-label={`Serie reciente de ${name}`}
      >
        <title>{`Mín. ${format(min, digits)} · máx. ${format(max, digits)} ${unit}`}</title>
        <path d={trace} />
      </svg>
      <small>
        {delta >= 0 ? "+" : ""}
        {format(delta, digits)} {unit}
      </small>
    </div>
  );
}

export function Clustering({ reference, technical, environment }) {
  const [cluster, setCluster] = useState("all");
  const [entry, setEntry] = useState({});
  const [valid, setValid] = useState(false);
  const [domain, setDomain] = useState("Campo Perú");
  const { report, error } = reference;
  if (error)
    return (
      <p role="alert" className="panel">
        {error}
      </p>
    );
  if (!report)
    return (
      <div className="panel loading-panel" role="status">
        Cargando referencia histórica…
      </div>
    );
  const variableLabels = {
    temperatura_agua_C: "Temperatura (°C)",
    pH: "pH",
    conductividad_especifica_mS_cm: "Conductividad específica (mS/cm)",
    presion_atmosferica_hPa: "Presión (hPa)",
  };
  const labels = report.features.map(
    (feature) => variableLabels[feature] || feature,
  );
  const inputs = report.features.map((feature) => entry[feature] ?? "");
  const ecIndex = report.features.indexOf("conductividad_especifica_mS_cm");
  const projection =
    (ecIndex < 0 || valid) && inputs.every((value) => value.trim() !== "")
      ? projectReference(report, inputs.map(Number))
      : null;
  const matched = report.clusters.find(
    (item) => item.id === projection?.cluster,
  );
  const profileName = (item) => {
    const lower = report.clusters.every(
      (other) =>
        item.id === other.id || item.means[ecIndex] < other.means[ecIndex],
    );
    const higher = report.clusters.every(
      (other) =>
        item.id === other.id || item.means[ecIndex] > other.means[ecIndex],
    );
    return ecIndex >= 0 && report.clusters.length > 1 && (lower || higher)
      ? `Perfil de ${lower ? "menor" : "mayor"} conductividad`
      : `Perfil ${item.id + 1}`;
  };
  const drivers =
    projection?.cluster === null
      ? inputs
          .map((value, i) => {
            const standardized =
              (Number(value) - report.projection.mean[i]) /
              report.projection.scale[i];
            const nearest = report.projection.centers.toSorted(
              (a, b) =>
                a.reduce(
                  (sum, x, j) =>
                    sum +
                    (x -
                      (Number(inputs[j]) - report.projection.mean[j]) /
                        report.projection.scale[j]) **
                      2,
                  0,
                ) -
                b.reduce(
                  (sum, x, j) =>
                    sum +
                    (x -
                      (Number(inputs[j]) - report.projection.mean[j]) /
                        report.projection.scale[j]) **
                      2,
                  0,
                ),
            )[0];
            return [labels[i], Math.abs(standardized - nearest[i])];
          })
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([label]) => label)
          .join(" y ")
      : null;
  const points = report.points.filter(
    (point) => cluster === "all" || point[2] === Number(cluster),
  );
  const coordinates = [
    ...report.points,
    ...report.centroids,
    ...(projection ? [projection.pca] : []),
  ];
  const extent = [0, 1].map((i) =>
    describe(coordinates.map((point) => point[i])),
  );
  const scale = (value, axis) =>
    (value - extent[axis].min) / (extent[axis].max - extent[axis].min || 1);
  const x = (value) => 38 + 610 * scale(value, 0);
  const y = (value) => 272 - 245 * scale(value, 1);
  return (
    <>
      {!technical && (
        <Guidance
          title={`Perfiles históricos · ${environment.dataset?.geography || "referencia"}`}
        >
          {report.clusters.map((item) => (
            <p key={item.id}>
              <strong>{profileName(item)}.</strong>{" "}
              {item.n.toLocaleString("es-PE")} registros,{" "}
              {ecIndex >= 0 &&
                `conductividad media ${format(item.means[ecIndex])} mS/cm y `}
              OD histórico mediano {format(item.oxygenMedian)} mg/L.
            </p>
          ))}
          <Info term="Clustering" />
        </Guidance>
      )}
      {technical && (
        <section className="panel workspace-section">
          <div className="section-title">
            <div>
              <h2>Referencia · {environment.dataset?.name}</h2>
              <p>
                {report.records.toLocaleString("es-PE")} registros ·{" "}
                {report.first.slice(0, 10)} a {report.last.slice(0, 10)} ·{" "}
                {report.version}
              </p>
            </div>
            <label>
              Perfil
              <select
                value={cluster}
                onChange={(e) => setCluster(e.target.value)}
              >
                <option value="all">Todos</option>
                {report.clusters.map((item) => (
                  <option key={item.id} value={item.id}>
                    Grupo {item.id + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <svg
            className="pca-plot"
            viewBox="0 0 690 310"
            aria-label="Diagrama de dispersión PCA"
            role="img"
          >
            <path d="M30 16V280H665" fill="none" stroke="currentColor" />
            {points.map(([a, b, id], i) => (
              <circle
                key={i}
                cx={x(a)}
                cy={y(b)}
                r="3"
                fill={colors[id]}
                opacity=".55"
              />
            ))}
            {report.centroids.map(([a, b], i) => (
              <rect
                key={i}
                x={x(a) - 5}
                y={y(b) - 5}
                width="10"
                height="10"
                fill={colors[i]}
                stroke="currentColor"
              >
                <title>Centroide {i + 1}</title>
              </rect>
            ))}
            {projection && (
              <circle
                cx={x(projection.pca[0])}
                cy={y(projection.pca[1])}
                r="7"
                fill={domain === "Campo Perú" ? "#f59e0b" : "#38bdf8"}
                stroke="currentColor"
              >
                <title>{domain}</title>
              </circle>
            )}
            <text x="280" y="303">
              CP1 · {format(report.variance[0] * 100, 1)} %
            </text>
            <text x="43" y="19">
              CP2 · {format(report.variance[1] * 100, 1)} %
            </text>
          </svg>
          <p>
            Los cuadrados indican centroides. El OD histórico caracteriza los
            grupos después del ajuste.
          </p>
          <Info term="PCA" />
          <p>
            Cada punto resume cuatro variables. Puntos próximos se parecen en
            esta proyección; los cuadrados representan los centros de los
            perfiles.
          </p>
        </section>
      )}
      <section className="panel workspace-section">
        <h2>Proyección de una muestra peruana</h2>
        <div className="field-grid">
          {labels.map((label, i) => (
            <label key={label}>
              {label}
              <input
                type="number"
                step="any"
                value={inputs[i]}
                onChange={(e) =>
                  setEntry({ ...entry, [report.features[i]]: e.target.value })
                }
              />
            </label>
          ))}
          <label>
            Origen
            <select value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option>Campo Perú</option>
              <option>Laboratorio</option>
            </select>
          </label>
        </div>
        {ecIndex >= 0 && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={valid}
              onChange={(e) => setValid(e.target.checked)}
            />
            Conductividad específica validada y compatible con la referencia
          </label>
        )}
        <p role="status">
          {projection
            ? `${projection.status}${technical ? ` · Distancia ${format(projection.distance)}` : ""}${matched ? ` · ${profileName(matched)}` : ""}`
            : "Ingresa las variables compatibles para proyectar. El agrupamiento local requiere una campaña representativa."}
        </p>
      </section>
      <Guidance title="¿Qué significa este perfil?">
        <p>
          {matched
            ? `La muestra se parece a un perfil con ${matched.n.toLocaleString("es-PE")} registros históricos y OD mediano histórico de ${format(matched.oxygenMedian)} mg/L.`
            : drivers
              ? `Las mayores diferencias estandarizadas frente al perfil más cercano corresponden a ${drivers}.`
              : "Ingresa una muestra compatible para conocer su perfil."}
        </p>
      </Guidance>
      <Guidance
        title="¿Qué podemos concluir?"
        action={
          drivers
            ? "Verifica las unidades y la calibración antes de interpretar la diferencia."
            : null
        }
      >
        <p>
          La similitud describe las variables comparadas. El comportamiento
          ecológico y el OD en Perú requieren observaciones locales.
        </p>
      </Guidance>
      {technical && (
        <>
          <section className="panel workspace-section">
            <h2>Características por grupo</h2>
            <Boxplot
              unit="mg/L"
              groups={report.clusters
                .filter(
                  (item) =>
                    item.oxygenQuantiles.length &&
                    (cluster === "all" || item.id === Number(cluster)),
                )
                .map((item) => ({
                  label: `Grupo ${item.id + 1}`,
                  summary: [
                    ...item.oxygenQuantiles.slice(0, 2),
                    item.oxygenMedian,
                    ...item.oxygenQuantiles.slice(2),
                  ],
                }))}
            />
            <small>
              Distribución de OD histórico · extremos P05 y P95 · caja P25 a P75
            </small>
            <p>
              La distribución histórica de OD describe el dataset de referencia.
              La estimación local requiere validación con una sonda.
            </p>
            <Table
              headings={[
                "Grupo",
                "Registros",
                "%",
                ...labels,
                "OD medio",
                "OD mediano",
                "DE OD",
                "P05–P95 OD",
              ]}
              rows={report.clusters.map((item) => [
                item.id + 1,
                item.n,
                format(item.share * 100, 1),
                ...item.means.map((value) => format(value)),
                format(item.oxygenMean),
                format(item.oxygenMedian),
                format(item.oxygenSD),
                item.oxygenQuantiles.length
                  ? `${format(item.oxygenQuantiles[0])} – ${format(item.oxygenQuantiles[3])}`
                  : "—",
              ])}
            />
          </section>
          <section className="panel workspace-section">
            <h2>Selección del agrupamiento</h2>
            <p>
              {report.algorithm === "kmeans" ? "K-Means" : "MiniBatchKMeans"}{" "}
              con k = {report.chosen} por mayor Silhouette. BIC y AIC
              corresponden al ajuste GMM.
            </p>
            <Table
              headings={[
                "k",
                "Silhouette",
                "Davies–Bouldin",
                "Calinski–Harabasz",
                "Inercia",
                "Estabilidad ARI",
                "BIC",
                "AIC",
              ]}
              rows={report.trials.map((item) => [
                item.k,
                ...[
                  "silhouette",
                  "daviesBouldin",
                  "calinskiHarabasz",
                  "inertia",
                  "stability",
                  "bic",
                  "aic",
                ].map((key) => format(item[key], 3)),
              ])}
            />
            <details>
              <summary>Cargas del PCA y rangos de referencia</summary>
              <Table
                headings={["Variable", "CP1", "CP2", "Mínimo", "Máximo"]}
                rows={report.features.map((key, i) => [
                  labels[i],
                  ...report.loadings.map((component) =>
                    format(component[i], 3),
                  ),
                  ...report.ranges[key].map((value) => format(value)),
                ])}
              />
            </details>
            <details>
              <summary>Correlaciones Pearson de la referencia</summary>
              <Table
                headings={["Variable", ...labels]}
                rows={report.correlation.map((row, index) => [
                  labels[index],
                  ...row.map((value) => format(value, 3)),
                ])}
              />
            </details>
          </section>
        </>
      )}
    </>
  );
}

export function Physicochemical({ rows, last, threshold, technical }) {
  const [inputs, setInputs] = useState({
    temperature: "",
    pressure: "",
    salinity: "",
    oxygen: "",
  });
  const [method, setMethod] = useState("pearson");
  const [distribution, setDistribution] = useState("temperature");
  const parsed = (key) => (inputs[key].trim() ? Number(inputs[key]) : null);
  const temperature = parsed("temperature"),
    pressure = parsed("pressure"),
    salinity = parsed("salinity") ?? 0,
    oxygen = parsed("oxygen");
  const result = oxygenSaturation(temperature, pressure, salinity);
  const curve = Array.from({ length: 41 }, (_, t) => ({
    id: t,
    saturation: oxygenSaturation(t, pressure, salinity),
  }));
  const points = curve.filter((point) => numeric(point.saturation));
  const limits = describe(points.map((point) => point.saturation));
  const stability = environmentalStability(rows, sensors, threshold);
  const prior = stability
    ? environmentalStability(
        rows.filter(
          (row) =>
            Date.parse(row.at) < Date.parse(rows.at(-1).at) - 24 * 3600000,
        ),
        sensors,
        threshold,
      )
    : null;
  const associations = sensors
    .flatMap((sensor, i) =>
      sensors.slice(i + 1).map((other) => ({
        names: [sensor.name, other.name],
        value: correlation(rows, sensor.key, other.key, method),
        n: rows.filter(
          (row) => numeric(row[sensor.key]) && numeric(row[other.key]),
        ).length,
      })),
    )
    .filter((pair) => numeric(pair.value))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const strongest = associations[0];
  return (
    <>
      <section className="panel workspace-section">
        <div className="section-title">
          <div>
            <h2>Saturación teórica de oxígeno</h2>
            <p>Equilibrio con la atmósfera · Benson–Krause</p>
          </div>
          <button
            disabled={!numeric(last?.temperature) || !numeric(last?.pressure)}
            onClick={() =>
              setInputs({
                ...inputs,
                temperature: String(last.temperature),
                pressure: String(last.pressure),
              })
            }
          >
            Usar última lectura
          </button>
        </div>
        <div className="field-grid">
          {Object.entries({
            temperature: "Temperatura (°C)",
            pressure: "Presión local (hPa)",
            salinity: "Salinidad validada (g/kg)",
            oxygen: "OD medido por sonda (mg/L)",
          }).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                step="any"
                value={inputs[key]}
                onChange={(e) =>
                  setInputs({ ...inputs, [key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        <div className="reading-results">
          <div>
            <small>Teórico · referencia física</small>
            <strong>{format(result)} mg/L</strong>
          </div>
          <div>
            <small>Último OD IoT · estimado</small>
            <strong>{format(last?.od_estimado_mg_l)} mg/L</strong>
          </div>
          <div>
            <small>OD de sonda · ingresado</small>
            <strong>{format(oxygen >= 0 ? oxygen : null)} mg/L</strong>
          </div>
          <div>
            <small>Saturación de la lectura de sonda</small>
            <strong>
              {format(
                result && numeric(oxygen) && oxygen >= 0
                  ? (100 * oxygen) / result
                  : null,
              )}{" "}
              %
            </strong>
          </div>
        </div>
        <p>
          {inputs.salinity === ""
            ? "Referencia de agua dulce. Introduce salinidad validada para aplicar su corrección."
            : "La curva utiliza la salinidad ingresada."}{" "}
          Puede existir sobresaturación.
        </p>
        {result !== null && (
          <p>
            {numeric(oxygen) && oxygen >= 0
              ? `La lectura de sonda equivale al ${format((100 * oxygen) / result, 1)} % del equilibrio calculado para estas condiciones.`
              : `A ${temperature} °C y ${pressure} hPa, el equilibrio con el aire corresponde a ${format(result)} mg/L. Introduce una lectura de sonda para compararla.`}{" "}
            La curva muestra el efecto de la temperatura con la presión y la
            salinidad seleccionadas.
          </p>
        )}
        <Info term="Saturación de oxígeno" />
        {result === null && (
          <p>Rango de cálculo: 0–40 °C, 507–1114 hPa y 0–40 g/kg.</p>
        )}
        {limits && (
          <svg
            className="pca-plot"
            viewBox="0 0 690 210"
            role="img"
            aria-label="Curva de solubilidad de oxígeno entre cero y cuarenta grados"
          >
            <path d="M48 15V174H660" fill="none" stroke="currentColor" />
            <polyline
              fill="none"
              stroke="#0d9488"
              strokeWidth="3"
              points={points
                .map(
                  (point) =>
                    `${48 + point.id * 15},${164 - ((point.saturation - limits.min) / (limits.max - limits.min)) * 137}`,
                )
                .join(" ")}
            />
            <text x="52" y="19">
              {format(limits.max)} mg/L
            </text>
            <text x="52" y="159">
              {format(limits.min)} mg/L
            </text>
            <text x="48" y="196">
              0 °C
            </text>
            <text x="610" y="196">
              40 °C
            </text>
          </svg>
        )}
        <a href="https://www.usgs.gov/tools/dotables">
          Metodología USGS DOTABLES
        </a>
      </section>
      <section className="panel workspace-section">
        <h2>Estadística de la sesión IoT</h2>
        <Statistics rows={rows} />
        <h3>Distribución de las lecturas</h3>
        <label>
          Variable
          <select
            value={distribution}
            onChange={(event) => setDistribution(event.target.value)}
          >
            {sensors.map((sensor) => (
              <option value={sensor.key} key={sensor.key}>
                {sensor.name}
              </option>
            ))}
          </select>
        </label>
        <Histogram
          values={rows.map((row) => row[distribution])}
          unit={sensors.find((sensor) => sensor.key === distribution).unit}
        />
        {!rows.length && (
          <p>
            Conecta el receptor para obtener lecturas y estimar su dispersión.
          </p>
        )}
        <h3>Cómo se relacionan las variables</h3>
        <p>
          {!strongest
            ? "Se necesitan al menos tres pares válidos y variación en ambas variables."
            : `${strongest.names.join(" y ")} muestran la asociación ${strongest.value >= 0 ? "positiva" : "negativa"} de mayor magnitud de esta sesión (${format(strongest.value, 3)}, ${strongest.n} pares). Una asociación no demuestra causalidad.`}
        </p>
        <label>
          Método
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          >
            <option value="pearson">Pearson</option>
            <option value="spearman">Spearman</option>
          </select>
        </label>
        {technical && (
          <Table
            headings={["Variable", ...sensors.map((sensor) => sensor.name)]}
            rows={sensors.map((sensor) => [
              sensor.name,
              ...sensors.map((other) =>
                format(correlation(rows, sensor.key, other.key, method), 3),
              ),
            ])}
          />
        )}
        <p>
          Se usan pares de lecturas disponibles, con un mínimo de tres pares. La
          correlación no implica causalidad.
        </p>
      </section>
      <section className="panel workspace-section">
        <h2>Índice experimental de estabilidad</h2>
        <p>
          Resume cuánto varían las lecturas y cuánto historial válido hay en la
          ventana. La calidad ambiental requiere una evaluación independiente.
        </p>
        <p>
          {stability
            ? `${format(stability.score, 1)} / 100 · ${stability.records} lecturas en 24 horas`
            : "No disponible. Se requieren al menos 30 lecturas válidas de temperatura, pH y conductividad durante una hora o más."}
        </p>
        {stability && (
          <p>
            {`Mayor variabilidad relativa: ${["temperatura", "pH", "conductividad"][stability.penalties.indexOf(Math.max(...stability.penalties))]}. `}
            {prior
              ? `Cambio frente a la ventana previa disponible: ${format(stability.score - prior.score, 1)} puntos.`
              : "Se necesita otra ventana con suficientes datos para comparar."}
          </p>
        )}
        <details>
          <summary>Cómo se calcula</summary>
          <p>
            Periodo de 24 horas. Se restan cinco penalizaciones de igual peso a
            100. Las tres primeras son la desviación estándar muestral dividida
            por 3 °C, 0,5 unidades de pH y 0,15 mS/cm de conductividad, acotadas
            entre 0 y 1. Las otras penalizan la fracción de paquetes con cambios
            atípicos consecutivos en los últimos 120 y la proporción de datos
            faltantes.
          </p>
          <p>
            Los divisores describen variabilidad para este indicador
            experimental. La evaluación oficial de la calidad del agua requiere
            métodos y estándares específicos.
          </p>
        </details>
      </section>
    </>
  );
}

export function Statistics({ rows }) {
  return (
    <Table
      headings={[
        "Variable",
        "n",
        "Mín.",
        "Máx.",
        "Media",
        "Mediana",
        "DE muestral",
      ]}
      rows={sensors.map((sensor) => {
        const stats = describe(rows.map((row) => row[sensor.key]));
        return [
          `${sensor.name} ${sensor.unit}`,
          stats?.n ?? 0,
          ...["min", "max", "mean", "median", "sd"].map((key) =>
            format(stats?.[key], sensor.decimals),
          ),
        ];
      })}
    />
  );
}

export function Predictions({
  api,
  canSend,
  technical,
  activeModels = ["catboost"],
  environment = "manglar",
  available = true,
}) {
  const [values, setValues] = useState({
    at: "",
    temperature: "",
    ph: "",
    conductivity: "",
    pressure: "",
  });
  const [validated, setValidated] = useState(false);
  const [noConductivity, setNoConductivity] = useState(false);
  const [csv, setCsv] = useState("");
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("all");
  const keys = results.some((result) => result.models?.reduced)
    ? { reduced: "CatBoost sin EC" }
    : Object.fromEntries(
        Object.entries({
          catboost: "CatBoost",
          mlp: "MLP",
          weighted: "Híbrido ponderado",
          stacking: "Stacking",
        }).filter(
          ([key]) =>
            activeModels.includes(key) && (technical || key === "catboost"),
        ),
      );
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResults([]);
    setModel("all");
    try {
      const data = await api("environment/predictions", {
        validated,
        noConductivity,
        environment,
        ...(csv ? { csv } : { row: values }),
      });
      setResults(data.predictions);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  if (!available)
    return (
      <Guidance title="Estimación de OD">
        <p>Dataset especializado pendiente de incorporación.</p>
      </Guidance>
    );
  return (
    <section className="panel workspace-section">
      <h2>Estimar OD con una muestra o CSV</h2>
      <p>
        La distancia ambiental se calcula con la referencia seleccionada. Los
        resultados son experimentales. La cobertura predictiva en Perú sigue sin
        establecerse.
      </p>
      {canSend ? (
        <form onSubmit={submit}>
          <div className="field-grid">
            {Object.entries(values).map(([key, value], index) => (
              <label key={key}>
                {index ? labels[index - 1] : "Fecha ISO 8601 con zona horaria"}
                <input
                  type={index ? "number" : "text"}
                  step={index ? "any" : undefined}
                  value={value}
                  disabled={
                    Boolean(csv) || (key === "conductivity" && noConductivity)
                  }
                  required={!csv && !(key === "conductivity" && noConductivity)}
                  onChange={(event) =>
                    setValues({ ...values, [key]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <label>
            CSV opcional · hasta 100 filas ·
            at,temperature,ph,conductivity,pressure
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (event) => {
                setError("");
                const file = event.target.files[0];
                setCsv("");
                if (!file) return;
                if (file.size <= 12000) {
                  setCsv(await file.text());
                } else {
                  event.target.value = "";
                  setError("El archivo excede 12 kB.");
                }
              }}
            />
          </label>
          {technical && activeModels.includes("reduced") && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={noConductivity}
                onChange={(event) => setNoConductivity(event.target.checked)}
              />
              Usar CatBoost experimental sin EC si falta una conductividad
              válida
            </label>
          )}
          {!noConductivity && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={validated}
                onChange={(event) => setValidated(event.target.checked)}
              />
              Confirmo conductividad específica validada, en mS/cm
            </label>
          )}
          <button
            className="primary"
            disabled={busy || (!validated && !noConductivity)}
          >
            {busy ? "Procesando…" : "Calcular predicciones"}
          </button>
        </form>
      ) : (
        <p>
          Inicia sesión como operador o administrador para ejecutar inferencias.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!!results.length && (
        <>
          {Object.keys(keys).length > 1 && (
            <label>
              Modelo visible
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                <option value="all">Comparar todos</option>
                {Object.entries(keys).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {technical && (
            <p>
              Un puntaje Isolation Forest inferior a cero indica una muestra
              atípica frente a la referencia. La causa requiere investigación.
            </p>
          )}
          <Table
            headings={[
              "Fila",
              "Resultado",
              ...(technical
                ? ["Distancia", "Comportamiento atípico (puntaje)"]
                : []),
              ...Object.entries(keys)
                .filter(([key]) => model === "all" || model === key)
                .map(([, name]) => name + " (mg/L)"),
              ...(Object.keys(keys).length > 1 ? ["Discrepancia (mg/L)"] : []),
            ]}
            rows={results.map((result, index) => [
              index + 1,
              result.status.startsWith("Fuera de distribución") &&
              numeric(result.models?.catboost?.value)
                ? "Estimación disponible"
                : result.reason
                  ? `${result.status}. ${result.reason}`
                  : result.status,
              ...(technical
                ? [format(result.distance), format(result.isolation, 3)]
                : []),
              ...Object.keys(keys)
                .filter((key) => model === "all" || model === key)
                .map(
                  (key) =>
                    result.models?.[key]?.error ||
                    format(result.models?.[key]?.value),
                ),
              ...(Object.keys(keys).length > 1 ? [format(result.spread)] : []),
            ])}
          />
        </>
      )}
    </section>
  );
}

export function Evaluation({ api, environment = "manglar" }) {
  const [state, setState] = useState({});
  const [group, setGroup] = useState("global");
  useEffect(() => {
    let active = true;
    api(`environment/evaluation?environment=${encodeURIComponent(environment)}`)
      .then((report) => {
        if (active) setState({ report });
      })
      .catch((error) => {
        if (active) setState({ error: error.message });
      });
    return () => {
      active = false;
    };
  }, [api, environment]);
  const { report, error } = state;
  const names = {
    A: "CatBoost existente",
    A_control: "CatBoost de control",
    B: "CatBoost con cluster",
    C: "CatBoost especializados",
    E: "CatBoost sin conductividad",
    F: "Mediana de entrenamiento",
    MLP: "MLP existente",
    weighted: "Híbrido ponderado existente",
    stacking: "Stacking existente",
  };
  const results = report ? Object.entries(report.results) : [];
  const rows = results.flatMap(([key, result]) =>
    group === "global"
      ? [[names[key], "Global", result]]
      : Object.entries(result[group]).map(([label, value]) => [
          names[key],
          group === "byCluster" ? Number(label) + 1 : label,
          value,
        ]),
  );
  return (
    <section className="panel workspace-section">
      <h2>Evaluación temporal · {report?.domain || "entorno seleccionado"}</h2>
      {report ? (
        <>
          <p>
            {report.test.toLocaleString("es-PE")} observaciones compartidas. Los
            candidatos nuevos usan {report.train.toLocaleString("es-PE")} filas
            anteriores a 2024.
          </p>
          <label>
            Desglose
            <select
              value={group}
              onChange={(event) => setGroup(event.target.value)}
            >
              <option value="global">Global</option>
              <option value="byRange">Rango OD observado</option>
              <option value="byCluster">Cluster</option>
            </select>
          </label>
          <Table
            headings={[
              "Modelo",
              "Segmento",
              "n",
              "MAE (mg/L)",
              "RMSE (mg/L)",
              "R²",
              "Sesgo (mg/L)",
            ]}
            rows={rows.map(([name, segment, result]) => [
              name,
              segment,
              result.n,
              ...["mae", "rmse", "r2", "bias"].map((key) =>
                format(result[key], 3),
              ),
            ])}
          />
          <p>Adaptación local · {report.unavailable.D}</p>
        </>
      ) : (
        <p role={error ? "alert" : "status"}>
          {error || "Cargando evaluación…"}
        </p>
      )}
      <p>
        Las lecturas de laboratorio informadas se concentran aproximadamente
        entre 7 y 9 mg/L. Las repeticiones de una muestra requieren un
        identificador común para evaluar su independencia.
      </p>
    </section>
  );
}

export function Anomalies({
  rows,
  status,
  api,
  canReview,
  canConfigure,
  chart,
  technical,
}) {
  const [pendingOnly, setPendingOnly] = useState(false);
  const [archive, setArchive] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [key, setKey] = useState("temperature");
  const sensor = sensors.find((item) => item.key === key);
  useEffect(() => {
    let active = true;
    async function update() {
      try {
        const result = await api("environment/anomalies");
        if (active) setArchive(result);
      } catch (failure) {
        if (active) setError(failure.message);
      }
    }
    update();
    const timer = setInterval(update, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api]);
  async function action(endpoint, body) {
    setBusy(true);
    setError("");
    try {
      setArchive(await api(`environment/anomalies/${endpoint}`, body));
      setDraft(null);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  const threshold = archive?.threshold ?? 3.5;
  const recent = reviewReadings(
    rows,
    [sensor],
    threshold,
    120,
    archive?.tolerance,
  );
  const flags = new Set(recent.map((event) => event.row.id));
  const allEvents = archive?.events ?? [];
  const pending = allEvents.filter((event) => !event.reviewed);
  const events = pendingOnly ? pending : allEvents;
  return (
    <section className="panel workspace-section">
      <div className="section-title">
        <div>
          <h2>Revisión de telemetría</h2>
          <p>
            {technical
              ? "Mediana y MAD sobre hasta 30 lecturas anteriores."
              : "Los puntos destacados se apartan de las lecturas recientes. Comprueba si el evento continúa y revisa el sensor."}
          </p>
        </div>
        {technical &&
          (canConfigure ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                action("settings", { threshold: draft ?? threshold });
              }}
            >
              <label>
                Umbral z robusto · {draft ?? threshold}
                <input
                  type="range"
                  min="2"
                  max="8"
                  step=".5"
                  value={draft ?? threshold}
                  onChange={(event) => setDraft(Number(event.target.value))}
                />
              </label>
              <button disabled={busy || draft === null}>Guardar umbral</button>
            </form>
          ) : (
            <span className="badge">Umbral z robusto · {threshold}</span>
          ))}
      </div>
      {status.error && <p role="alert">Comunicación USB · {status.error}</p>}
      {error && <p role="alert">{error}</p>}
      <label>
        Variable de la serie
        <select value={key} onChange={(event) => setKey(event.target.value)}>
          {sensors.map((item) => (
            <option key={item.key} value={item.key}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <div className="overview-chart">{chart(rows, sensor, flags)}</div>
      <p>{interpretReading(rows, key).text}</p>
      <Info term="Anomalías" />
      <h3>Historial persistente</h3>
      {archive && (
        <label>
          Mostrar eventos{" "}
          <select
            value={pendingOnly ? "pending" : "all"}
            onChange={(event) =>
              setPendingOnly(event.target.value === "pending")
            }
          >
            <option value="all">Todos los eventos</option>
            <option value="pending">Pendientes ({pending.length})</option>
          </select>
        </label>
      )}
      <p>
        Las detecciones consecutivas de la misma variable e hipótesis se agrupan
        mientras transcurran menos de cinco minutos entre eventos.
      </p>
      {events.length ? (
        <Table
          headings={[
            "Fecha (Perú)",
            "Variable",
            "Lectura",
            ...(technical ? ["Puntaje"] : []),
            "Hipótesis",
            "Ocurrencias",
            "Acción sugerida",
            "Revisión",
          ]}
          rows={events.map(
            ({
              id,
              lastAt,
              sensor,
              value,
              score,
              cause,
              occurrences,
              reviewed,
            }) => [
              new Date(lastAt).toLocaleString("es-PE", {
                timeZone: "America/Lima",
              }),
              sensors.find((item) => item.key === sensor)?.name ?? "USB",
              numeric(value) ? display(value, sensor) : "—",
              ...(technical ? [format(score)] : []),
              <>
                <Status tone={sensor === "usb" ? "error" : "review"}>
                  {sensor === "usb" ? "Comunicación" : "Revisión"}
                </Status>{" "}
                {cause}
              </>,
              occurrences > 1
                ? `${occurrences} detecciones agrupadas`
                : "Una detección",
              sensor === "usb"
                ? "Comprueba el cable y el puerto del Receiver."
                : cause.includes("constante") || cause.includes("faltante")
                  ? "Revisa conexión, alimentación y calibración del sensor."
                  : "Verifica si el cambio se repite y contrasta con una medición independiente.",
              reviewed ? (
                "Revisado"
              ) : canReview ? (
                <button
                  key={id}
                  disabled={busy}
                  onClick={() => action(`${id}/review`, {})}
                >
                  Marcar revisado
                </button>
              ) : (
                "Pendiente"
              ),
            ],
          )}
        />
      ) : (
        <p>
          {archive === null
            ? "Cargando historial…"
            : rows.length < 13
              ? "Historial insuficiente para evaluar cambios estadísticos."
              : "Sin eventos detectados en la ventana reciente."}
        </p>
      )}
    </section>
  );
}
