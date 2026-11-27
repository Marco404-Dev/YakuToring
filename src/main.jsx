import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import MLPanel from "./MLPanel.jsx";
import ExperimentalODPanel from "./ExperimentalODPanel.jsx";
import CollectionPanel from "./CollectionPanel.jsx";
import ComparisonPanel from "./ComparisonPanel.jsx";
import Datasets from "./Datasets.jsx";
import Access, { LinkFlow } from "./Access.jsx";
import { sensors, finite, display, mean, formatReading } from "./sensors.js";
import {
  Anomalies,
  Clustering,
  Evaluation,
  Physicochemical,
  Predictions,
  SectionNav,
  sectionName,
  Sidebar,
  Statistics,
  Summary,
  modules,
  route,
  useReference,
} from "./Workspace.jsx";
import { describe, reviewReadings } from "./environment.js";
import {
  Dialog,
  Guidance,
  Help,
  OxygenGuide,
  ReadingsGuide,
  Status,
} from "./Guidance.jsx";
import { connectionStatus } from "./interpretation.js";
import "./premium.css";
import { ReferenceSettings, ReferenceStrip } from "./EnvironmentalControls.jsx";
import { defaults, evaluateReference, referenceBand } from "./thresholds.js";
import { diagnosticValues } from "../server/templates.js";
import environments from "../config/environments.json";
const local = (at) =>
  at
    ? new Date(at).toLocaleString("es-PE", { timeZone: "America/Lima" })
    : "Sin lecturas";
let csrf = null;
async function api(route, body) {
  const res = await fetch(`/api/${route}`, {
    ...(body
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(50000),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error || "No se pudo completar la solicitud.");
  return data;
}
function Chart({
  rows,
  sensor,
  events,
  limit = 120,
  profile,
  options,
  fixed = false,
}) {
  const data = rows.slice(-limit),
    values = data.map((r) => r[sensor.key]).filter(finite);
  if (!values.length)
    return (
      <div className="empty">
        <span>≈</span>Sin lecturas de {sensor.name.toLowerCase()}
        <small>Los valores NA no se grafican ni se promedian.</small>
      </div>
    );
  const band = referenceBand(profile, sensor.key, options);
  const historic = values.length >= 30 ? describe(values) : null;
  const statistical =
    !band && historic?.sd > 0
      ? [historic.mean - 2 * historic.sd, historic.mean + 2 * historic.sd]
      : null;
  const padding = Math.max(
      (Math.max(...values) - Math.min(...values)) * 0.15,
      sensor.minPadding ?? 0.1,
    ),
    min =
      Math.min(
        ...values,
        ...(fixed
          ? [
              { temperature: 0, ph: 0, pressure: 950, conductivity: 0 }[
                sensor.key
              ] ?? 0,
            ]
          : []),
      ) - padding,
    max =
      Math.max(
        ...values,
        ...(fixed
          ? [
              { temperature: 40, ph: 14, pressure: 1050, conductivity: 10 }[
                sensor.key
              ] ?? 15,
            ]
          : []),
      ) + padding;
  const x = (i) => 60 + (i / Math.max(1, data.length - 1)) * 380,
    y = (v) => 190 - ((v - min) / (max - min)) * 150;
  const segments = [];
  let segment = [];
  data.forEach((r, i) => {
    if (finite(r[sensor.key])) segment.push(`${x(i)},${y(r[sensor.key])}`);
    else if (segment.length) {
      segments.push(segment);
      segment = [];
    }
  });
  if (segment.length) segments.push(segment);
  return (
    <>
      <svg
        viewBox="0 0 470 245"
        role="img"
        aria-label={`${sensor.name}: ${values.length} lecturas válidas en los últimos ${data.length} paquetes`}
      >
        {band &&
          [
            min,
            band.min,
            band.min + band.margin,
            band.max - band.margin,
            band.max,
            max,
          ]
            .map((v) => Math.max(min, Math.min(max, v)))
            .slice(0, -1)
            .map((low, i, prev) => {
              const upper = prev[i + 1] ?? max;
              return (
                upper > low && (
                  <rect
                    key={i}
                    x="60"
                    width="380"
                    y={y(upper)}
                    height={y(low) - y(upper)}
                    className={`plot-band band-${["red", "yellow", "green", "yellow", "red"][i]}`}
                  />
                )
              );
            })}
        {statistical && (
          <rect
            x="60"
            width="380"
            y={y(Math.min(max, statistical[1]))}
            height={
              y(Math.max(min, statistical[0])) -
              y(Math.min(max, statistical[1]))
            }
            className="plot-band band-stat"
          />
        )}
        {band &&
          [band.min, band.max]
            .filter((value) => value >= min && value <= max)
            .map((value) => (
              <line
                key={value}
                x1="60"
                x2="440"
                y1={y(value)}
                y2={y(value)}
                className="plot-boundary"
              />
            ))}
        <text x="60" y="18" aria-label="Unidad del eje vertical">
          {sensor.unit}
        </text>
        {[0, 1, 2, 3].map((i) => {
          const v = min + ((max - min) * i) / 3;
          return (
            <g key={i}>
              <line x1="60" x2="440" y1={y(v)} y2={y(v)} stroke="#dce8ed" />
              <text x="0" y={y(v) + 4}>
                {v.toFixed(sensor.decimals)}
              </text>
            </g>
          );
        })}
        {segments.map((s, i) => (
          <polyline
            key={i}
            points={s.join(" ")}
            fill="none"
            stroke="#009c9b"
            strokeWidth="3"
          />
        ))}
        {data.map((r, i) =>
          finite(r[sensor.key]) ? (
            <circle
              key={r.id}
              cx={x(i)}
              cy={y(r[sensor.key])}
              r={events?.has(r.id) || i === data.length - 1 ? "5" : "3"}
              fill={events?.has(r.id) ? "#b5541a" : "#009c9b"}
            >
              <title>
                {local(r.at)} · {display(r[sensor.key], sensor.key)}{" "}
                {sensor.unit}
                {profile &&
                  ` · ${evaluateReference(profile, sensor.key, r[sensor.key], options).label}`}
              </title>
            </circle>
          ) : null,
        )}
        <text x="60" y="225">
          {new Date(data[0].at).toLocaleTimeString("es-PE", {
            timeZone: "America/Lima",
          })}
        </text>
        <text x="440" y="225" textAnchor="end">
          {new Date(data.at(-1).at).toLocaleTimeString("es-PE", {
            timeZone: "America/Lima",
          })}
        </text>
      </svg>
      {band && (
        <p className="chart-legend">
          Verde: referencia · amarillo: margen preventivo · rojo: fuera de
          referencia
        </p>
      )}
      {statistical && (
        <p className="chart-legend">
          Banda estadística de la ventana · media ± 2 DE
        </p>
      )}
      <small>
        {data.length} paquetes visibles · hora de Perú · huecos = sin lectura
      </small>
    </>
  );
}
function App() {
  const [module, setModule] = useState(route);
  const [technical, setTechnical] = useState(
    () => localStorage.getItem("yaku-view") === "technical",
  );
  const [connecting, setConnecting] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    localStorage.setItem("yaku-view", technical ? "technical" : "general");
  }, [technical]);
  const [theme, setTheme] = useState(() =>
    localStorage.getItem("yaku-theme") === "dark" ? "dark" : "light",
  );
  const [windowMinutes, setWindowMinutes] = useState(0);
  const [newestFirst, setNewestFirst] = useState(true);
  useEffect(() => {
    const change = () => {
      setModule(route());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("yaku-theme", theme);
  }, [theme]);
  const [state, setState] = useState({
      status: {},
      readings: [],
      attempts: [],
      staleSeconds: 30,
    }),
    [online, setOnline] = useState(false),
    [auth, setAuth] = useState({ role: null }),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [ports, setPorts] = useState([]),
    [selected, setSelected] = useState(localStorage.getItem("yaku-port") || ""),
    [catalog, setCatalog] = useState({ templates: [] }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now()),
    [stale, setStale] = useState(30),
    [period, setPeriod] = useState("today"),
    [page, setPage] = useState(0);
  const [modal, setModal] = useState(null),
    [verification, setVerification] = useState(null),
    [values, setValues] = useState([]),
    [simulated, setSimulated] = useState(false),
    [sending, setSending] = useState(false),
    [requestId, setRequestId] = useState(""),
    [parameter, setParameter] = useState("temperature"),
    [parameterAt, setParameterAt] = useState(null),
    [report, setReport] = useState(null);
  const [historyId, setHistoryId] = useState(null);
  const selectedHistory = useRef(null);
  const stream = useRef({ sessionId: "", after: 0, odAfter: 0 }),
    generation = useRef(0);
  const canSend = ["admin", "operator"].includes(auth.role),
    isAdmin = auth.role === "admin";
  const [chartKey, setChartKey] = useState("temperature");
  const [chartLimit, setChartLimit] = useState(120);
  const [fixedScale, setFixedScale] = useState(false);
  const [expandedChart, setExpandedChart] = useState(false);
  const [logoutSession, setLogoutSession] = useState(null);
  const [profile, setProfile] = useState(
    () => localStorage.getItem("yaku-profile") || "E3",
  );
  const [environment, setEnvironment] = useState(
    () =>
      localStorage.getItem("yaku-environment") ||
      Object.keys(environments.environments).find(
        (id) =>
          environments.environments[id].regulatoryProfile ===
          localStorage.getItem("yaku-profile"),
      ) ||
      environments.default,
  );
  const [useGeneral, setUseGeneral] = useState(false);
  const selectedEnvironment =
    environments.environments[environment] ||
    environments.environments[environments.default];
  const analysisEnvironment = useGeneral ? environments.default : environment;
  const analysis = environments.environments[analysisEnvironment];
  const reference = useReference(
    api,
    canSend && ["clustering", "datasets"].includes(module),
    analysisEnvironment,
  );
  function chooseProfile(selection) {
    setProfile(selection);
    const entry = Object.entries(environments.environments).find(
      ([, value]) => value.regulatoryProfile === selection,
    );
    if (entry) {
      setEnvironment(entry[0]);
      setUseGeneral(false);
    }
  }
  const [referenceOptions, setReferenceOptions] = useState(() => {
    try {
      return {
        ...defaults,
        ...JSON.parse(localStorage.getItem("yaku-reference") || "{}"),
      };
    } catch {
      return defaults;
    }
  });
  const [tolerance, setTolerance] = useState(0.25);
  useEffect(() => {
    localStorage.setItem("yaku-profile", profile);
    localStorage.setItem("yaku-reference", JSON.stringify(referenceOptions));
    localStorage.setItem("yaku-environment", environment);
  }, [profile, referenceOptions, environment]);
  useEffect(() => {
    if (canSend)
      api("environment/anomalies")
        .then((data) => setTolerance(data.tolerance ?? 0.25))
        .catch(() => {});
  }, [canSend]);
  const userMenu = useRef(null);
  async function checkAuth() {
    const a = await api("auth/me");
    csrf = a.csrf;
    setAuth(a);
    return a;
  }
  useEffect(() => {
    const check = () =>
      checkAuth().catch(() => {
        setAuth((current) =>
          current.role === null ? { role: "viewer" } : current,
        );
      });
    check();
    const authClock = setInterval(check, 30000);
    return () => clearInterval(authClock);
  }, []);
  useEffect(() => {
    if (!canSend) {
      stream.current = { sessionId: "", after: 0, odAfter: 0 };
      setState({ status: {}, readings: [], attempts: [], staleSeconds: 30 });
      setOnline(false);
      return;
    }
    let stopped = false,
      timer;
    const controller = new AbortController();
    async function poll() {
      try {
        const c = stream.current,
          res = await fetch(
            `/api/state?sessionId=${encodeURIComponent(c.sessionId)}&after=${c.after}&odAfter=${c.odAfter}&collectionId=${selectedHistory.current ?? ""}`,
            { signal: controller.signal },
          );
        if (res.status === 401) {
          if (!stopped) await checkAuth();
          return;
        }
        if (!res.ok) throw new Error();
        const s = await res.json();
        if (stopped) return;
        setState((old) => {
          const readings =
            old.sessionId === s.sessionId
              ? [...old.readings, ...s.readings]
              : s.readings;
          if (!s.odUpdates?.length) return { ...s, readings };
          const updates = new Map(
            s.odUpdates.map((update) => [update.id, update]),
          );
          return {
            ...s,
            readings: readings.map((row) =>
              updates.has(row.id) ? { ...row, ...updates.get(row.id) } : row,
            ),
          };
        });
        stream.current = {
          sessionId: s.sessionId,
          odAfter: s.odCursor ?? 0,
          after:
            s.readings.at(-1)?.id ??
            (c.sessionId === s.sessionId ? c.after : 0),
        };
        setOnline(true);
      } catch {
        if (!stopped) setOnline(false);
      } finally {
        if (!stopped) timer = setTimeout(poll, 2000);
      }
    }
    poll();
    api("state")
      .then((s) => setStale(s.staleSeconds))
      .catch(() => {});
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(clock);
      controller.abort();
    };
  }, [canSend]);
  useEffect(() => {
    if (canSend)
      api("templates")
        .then(setCatalog)
        .catch((e) => setError(e.message));
    else setCatalog({ templates: [] });
    if (isAdmin) refresh();
    else setPorts([]);
  }, [auth.role]);
  useEffect(() => setPage(0), [state.sessionId]);
  async function refresh() {
    try {
      setPorts(await api("ports"));
    } catch (e) {
      setError(e.message);
    }
  }
  async function action(route, body = {}) {
    setBusy(true);
    setError("");
    try {
      await api(route, body);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function connectDevice(reconnect = false) {
    setConnecting(true);
    try {
      const path = reconnect ? state.status.path : selected;
      if (reconnect && !(await action("disconnect"))) return;
      await action("connect", { path });
    } finally {
      setConnecting(false);
    }
  }
  function openConnection() {
    setConnectionOpen(true);
    setError("");
    if (isAdmin) refresh();
  }
  async function signIn(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const a = await api("auth/login", { username, password });
      csrf = a.csrf;
      setAuth(a);
      setPassword("");
      location.hash = "resumen";
      setModule("resumen");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut(disposition = null) {
    try {
      const current = (await api("state")).collection?.sessions.find(
        (item) => item.status === "active",
      );
      if (current) {
        if (!disposition || disposition.id !== current.id) {
          setLogoutSession(current);
          return;
        }
        await api(`collection/${current.id}/${disposition.action}`, {});
      }
      await api("auth/logout", {});
      csrf = null;
      setAuth({ role: "viewer" });
      setState((s) => ({ ...s, attempts: [] }));
      setModal(null);
      setConnectionOpen(false);
      setHelpOpen(false);
      setExpandedChart(false);
      setLogoutSession(null);
      setHistoryId(null);
      selectedHistory.current = null;
      setCatalog({ templates: [] });
      setVerification(null);
      setValues([]);
    } catch (e) {
      setLogoutSession(null);
      setError(e.message);
      checkAuth().catch(() => {});
    }
  }
  const rows = state.readings,
    last = rows.at(-1),
    today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Lima",
    }),
    reportRows = rows.filter(
      (r) =>
        period === "session" ||
        new Date(r.at).toLocaleDateString("en-CA", {
          timeZone: "America/Lima",
        }) === today,
    );
  const noData =
    state.status.connected &&
    now -
      new Date(
        last && last.at >= state.connectedAt ? last.at : state.connectedAt,
      ).getTime() >
      stale * 1000;
  const hasPacket = Boolean(
    last && state.connectedAt && last.at >= state.connectedAt,
  );
  const [deviceLabel, deviceTone] = connectionStatus({
    online,
    status: state.status,
    connecting,
    noData,
    hasPacket,
  });
  const run = state.ml?.liveOD;
  const monitorMatches =
    (state.ml?.monitorEnvironment || environments.default) ===
    analysisEnvironment;
  const liveOD =
    hasPacket && run?.at >= state.connectedAt && monitorMatches ? run : null;
  const attention = reviewReadings(rows, sensors, state.anomalyThreshold);
  const connectionButton = (
    <button className="primary" onClick={openConnection}>
      {state.status.connected ? "Gestionar conexión" : "Conectar dispositivo"}
    </button>
  );
  function parameterValues(key) {
    const sensor = sensors.find((s) => s.key === key),
      reading = rows.findLast((r) => finite(r[key]));
    setParameter(key);
    setParameterAt(reading?.at || null);
    return [sensor.name, reading ? formatReading(reading[key], key) : ""];
  }
  async function open(t) {
    const ticket = ++generation.current,
      until = new Date().toISOString(),
      p = parameterValues("temperature"),
      date = local(until);
    setReport({
      period,
      until,
      ph: mean(reportRows, "ph"),
      temperature: mean(reportRows, "temperature"),
    });
    setModal(t);
    setVerification(null);
    setError("");
    setSimulated(false);
    setRequestId(crypto.randomUUID());
    setValues(
      t.fields.length === 0
        ? []
        : t.fields.length === 3
          ? [...p, date]
          : t.fields.length === 4
            ? [...p, "", date]
            : [
                period === "today"
                  ? new Date().toLocaleDateString("es-PE", {
                      timeZone: "America/Lima",
                    })
                  : "Sesión actual",
                mean(reportRows, "temperature"),
                mean(reportRows, "ph"),
                "",
                "",
                String(reportRows.length),
                "Sin evaluación automática",
                "No evaluadas",
              ],
    );
    try {
      const v = await api("templates/verify", { name: t.name });
      if (ticket === generation.current) setVerification(v);
    } catch (e) {
      if (ticket === generation.current) setVerification({ error: e.message });
    }
  }
  function closeModal() {
    generation.current++;
    setModal(null);
  }
  async function send(e) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      await api("messages", {
        name: modal.name,
        values,
        confirmed: true,
        diagnostic: true,
        requestId,
        simulated,
        period: report.period,
        reportUntil: report.until,
      });
      closeModal();
    } catch (e) {
      setError(e.message);
      checkAuth().catch(() => {});
    } finally {
      setSending(false);
    }
  }
  function showHistory(id) {
    selectedHistory.current = id;
    setHistoryId(id);
    setPage(0);
  }
  const savedHistoryReady = historyId === state.collection?.selected;
  const historyRows = historyId
    ? savedHistoryReady
      ? state.collection.measurements
      : []
    : rows;
  const orderedHistory = newestFirst ? historyRows.toReversed() : historyRows;
  const history = orderedHistory.slice(page * 25, (page + 1) * 25);
  const filteredRows =
    windowMinutes && last
      ? rows.filter(
          (row) =>
            Date.parse(row.at) >= Date.parse(last.at) - windowMinutes * 60000,
        )
      : rows;
  const recent = rows.slice(-120);
  const acquisitionInterval = describe(
    recent
      .slice(1)
      .map(
        (row, index) =>
          (Date.parse(row.at) - Date.parse(recent[index].at)) / 1000,
      )
      .filter((seconds) => seconds > 0),
  )?.median;
  if (auth.role === null)
    return (
      <main className="access-loading" role="status">
        Abriendo YakuToring…
      </main>
    );
  if (!canSend)
    return (
      <Access
        {...{
          username,
          setUsername,
          password,
          setPassword,
          signIn,
          error,
          busy,
        }}
        configured={auth.configured}
      />
    );
  return (
    <>
      <div className="workspace-shell">
        <Sidebar page={module} onLogout={() => signOut()} />
        <div className="workspace-content">
          <header className="workspace-topbar">
            <span className="workspace-location">{sectionName(module)}</span>
            <Status tone={deviceTone}>{deviceLabel}</Status>
            {connectionButton}
            <a
              className="toolbar-alert"
              href="#anomalias"
              aria-label="Abrir alertas"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
              </svg>
            </a>
            <details className="user-menu" ref={userMenu}>
              <summary>{isAdmin ? "Administrador" : "Operador"}</summary>
              <div
                className="user-popover"
                onClick={(event) => {
                  if (event.target.closest("button,a"))
                    userMenu.current.open = false;
                }}
              >
                <label className="view-selector">
                  <span className="sr-only">Nivel de visualización</span>
                  <select
                    value={technical ? "technical" : "general"}
                    onChange={(event) =>
                      setTechnical(event.target.value === "technical")
                    }
                  >
                    <option value="general">Vista general</option>
                    <option value="technical">Vista técnica</option>
                  </select>
                </label>
                <button onClick={() => setHelpOpen(true)}>Ayuda</button>
                <button
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                >
                  {theme === "dark" ? "Modo claro" : "Modo oscuro"}
                </button>
                <a href="#configuracion">Configuración</a>
                <button onClick={() => signOut()}>Cerrar sesión</button>
              </div>
            </details>
          </header>
          <main className="workspace-main">
            <div className="intro">
              <div>
                <h1>{modules.find(([id]) => id === module)?.[1]}</h1>
                {module === "resumen" && (
                  <p>Telemetría, perfiles ambientales y oxígeno disuelto.</p>
                )}
              </div>
              <div className="live">
                <i className={online ? "on" : ""} />
                {online ? "Servidor en línea" : "Servidor sin conexión"}
              </div>
            </div>
            <SectionNav page={module} />
            {[
              "clustering",
              "oxigeno",
              "validacion",
              "datasets",
              "iot",
              "resumen",
            ].includes(module) && (
              <details
                className="panel guidance"
                open={
                  !selectedEnvironment.artifacts &&
                  ["clustering", "oxigeno"].includes(module)
                    ? true
                    : undefined
                }
              >
                <summary>
                  Entorno de análisis · {selectedEnvironment.name}
                </summary>
                <label>
                  Entorno de monitoreo
                  <select
                    value={environment}
                    onChange={(event) =>
                      chooseProfile(
                        environments.environments[event.target.value]
                          .regulatoryProfile,
                      )
                    }
                  >
                    {Object.entries(environments.environments).map(
                      ([id, entry]) => (
                        <option value={id} key={id}>
                          {entry.name}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <p>
                  {selectedEnvironment.dataset
                    ? `${selectedEnvironment.dataset.name} · ${selectedEnvironment.dataset.geography} · ${selectedEnvironment.validation}`
                    : "Dataset especializado pendiente de incorporación."}
                </p>
                {selectedEnvironment.limitations.map((item) => (
                  <p key={item}>{item}</p>
                ))}
                {!selectedEnvironment.artifacts && (
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={useGeneral}
                      onChange={(e) => setUseGeneral(e.target.checked)}
                    />
                    Usar Florida y CatBoost general como referencia provisional
                    para esta vista
                  </label>
                )}
                {monitorMatches ? null : (
                  <p>
                    La estación sigue registrando con el entorno configurado en
                    el servidor. Cambiar esta vista no altera la adquisición.
                  </p>
                )}
              </details>
            )}
            {(["iot", "oxigeno"].includes(module) ||
              (module === "resumen" && hasPacket)) && (
              <ReferenceStrip
                profile={profile}
                setProfile={chooseProfile}
                options={referenceOptions}
                row={{
                  ...last,
                  od_estimado_mg_l: liveOD?.models?.catboost?.value,
                }}
                rows={rows}
                uncertain={
                  Number.isFinite(liveOD?.models?.catboost?.value) &&
                  /Fuera de distribución|limitada/i.test(liveOD.status || "")
                }
              />
            )}
            {module === "configuracion" && (
              <ReferenceSettings
                options={referenceOptions}
                setOptions={setReferenceOptions}
                tolerance={tolerance}
                setTolerance={(value) => {
                  if (isAdmin)
                    api("environment/anomalies/tolerance", { value })
                      .then((data) => setTolerance(data.tolerance))
                      .catch((error) => setError(error.message));
                }}
              />
            )}
            {error && !modal && !connectionOpen && (
              <div role="alert" className="notice error">
                {error}
                <button onClick={() => setError("")} aria-label="Cerrar error">
                  ×
                </button>
              </div>
            )}
            {module === "resumen" && !state.status.connected && (
              <Guidance
                title="Conecta tu dispositivo para comenzar"
                action={
                  hasPacket && !noData
                    ? "Abre el monitoreo para ver la serie o guardar una sesión."
                    : "Enciende el Sender y conecta el Heltec Receiver por USB al equipo que ejecuta YakuToring."
                }
              >
                {connectionButton}
                {module === "resumen" && (
                  <button onClick={() => setHelpOpen(true)}>
                    Ver guía de inicio
                  </button>
                )}
              </Guidance>
            )}
            {module === "resumen" && (
              <>
                <Guidance title="Observatorio acuático">
                  <p>
                    {hasPacket
                      ? noData
                        ? "Se muestran las últimas lecturas de la sesión. El enlace dejó de entregar paquetes."
                        : "El Receiver está entregando mediciones. Las comparaciones usan el historial reciente de esta sesión."
                      : "Aquí encontrarás las mediciones de tu estación y su interpretación."}
                  </p>
                </Guidance>
                <Summary
                  live={liveOD}
                  rows={rows}
                  last={last}
                  state={state}
                  events={attention}
                  compact
                  chart={(chartRows, sensor) => (
                    <Chart rows={chartRows} sensor={sensor} />
                  )}
                />
                {rows.length > 0 && (
                  <details>
                    <summary>Interpretación de las mediciones</summary>
                    <ReadingsGuide rows={rows} />
                  </details>
                )}
                <Guidance title="Situaciones que requieren atención">
                  <p>
                    {attention.length
                      ? `${attention.length} hallazgos en la ventana reciente. Revisa las lecturas y su posible origen.`
                      : rows.length < 13
                        ? "Se necesitan más mediciones para identificar cambios en la sesión."
                        : "La revisión de la ventana reciente no detectó eventos."}
                  </p>
                  <a href="#anomalias">Revisar alertas</a>
                </Guidance>
                <Guidance title="Accesos rápidos">
                  <nav className="controls">
                    <a href="#iot">Monitoreo en tiempo real</a>
                    <a href="#oxigeno">Oxígeno disuelto</a>
                    <a href="#clustering">Perfiles ambientales</a>
                    <a href="#datasets">Exportar mediciones</a>
                  </nav>
                </Guidance>
              </>
            )}
            {connectionOpen && (
              <Dialog
                title="Asistente de conexión"
                onClose={() => setConnectionOpen(false)}
              >
                {state.serialMode === "agent" ? (
                  <>
                    <LinkFlow packet={last?.id} active={hasPacket && !noData} />
                    <p>
                      Abre el agente Heltec en el equipo conectado al Receiver.
                      La estación se activa al recibir paquetes reales por
                      HTTPS.
                    </p>
                    <p>
                      Última recepción · {local(hasPacket ? last?.at : null)}
                    </p>
                  </>
                ) : (
                  <>
                    <LinkFlow packet={last?.id} active={hasPacket && !noData} />
                    <p>
                      Última recepción · {local(hasPacket ? last?.at : null)}
                      {finite(last?.rssi) && ` · RSSI ${last.rssi} dBm`}
                      {finite(last?.snr) && ` · SNR ${last.snr} dB`}
                    </p>
                    <ol className="connection-steps">
                      <li>
                        Enciende el Sender y conecta el Heltec Receiver por USB.
                      </li>
                      <li>
                        Selecciona el puerto COM del Receiver. Cierra el Monitor
                        Serial si lo está usando.
                      </li>
                      <li>Pulsa Conectar.</li>
                      <li>Espera el primer paquete por LoRa.</li>
                      <li>
                        <a href="#iot" onClick={() => setConnectionOpen(false)}>
                          Abrir monitoreo en tiempo real
                        </a>
                      </li>
                    </ol>
                    <section className="panel connection">
                      <div>
                        <h2>Heltec Receiver</h2>
                        <p>
                          USB serial · 115200 baudios · computadora principal
                        </p>
                      </div>
                      <div className="device">
                        <i className={state.status.connected ? "on" : ""} />
                        {deviceLabel}
                        {state.status.path && ` · ${state.status.path}`}
                      </div>
                      {isAdmin ? (
                        <>
                          <div className="controls">
                            <label>
                              Puerto COM
                              <select
                                value={selected}
                                disabled={state.status.connected || busy}
                                onChange={(e) => {
                                  setSelected(e.target.value);
                                  localStorage.setItem(
                                    "yaku-port",
                                    e.target.value,
                                  );
                                }}
                              >
                                <option value="">Selecciona un puerto</option>
                                {selected &&
                                  !ports.some((p) => p.path === selected) && (
                                    <option value={selected}>
                                      {selected} (no disponible)
                                    </option>
                                  )}
                                {ports.map((p) => (
                                  <option key={p.path} value={p.path}>
                                    {p.path} {p.manufacturer || ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button disabled={busy} onClick={refresh}>
                              ↻ Actualizar
                            </button>
                            <button
                              className="primary"
                              disabled={
                                !online ||
                                busy ||
                                state.status.connected ||
                                !ports.some((p) => p.path === selected)
                              }
                              onClick={() => connectDevice()}
                            >
                              Conectar
                            </button>
                            <button
                              disabled={busy || !state.status.connected}
                              onClick={() => action("disconnect")}
                            >
                              Desconectar
                            </button>
                            {state.status.connected && (
                              <button
                                disabled={busy || !online || connecting}
                                onClick={() => connectDevice(true)}
                              >
                                Reconectar
                              </button>
                            )}
                          </div>
                          <small className="connection-help">
                            Los puertos pertenecen al PC principal. Cierra el
                            Monitor Serial de Arduino antes de conectar.
                          </small>
                        </>
                      ) : (
                        <small>
                          El control del puerto USB requiere una cuenta
                          administradora.
                        </small>
                      )}
                      {state.status.error && (
                        <small className="connection-help">
                          {state.status.error}
                        </small>
                      )}
                      {error && <p role="alert">{error}</p>}
                    </section>
                  </>
                )}
              </Dialog>
            )}
            {helpOpen && (
              <Help
                onClose={() => setHelpOpen(false)}
                connect={() => {
                  setHelpOpen(false);
                  openConnection();
                }}
              />
            )}
            {module === "iot" && (
              <>
                {noData && (
                  <div role="status" className="notice">
                    Sin paquetes nuevos durante {stale} segundos. Revisa Sender,
                    alimentación y enlace LoRa.
                  </div>
                )}
                <div className="metrics sensor-metrics">
                  {sensors.map((s, i) => (
                    <section
                      key={s.key}
                      className={`panel sensor-${s.key} ${i === 0 ? "temperature" : ""}`}
                    >
                      <p className="eyebrow">{s.name.toUpperCase()}</p>
                      <div
                        className={`number ${!finite(last?.[s.key]) ? "missing" : ""}`}
                      >
                        {display(last?.[s.key], s.key)}
                        {finite(last?.[s.key]) && <span>{s.unit}</span>}
                      </div>
                      <small>{s.note}</small>
                    </section>
                  ))}
                </div>
                <section className="panel reception-bar">
                  <div>
                    <small>PAQUETES RECIBIDOS</small>
                    <strong>{rows.length}</strong>
                  </div>
                  <div>
                    <small>ÚLTIMA RECEPCIÓN · PERÚ</small>
                    <strong>{local(last?.at)}</strong>
                  </div>
                  <div>
                    <small>RECEPCIÓN</small>
                    <strong>
                      {!state.status.connected
                        ? "Desconectado"
                        : noData
                          ? "Sin datos recientes"
                          : last && last.at >= state.connectedAt
                            ? "Recibiendo datos"
                            : "Esperando paquetes"}
                    </strong>
                  </div>
                  <div>
                    <small>ENLACE LoRa</small>
                    <strong>
                      RSSI {last?.rssi ?? "—"} dBm · SNR {last?.snr ?? "—"} dB
                    </strong>
                  </div>
                </section>
                <div className="section-title graph-heading">
                  <div>
                    <h2>Parámetros en tiempo real</h2>
                    <p>
                      Lecturas reales. NA no se sustituye por cero ni por la
                      lectura anterior.
                    </p>
                  </div>
                  <label>
                    Variable
                    <select
                      value={chartKey}
                      onChange={(event) => setChartKey(event.target.value)}
                    >
                      {sensors.map((sensor) => (
                        <option key={sensor.key} value={sensor.key}>
                          {sensor.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ventana de la serie
                    <select
                      value={windowMinutes}
                      onChange={(event) =>
                        setWindowMinutes(Number(event.target.value))
                      }
                    >
                      <option value="0">Sesión completa</option>
                      <option value="15">15 minutos</option>
                      <option value="60">1 hora</option>
                      <option value="1440">24 horas</option>
                    </select>
                  </label>
                  <label>
                    Zoom de la serie
                    <select
                      value={chartLimit}
                      onChange={(event) =>
                        setChartLimit(Number(event.target.value))
                      }
                    >
                      <option value={24}>24 paquetes</option>
                      <option value={60}>60 paquetes</option>
                      <option value={120}>120 paquetes</option>
                    </select>
                  </label>
                  <label>
                    Escala
                    <select
                      value={fixedScale ? "fixed" : "auto"}
                      onChange={(event) =>
                        setFixedScale(event.target.value === "fixed")
                      }
                    >
                      <option value="auto">Automática</option>
                      <option value="fixed">Fija</option>
                    </select>
                  </label>
                  <button
                    onClick={() => {
                      setChartLimit(120);
                      setWindowMinutes(0);
                      setFixedScale(false);
                    }}
                  >
                    Restablecer zoom
                  </button>
                  <button onClick={() => setExpandedChart(true)}>
                    Ampliar gráfico
                  </button>
                  <label>
                    Aviso sin datos (s)
                    <input
                      type="number"
                      min="5"
                      max="3600"
                      value={stale}
                      onChange={(e) =>
                        setStale(
                          Math.max(
                            5,
                            Math.min(3600, Number(e.target.value) || 30),
                          ),
                        )
                      }
                    />
                  </label>
                </div>
                <div className="charts-grid focused-chart">
                  {sensors
                    .filter((sensor) => sensor.key === chartKey)
                    .map((s) => (
                      <section className="panel chart" key={s.key}>
                        <h2>
                          {s.name}
                          {s.unit ? ` (${s.unit})` : ""}
                        </h2>
                        <p>
                          {s.note} · promedio de sesión:{" "}
                          {mean(filteredRows, s.key) || "Sin lectura"}{" "}
                          {mean(filteredRows, s.key) ? s.unit : ""}
                        </p>
                        <Chart
                          rows={filteredRows}
                          sensor={s}
                          limit={chartLimit}
                          profile={profile}
                          options={referenceOptions}
                          fixed={fixedScale}
                        />
                      </section>
                    ))}
                </div>
                {expandedChart && (
                  <Dialog
                    className="chart-expanded"
                    title={
                      sensors.find((sensor) => sensor.key === chartKey).name
                    }
                    onClose={() => setExpandedChart(false)}
                  >
                    <div className="overview-chart">
                      <Chart
                        rows={filteredRows}
                        sensor={sensors.find(
                          (sensor) => sensor.key === chartKey,
                        )}
                        limit={chartLimit}
                        profile={profile}
                        options={referenceOptions}
                        fixed={fixedScale}
                      />
                    </div>
                  </Dialog>
                )}
                <section className="panel workspace-section">
                  <h2>
                    {technical
                      ? "Estadística de la ventana"
                      : "Ritmo de recepción"}
                  </h2>
                  {technical && <Statistics rows={filteredRows} />}
                  {technical && (
                    <p>
                      Voltajes del último paquete · pH {last?.phVoltageV ?? "—"}{" "}
                      V · EC {last?.ecVoltageV ?? "—"} V · OD{" "}
                      {last?.odVoltageV ?? "—"} V
                    </p>
                  )}
                  <p>
                    Intervalo mediano observado entre paquetes recientes ·{" "}
                    {finite(acquisitionInterval)
                      ? `${acquisitionInterval.toFixed(2)} s`
                      : "Sin datos"}
                    . La disponibilidad de ADC crudo depende de la trama del
                    dispositivo.
                  </p>
                </section>
              </>
            )}
            {module === "datasets" && (
              <section className="panel workspace-section">
                <h2>Fuentes disponibles</h2>
                <p>
                  {reference.report
                    ? `NOAA Florida · ${reference.report.inputRecords.toLocaleString("es-PE")} registros originales · ${reference.report.version}`
                    : (reference.error ?? "Cargando catálogo NOAA…")}
                </p>
                <p>Dispositivo IoT · {rows.length} paquetes de esta sesión</p>
                <p>
                  Consulta y exporta las sesiones de adquisición guardadas a
                  continuación.
                </p>
              </section>
            )}
            {["datasets", "transferencias"].includes(module) && canSend && (
              <Datasets api={api} importEnabled={module === "transferencias"} />
            )}
            {["iot", "sesiones", "historial"].includes(module) && (
              <>
                {module !== "historial" && (
                  <CollectionPanel
                    collection={state.collection}
                    canManage={canSend}
                    onShowHistory={(id) => {
                      showHistory(id);
                      if (module === "sesiones") location.hash = "historial";
                    }}
                    connection={
                      !online
                        ? "Sin conexión con el backend"
                        : !state.status.connected
                          ? "Receiver desconectado"
                          : noData
                            ? "Receiver conectado · sin paquetes recientes"
                            : "Receiver conectado"
                    }
                    api={api}
                  />
                )}
                {module !== "sesiones" && (
                  <section className="panel history measurements">
                    <div className="section-title">
                      <div>
                        <h2>
                          {historyId
                            ? `Mediciones guardadas · Sesión ${String(historyId).padStart(3, "0")}`
                            : "Historial de recepción"}
                        </h2>
                        <p>
                          {historyId
                            ? "Mediciones válidas guardadas en la sesión de 100."
                            : "Paquetes recibidos desde el último inicio del servidor."}{" "}
                          OD estimado experimental · EC con calibración en
                          verificación.
                        </p>
                      </div>
                      {historyId ? (
                        <button type="button" onClick={() => showHistory(null)}>
                          Volver a recepción en vivo
                        </button>
                      ) : (
                        <span className="badge">
                          {historyRows.length} paquetes
                        </span>
                      )}
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Hora (Perú)</th>
                            <th>Secuencia</th>
                            {sensors.map((s) => (
                              <th key={s.key}>
                                {s.name} <span className="unit">{s.unit}</span>
                              </th>
                            ))}
                            <th>
                              OD estimado <span className="unit">mg/L</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((r) => (
                            <tr key={r.id}>
                              <td data-label="Hora (Perú)">{local(r.at)}</td>
                              <td data-label="Secuencia">{r.packet ?? "—"}</td>
                              {sensors.map((s) => (
                                <td
                                  key={s.key}
                                  data-label={`${s.name} ${s.unit}`}
                                >
                                  {display(r[s.key], s.key)}
                                </td>
                              ))}
                              <td data-label="OD estimado (mg/L)">
                                {finite(r.od_estimado_mg_l)
                                  ? r.od_estimado_mg_l.toFixed(2)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!historyRows.length && (
                      <p className="history-empty">
                        {historyId
                          ? savedHistoryReady
                            ? "Esta sesión todavía no tiene mediciones."
                            : "Cargando la sesión guardada…"
                          : "Esperando paquetes del Receiver."}
                      </p>
                    )}
                    <div className="pagination">
                      <label>
                        Orden de recepción
                        <select
                          value={newestFirst ? "desc" : "asc"}
                          onChange={(event) => {
                            setNewestFirst(event.target.value === "desc");
                            setPage(0);
                          }}
                        >
                          <option value="desc">Recientes primero</option>
                          <option value="asc">Antiguas primero</option>
                        </select>
                      </label>
                      <button
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        Anterior
                      </button>
                      <small>
                        Página {page + 1} de{" "}
                        {Math.max(1, Math.ceil(historyRows.length / 25))}
                      </small>
                      <button
                        disabled={(page + 1) * 25 >= historyRows.length}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Siguiente
                      </button>
                    </div>
                  </section>
                )}
              </>
            )}
            {module === "clustering" && (
              <Clustering
                key={analysisEnvironment}
                reference={reference}
                technical={technical}
                environment={analysis}
              />
            )}
            {module === "anomalias" && (
              <Anomalies
                rows={rows}
                status={state.status}
                api={api}
                canReview={canSend}
                canConfigure={isAdmin}
                technical={technical}
                chart={(chartRows, sensor, events) => (
                  <Chart rows={chartRows} sensor={sensor} events={events} />
                )}
              />
            )}
            {module === "fisicoquimica" && (
              <Physicochemical
                rows={rows}
                last={last}
                threshold={state.anomalyThreshold}
                technical={technical}
              />
            )}
            {["validacion", "campanas"].includes(module) && (
              <>
                <Guidance
                  title="Validación con una sonda de referencia"
                  action="Registra el código de la muestra, su procedencia y la lectura de la sonda junto al paquete correspondiente."
                >
                  <p>
                    La validación compara el OD medido con el estimado. Las
                    lecturas repetidas de la misma muestra se agrupan por
                    sesión, fase y punto.
                  </p>
                </Guidance>
                <details open={technical}>
                  <summary>
                    Sesiones experimentales y resultados históricos
                  </summary>
                  <ComparisonPanel
                    comparison={state.ml?.comparison}
                    canManage={canSend}
                    api={api}
                  />
                </details>
              </>
            )}
            {module === "validacion" && technical && (
              <Evaluation api={api} environment={analysisEnvironment} />
            )}
            {module === "oxigeno" && (
              <>
                <OxygenGuide live={liveOD} last={hasPacket ? last : null} />
                <section className="panel overview-chart">
                  <h2>Tendencia del OD estimado</h2>
                  <p>
                    CatBoost · mg/L · estimaciones de la sesión. Los huecos
                    indican lecturas sin estimación.
                  </p>
                  <Chart
                    rows={monitorMatches ? rows : []}
                    sensor={{
                      key: "od_estimado_mg_l",
                      name: "OD estimado",
                      unit: "mg/L",
                      decimals: 2,
                    }}
                  />
                </section>
                <Predictions
                  key={analysisEnvironment}
                  environment={analysisEnvironment}
                  available={Boolean(analysis.artifacts?.catboost)}
                  api={api}
                  canSend={canSend}
                  technical={technical}
                  activeModels={state.ml?.activeModels}
                />
                <details open={technical}>
                  <summary>Información técnica del modelo</summary>
                  <p>
                    {analysis.dataset
                      ? `${analysis.dataset.name} · ${analysis.artifacts.version} · ${analysis.validation}`
                      : "Dataset especializado pendiente de incorporación."}
                  </p>
                  <Evaluation api={api} environment={analysisEnvironment} />
                  <ExperimentalODPanel
                    ml={state.ml}
                    canReference={canSend}
                    api={api}
                    enabled={state.ml?.activeModels?.includes("noaa")}
                  />
                </details>
              </>
            )}
            {module === "dispositivo" && (
              <Guidance title="Sensores y comunicación">
                <p>
                  Receiver Heltec por USB · 115200 baudios. El Sender transmite
                  mediciones por LoRa.
                </p>
                <p>
                  Temperatura, pH y presión se reciben directamente. La
                  conductividad está en revisión.
                </p>
                {state.status.path && <p>Puerto actual: {state.status.path}</p>}
                {state.status.error && <p>{state.status.error}</p>}
              </Guidance>
            )}
            {module === "configuracion" && (
              <details open={technical}>
                <summary>Configuración avanzada de modelos</summary>
                <p>
                  Activos:{" "}
                  {state.ml?.activeModels?.join(", ") ||
                    "Esperando servicio de modelos"}
                  .
                </p>
                <p>
                  El administrador del equipo puede editar{" "}
                  <code>YAKUTORING_ACTIVE_MODELS</code> en <code>.env</code> y
                  reiniciar el servidor. Valor predeterminado:{" "}
                  <code>catboost</code>.
                </p>
                <p>
                  Opcionales: <code>mlp</code>, <code>weighted</code>,{" "}
                  <code>stacking</code>, <code>reduced</code>, <code>noaa</code>{" "}
                  y <code>legacy</code>. Los híbridos requieren{" "}
                  <code>catboost,mlp</code>.
                </p>
              </details>
            )}
            {(module === "configuracion" || module === "validacion") && (
              <details>
                <summary>
                  Validación histórica V12/V5 y configuración del lote
                </summary>
                <MLPanel
                  ml={state.ml}
                  isAdmin={isAdmin}
                  canExport={canSend}
                  api={api}
                />
              </details>
            )}
            {module === "whatsapp" && (
              <>
                <section className="notifications">
                  <div className="section-title">
                    <div>
                      <p className="eyebrow">COMUNICACIÓN MANUAL</p>
                      <h2>Diagnóstico de notificaciones</h2>
                      <p>
                        {canSend
                          ? "Revisa los parámetros y confirma cada envío."
                          : "Inicia sesión como administrador u operador autorizado para enviar."}
                      </p>
                    </div>
                    <span className="badge">Sin alertas automáticas</span>
                  </div>
                  <p>
                    {catalog.configured
                      ? "Configuración local disponible. Meta verifica la aprobación al abrir la plantilla."
                      : catalog.configurationError ||
                        "Configuración no disponible."}
                  </p>
                  <p>
                    Destinatario {catalog.recipient || "sin configurar"} ·
                    Último intento {local(state.attempts[0]?.at)}
                  </p>
                  {canSend && (
                    <>
                      <div className="template-grid">
                        {catalog.templates.map((t, i) => (
                          <button
                            key={t.name}
                            className="template-card"
                            disabled={!online || sending}
                            onClick={() => open(t)}
                          >
                            <span className="template-icon">
                              {["↗", "◉", "△", "▤"][i]}
                            </span>
                            <strong>{t.title}</strong>
                            <small>
                              {
                                [
                                  "Texto fijo aprobado · sin parámetros",
                                  "Selecciona un parámetro y su lectura",
                                  "Persistencia manual de prueba",
                                  "Promedios reales disponibles",
                                ][i]
                              }
                            </small>
                            <span className="template-link">
                              Revisar plantilla →
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="report-settings">
                        <label>
                          Periodo del reporte{" "}
                          <select
                            value={period}
                            onChange={(e) => setPeriod(e.target.value)}
                          >
                            <option value="today">Hoy (Perú)</option>
                            <option value="session">Toda la sesión</option>
                          </select>
                        </label>
                        <small>
                          {reportRows.length} paquetes · temperatura{" "}
                          {mean(reportRows, "temperature") || "Sin lectura"} ·
                          pH {mean(reportRows, "ph") || "Sin lectura"}.
                          Salinidad y oxígeno aún no medidos.
                        </small>
                      </div>
                    </>
                  )}
                </section>
                {canSend && (
                  <section className="panel history">
                    <h2>Actividad de mensajes</h2>
                    <p>
                      Una solicitud aceptada por Meta no confirma entrega. Los
                      estados de entrega aparecen cuando Meta notifica al
                      webhook.
                    </p>
                    {!state.attempts.length ? (
                      <p className="history-empty">
                        Todavía no hay intentos de envío.
                      </p>
                    ) : (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Intento (Perú)</th>
                              <th>Plantilla / destinatario</th>
                              <th>Resultado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {state.attempts.map((a) => (
                              <tr key={a.requestId}>
                                <td>{local(a.at)}</td>
                                <td>
                                  {a.name}
                                  <small>
                                    {a.recipient}
                                    {a.diagnostic ? " · PRUEBA" : ""}
                                    {a.simulated ? " · DATOS SIMULADOS" : ""}
                                  </small>
                                </td>
                                <td>
                                  {a.status}
                                  <small>
                                    Entrega:{" "}
                                    {a.deliveryLabel || "estado desconocido"}
                                  </small>
                                  {a.messageId && (
                                    <small>ID: {a.messageId}</small>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
            <footer>
              YakuToring · Proyecto universitario · Tumbes, Perú
              <span>Sin clasificación ambiental ni envío automático.</span>
            </footer>
          </main>
        </div>
      </div>
      {modal && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="section-title">
              <h2 id="modal-title">{modal.title}</h2>
              <button
                disabled={sending}
                aria-label="Cerrar formulario"
                onClick={closeModal}
              >
                ×
              </button>
            </div>
            <p>
              Destinatario autorizado: <strong>{catalog.recipient}</strong>
            </p>
            <code>{modal.name}</code>
            <p>Idioma: {verification?.language || "Sin verificar"}</p>
            {verification?.error ? (
              <div className="notice error">{verification.error}</div>
            ) : verification ? (
              <blockquote>
                {verification.text.replace(
                  /\{\{(\d+)\}\}/g,
                  (placeholder, n) =>
                    diagnosticValues(modal.name, values)[Number(n) - 1] ||
                    placeholder,
                )}
              </blockquote>
            ) : (
              <p>Consultando plantilla aprobada en Meta…</p>
            )}
            <form onSubmit={send}>
              {[3, 4].includes(modal.fields.length) && (
                <>
                  <label>
                    Parámetro para la alerta
                    <select
                      value={parameter}
                      onChange={(e) => {
                        const p = parameterValues(e.target.value);
                        setValues((v) => [...p, ...v.slice(2)]);
                        setSimulated(false);
                      }}
                    >
                      {sensors.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.name}
                          {s.unit ? ` (${s.unit})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    Última lectura válida de este parámetro:{" "}
                    {local(parameterAt)}. Puede ser anterior al último paquete;
                    revísala antes de enviar.
                  </p>
                  {parameter === "conductivity" && (
                    <div className="notice">
                      Conductividad estimada — calibración en verificación
                    </div>
                  )}
                </>
              )}
              {modal.fields.length === 8 && (
                <div className="notice">
                  Reporte: {report.period === "today" ? "hoy (Perú)" : "sesión"}{" "}
                  · corte {local(report.until)}. Promedios reales sin NA. La
                  conductividad no se convierte en salinidad. Salinidad y
                  oxígeno requieren simulación; estado y anomalías son manuales.
                </div>
              )}
              {modal.fields.map((f, i) => (
                <label key={f}>
                  {`{{${i + 1}}}`} · {f}
                  <input
                    required
                    maxLength="500"
                    readOnly={
                      (modal.fields.length === 8 &&
                        ([0, 1, 5].includes(i) || (i === 2 && !!report.ph))) ||
                      ([3, 4].includes(modal.fields.length) && i === 0)
                    }
                    value={values[i] || ""}
                    onChange={(e) => {
                      setValues((v) =>
                        v.map((x, j) => (j === i ? e.target.value : x)),
                      );
                      if (i === 1 || modal.fields.length === 8)
                        setSimulated(true);
                    }}
                  />
                </label>
              ))}
              {modal.fields.length > 0 && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    required={modal.fields.length === 8}
                    checked={simulated}
                    onChange={(e) => setSimulated(e.target.checked)}
                  />
                  Este envío incluye datos manuales de prueba o simulación.
                </label>
              )}
              {modal.fields.length === 8 && !report.temperature && (
                <p role="alert">
                  No hay temperaturas válidas en el periodo. No se puede enviar
                  este reporte.
                </p>
              )}
              <p className="muted">
                Confirmar solicita un envío real. No hay evaluación automática
                de riesgos ni confirmación de entrega.
              </p>
              {error && (
                <div role="alert" className="notice error">
                  {error}
                </div>
              )}
              <div className="modal-actions">
                <button type="button" disabled={sending} onClick={closeModal}>
                  Cancelar
                </button>
                <button
                  className="primary"
                  disabled={
                    sending ||
                    !online ||
                    !verification?.language ||
                    (modal.fields.length === 8 && !report.temperature)
                  }
                >
                  {sending ? "Enviando…" : "Enviar mensaje de prueba"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {logoutSession && (
        <Dialog
          title="Hay una recolección activa"
          onClose={() => setLogoutSession(null)}
        >
          <p>
            Se han guardado {logoutSession.count} de {logoutSession.target}{" "}
            mediciones. El Receiver puede seguir conectado al cerrar sesión.
          </p>
          <div className="controls">
            <button
              className="primary"
              onClick={() => signOut({ id: logoutSession.id, action: "pause" })}
            >
              Pausar y salir
            </button>
            <button
              onClick={() =>
                signOut({ id: logoutSession.id, action: "finish" })
              }
            >
              Finalizar y salir
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
