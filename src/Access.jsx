import React, { useEffect, useState } from "react";

const photos = [
  [
    "Javier Távara",
    "CC BY 2.0",
    "Manglares_de_Tumbes.jpg",
    "Conectamos tecnología y naturaleza",
  ],
  [
    "RiSpecchia",
    "CC BY-SA 4.0",
    "Manglares_Tumbes.jpg",
    "Datos para el monitoreo ambiental",
  ],
  [
    "GraceAlison",
    "CC BY-SA 4.0",
    "Manglares_de_Tumbes_-_Perú.jpg",
    "Comprendiendo los manglares del Perú",
  ],
  [
    "AKTL14251527",
    "CC BY-SA 4.0",
    "Paseo_por_los_Manglares_de_Tumbes.jpg",
    "Observamos el agua y su entorno",
  ],
];

export default function Access({
  username,
  setUsername,
  password,
  setPassword,
  signIn,
  error,
  busy,
  configured,
}) {
  const [visible, setVisible] = useState(false);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const move = (delta) =>
    setSlide((current) => (current + delta + photos.length) % photos.length);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(
      () => setSlide((current) => (current + 1) % photos.length),
      6000,
    );
    return () => clearTimeout(timer);
  }, [paused, slide]);
  return (
    <main className="access-shell">
      <section className="access-identity">
        <div className="access-photos" aria-hidden="true">
          {photos.map(
            (_, index) =>
              [
                slide,
                (slide + 1) % photos.length,
                (slide + photos.length - 1) % photos.length,
              ].includes(index) && (
                <img
                  key={index}
                  src={`/manglar/tumbes-${index + 1}.webp`}
                  className={slide === index ? "current" : ""}
                  alt=""
                  decoding="async"
                />
              ),
          )}
        </div>
        <div className="access-brand">
          <span className="brand-mark" aria-hidden="true">
            ≈
          </span>
          YakuToring
        </div>
        <div className="water-art" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="access-statement">
          <p>OBSERVATORIO ACUÁTICO · PERÚ</p>
          <h1>La naturaleza también genera datos.</h1>
          <p>
            Inteligencia ambiental para comprender y monitorear nuestros
            ecosistemas acuáticos.
          </p>
          <p className="photo-message">{photos[slide][3]}</p>
          <div className="photo-controls">
            <button
              type="button"
              onClick={() => move(-1)}
              aria-label="Foto anterior"
            >
              ‹
            </button>
            {photos.map((photo, index) => (
              <button
                type="button"
                key={photo[2]}
                onClick={() => setSlide(index)}
                aria-label={`Foto ${index + 1}`}
                aria-pressed={slide === index}
              >
                {index + 1}
              </button>
            ))}
            <button
              type="button"
              onClick={() => move(1)}
              aria-label="Foto siguiente"
            >
              ›
            </button>
            <button type="button" onClick={() => setPaused(!paused)}>
              {paused ? "Reproducir" : "Pausar"}
            </button>
          </div>
          <a
            className="photo-credit"
            href={`https://commons.wikimedia.org/wiki/File:${encodeURIComponent(photos[slide][2])}`}
            target="_blank"
            rel="noreferrer"
          >
            Foto: {photos[slide][0]} · {photos[slide][1]} · adaptación WebP
          </a>
        </div>
      </section>
      <section className="access-entry" aria-labelledby="access-title">
        <form onSubmit={signIn}>
          <h2 id="access-title">Iniciar sesión</h2>
          <p>Accede al observatorio con tu cuenta autorizada.</p>
          {configured === false && (
            <p className="notice">
              Configura una cuenta en el equipo principal con{" "}
              <code>npm run auth:setup</code>.
            </p>
          )}
          <label>
            Usuario
            <input
              required
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            Contraseña
            <input
              required
              name="password"
              type={visible ? "text" : "password"}
              maxLength={256}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="visibility-button"
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          </button>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <button className="primary access-submit" disabled={busy}>
            {busy ? "Verificando…" : "Entrar al observatorio"}
          </button>
        </form>
      </section>
    </main>
  );
}

export function LinkFlow({ packet, active }) {
  return (
    <div className="link-architecture">
      <ol aria-label="Ruta de transmisión">
        {["Sensores", "Heltec Sender", "LoRa", "Receiver", "Aplicación"].map(
          (label) => (
            <li key={label}>{label}</li>
          ),
        )}
      </ol>
      <div className="link-track" aria-hidden="true">
        {active && packet != null && <i key={packet} />}
      </div>
    </div>
  );
}
