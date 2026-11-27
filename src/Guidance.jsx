import React, { useEffect, useRef, useState } from "react";
import { interpretReading } from "./interpretation.js";
import { oxygenSaturation } from "./environment.js";

const glossary = {
  "Oxígeno disuelto":
    "Oxígeno presente en el agua, expresado en mg/L. Una sonda puede medirlo; CatBoost entrega una estimación.",
  pH: "Escala de acidez o alcalinidad. El punto neutro depende de la temperatura.",
  Conductividad:
    "Facilidad con la que el agua conduce electricidad debido a los iones disueltos.",
  Salinidad: "Contenido de sales disueltas, expresado aquí en g/kg.",
  "Presión atmosférica": "Presión del aire local, en hPa.",
  "Aprendizaje supervisado":
    "Ajusta un modelo usando ejemplos con un resultado conocido.",
  "Aprendizaje no supervisado":
    "Busca patrones sin usar un resultado conocido como objetivo.",
  CatBoost:
    "Modelo basado en árboles que combina temperatura, pH, conductividad, presión y fecha para estimar OD.",
  Clustering: "Agrupa mediciones de características fisicoquímicas parecidas.",
  PCA: "Resume varias mediciones simultáneas en ejes que retienen parte de su variación.",
  Anomalías: "Lecturas o eventos inusuales que requieren verificar su origen.",
  "Saturación de oxígeno":
    "Concentración teórica de OD en equilibrio con el aire para condiciones dadas.",
  "Fuera de la referencia":
    "Las entradas difieren mucho de las condiciones históricas usadas como referencia.",
  "Incertidumbre instrumental":
    "Limitación de la medición debida al sensor, su calibración o las condiciones de uso.",
};

export function Status({ tone, children }) {
  return <span className={`interpret-status ${tone}`}>{children}</span>;
}

export function Guidance({ title, children, action }) {
  return (
    <section className="panel guidance">
      <h2>{title}</h2>
      <div>{children}</div>
      {action && (
        <p>
          <strong>Siguiente paso.</strong> {action}
        </p>
      )}
    </section>
  );
}

export function Info({ term }) {
  return (
    <details className="inline-info">
      <summary aria-label={`Qué significa ${term}`}>ⓘ {term}</summary>
      <p>{glossary[term]}</p>
    </details>
  );
}

export function Dialog({ title, onClose, children, className = "" }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`guided-dialog ${className}`}
      onCancel={onClose}
    >
      <div className="section-title">
        <h2>{title}</h2>
        <button onClick={onClose}>Cerrar</button>
      </div>
      {children}
    </dialog>
  );
}

const tour = [
  [
    "Conecta el dispositivo",
    "Enciende Sender y Receiver. Conecta el Receiver por USB y elige su COM con la cuenta administradora.",
    null,
  ],
  [
    "Ve tus mediciones",
    "Monitoreo en tiempo real muestra los paquetes recibidos por LoRa.",
    "iot",
  ],
  [
    "Inicia una sesión",
    "Usa el panel de recolección para guardar hasta 100 mediciones.",
    "iot",
  ],
  [
    "Interpreta el oxígeno",
    "Consulta la estimación de CatBoost y el aviso sobre conductividad o entradas faltantes.",
    "oxigeno",
  ],
  [
    "Compara perfiles",
    "Proyecta una muestra con conductividad específica validada frente al historial de Florida.",
    "clustering",
  ],
  [
    "Revisa alertas",
    "Comprueba los cambios inusuales y documenta la revisión.",
    "anomalias",
  ],
  [
    "Abre los detalles",
    "Cambia a Vista técnica desde la barra superior.",
    "configuracion",
  ],
  [
    "Exporta mediciones",
    "Abre Datasets e historial y descarga el CSV de una sesión guardada.",
    "datasets",
  ],
];
export function Help({ onClose, connect }) {
  const [step, setStep] = useState(null);
  const finish = () => {
    localStorage.setItem("yaku-tour", "seen");
    setStep(null);
  };
  return (
    <Dialog title="Ayuda de YakuToring" onClose={onClose}>
      {step === null ? (
        <>
          <button className="primary" onClick={() => setStep(0)}>
            {localStorage.getItem("yaku-tour")
              ? "Reiniciar recorrido"
              : "Iniciar recorrido"}
          </button>
          <h3>Glosario</h3>
          {Object.keys(glossary).map((term) => (
            <Info term={term} key={term} />
          ))}
        </>
      ) : (
        <>
          <small>
            Paso {step + 1} de {tour.length}
          </small>
          <h3>{tour[step][0]}</h3>
          <p>{tour[step][1]}</p>
          {tour[step][2] ? (
            <a href={`#${tour[step][2]}`} onClick={onClose}>
              Abrir módulo
            </a>
          ) : (
            <button onClick={connect}>Abrir conexión</button>
          )}
          <div className="controls">
            <button disabled={!step} onClick={() => setStep(step - 1)}>
              Anterior
            </button>
            <button
              className="primary"
              onClick={() =>
                step + 1 === tour.length ? finish() : setStep(step + 1)
              }
            >
              {step + 1 === tour.length ? "Finalizar" : "Siguiente"}
            </button>
            <button onClick={finish}>Omitir</button>
          </div>
        </>
      )}
    </Dialog>
  );
}

export function ReadingsGuide({ rows }) {
  return (
    <Guidance title="Qué indican las mediciones">
      <div className="reading-guide">
        {[
          ["temperature", "Temperatura"],
          ["ph", "pH"],
          ["conductivity", "Conductividad"],
          ["pressure", "Presión"],
        ].map(([key, name]) => {
          const result = interpretReading(rows, key);
          return (
            <article key={key}>
              <h3>
                {name} {result.value && <small>· {result.value}</small>}
              </h3>
              <Status tone={result.tone}>{result.state}</Status>
              <p>{result.text}</p>
              {result.action && <small>{result.action}</small>}
            </article>
          );
        })}
      </div>
    </Guidance>
  );
}

export function OxygenGuide({ live, last }) {
  const result = live?.models?.catboost;
  const value = result?.value;
  const theoretical = oxygenSaturation(last?.temperature, last?.pressure);
  const available = Number.isFinite(value);
  return (
    <Guidance
      title="Oxígeno disuelto estimado"
      action={
        available
          ? "Verifica el OD con una sonda antes de tomar decisiones sobre el ecosistema."
          : "Comprueba temperatura, pH, presión y la validación de la conductividad. También puedes estimar con una muestra verificada."
      }
    >
      <strong className="oxygen-primary">
        {available ? `${value.toFixed(2)} mg/L` : "Sin estimación disponible"}
      </strong>
      <p>
        {available
          ? "Estimación CatBoost"
          : `CatBoost · ${live?.status || "Esperando mediciones válidas"}`}
      </p>
      {!available && live?.reason && <p>{live.reason}</p>}
      {result?.error && result.error !== live?.status && <p>{result.error}</p>}
      {available && (
        <p>
          La precisión en ecosistemas peruanos aún requiere validación local.
        </p>
      )}
      {available && (
        <p>
          La conductividad del Receiver es provisional. Consulta su calibración
          antes de interpretar el resultado.
        </p>
      )}
      {Number.isFinite(theoretical) && (
        <p>
          Referencia teórica de agua dulce: {theoretical.toFixed(2)} mg/L.
          Describe el equilibrio con el aire bajo la presión y temperatura
          registradas.
        </p>
      )}
      <Info term="Oxígeno disuelto" />
    </Guidance>
  );
}
