import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Collection } from "../server/collection.js";

const chrome = process.env.YAKUTORING_CHROME;
if (!chrome)
  throw new Error("Define YAKUTORING_CHROME con la ruta a Chrome o Chromium.");

async function waitFor(operation) {
  let last;
  for (let i = 0; i < 100; i++) {
    try {
      const result = await operation();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await delay(100);
  }
  throw last || new Error("El estado esperado no apareció.");
}

const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${listener.address().port}`;
await new Promise((resolve) => listener.close(resolve));
const temp = await mkdtemp(path.resolve(".local", "workspace-browser-"));
const dbPath = path.join(temp, "test.sqlite");
const seed = new Collection(dbPath);
const demoId = seed.start({
  target: 3,
  name: "UI test · synthetic fixture",
  ecosystem: "E3",
});
for (let i = 0; i < 3; i++)
  seed.accept({
    format: "DATA",
    packet: i,
    at: new Date(Date.UTC(2026, 10, 23, 10, 0, i)).toISOString(),
    temperature: 25 + i / 10,
    ph: 7.2,
    conductivity: 1.4,
    pressure: 1002,
  });
seed.db.close();
const backend = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    PORT: new URL(base).port,
    YAKUTORING_ML_DB_PATH: dbPath,
  },
  windowsHide: true,
  stdio: "ignore",
});
let browser;
let socket;
try {
  const live = await waitFor(async () => {
    const response = await fetch(`${base}/api/auth/me`);
    return response.ok && response.json();
  });
  assert.equal(live.role, "viewer");
  for (const endpoint of [
    "state",
    "ml/state",
    "environment/reference",
    "environment/anomalies",
  ]) {
    assert.equal((await fetch(`${base}/api/${endpoint}`)).status, 401);
  }
  const profile = path.join(temp, "profile");
  browser = spawn(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      `${base}/`,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  const [debugPort] = (
    await waitFor(() =>
      readFile(path.join(profile, "DevToolsActivePort"), "utf8"),
    )
  ).split(/\r?\n/);
  const page = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    return (await response.json()).find(
      (target) => target.type === "page" && target.url.startsWith(base),
    );
  });
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  async function command(method, params) {
    const next = ++id;
    return new Promise((resolve, reject) => {
      function onMessage(event) {
        const response = JSON.parse(event.data);
        if (response.id !== next) return;
        socket.removeEventListener("message", onMessage);
        if (response.error) reject(new Error(response.error.message));
        else resolve(response.result);
      }
      socket.addEventListener("message", onMessage);
      socket.send(JSON.stringify({ id: next, method, params }));
    });
  }
  const value = async (expression) =>
    (await command("Runtime.evaluate", { expression, returnByValue: true }))
      .result.value;
  async function viewport(width, height) {
    await command("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  async function screenshot(name) {
    if (!process.env.YAKUTORING_TEST_SCREENSHOTS) return;
    const { data } = await command("Page.captureScreenshot", { format: "png" });
    const file = path.join(temp, name);
    await writeFile(file, Buffer.from(data, "base64"));
    console.log(file);
  }
  await waitFor(() =>
    value("Boolean(document.querySelector('.access-entry form'))"),
  );
  assert.equal(
    await value("Boolean(document.querySelector('.workspace-shell'))"),
    false,
  );
  await viewport(1366, 850);
  await waitFor(() =>
    value(
      "document.querySelector('.access-photos img.current')?.naturalWidth > 0",
    ),
  );
  await value(
    `document.querySelector('[aria-label="Foto siguiente"]').click()`,
  );
  await waitFor(() =>
    value(
      `document.querySelector('[aria-label="Foto 2"]').getAttribute('aria-pressed') === 'true'`,
    ),
  );
  await value(
    "[...document.querySelectorAll('.photo-controls button')].find(button=>button.textContent==='Pausar').click()",
  );
  await waitFor(() =>
    value(
      "document.querySelector('.access-photos img.current')?.naturalWidth > 0",
    ),
  );
  if (process.env.YAKUTORING_TEST_SCREENSHOTS) await delay(750);
  await screenshot("acceso.png");
  const credentials = await readFile(".local/credenciales.txt", "utf8");
  const password = /Usuario: admin\r?\nContraseña: ([^\r\n]+)/.exec(
    credentials,
  )?.[1];
  assert(password, "Ejecuta npm run auth:setup antes de la prueba.");
  await value(`(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [field, text] of Object.entries(${JSON.stringify({ username: "admin", password })})) {
      const input = document.querySelector('.access-entry input[name="' + field + '"]');
      set.call(input, text);
      input.dispatchEvent(new Event('input', {bubbles:true}));
    }
  })()`);
  await value("document.querySelector('.access-entry form').requestSubmit()");
  await waitFor(() =>
    value("document.querySelectorAll('.workspace-sidebar nav a').length === 5"),
  );
  assert.equal(
    await value("document.querySelector('.view-selector select').value"),
    "general",
  );
  await screenshot("inicio.png");
  await value(
    "document.querySelector('.workspace-topbar button.primary').click()",
  );
  await waitFor(() =>
    value(
      "document.querySelector('dialog[open]')?.innerText.includes('Asistente de conexión')",
    ),
  );
  await value("document.querySelector('dialog button').click()");
  for (const [slug, title] of [
    ["resumen", "Inicio"],
    ["iot", "Monitoreo"],
    ["oxigeno", "Oxígeno disuelto"],
    ["clustering", "Perfiles ambientales"],
    ["anomalias", "Alertas"],
    ["fisicoquimica", "Análisis fisicoquímico"],
    ["validacion", "Validación experimental"],
    ["datasets", "Datasets e historial"],
    ["historial", "Mediciones registradas"],
    ["sesiones", "Sesiones de monitoreo"],
    ["campanas", "Campañas experimentales"],
    ["transferencias", "Importación y exportación"],
    ["whatsapp", "Notificaciones WhatsApp"],
    ["dispositivo", "Dispositivo y sensores"],
    ["configuracion", "Configuración"],
  ]) {
    await value(`location.hash = ${JSON.stringify(slug)}`);
    await waitFor(
      async () =>
        (await value("document.querySelector('main h1')?.textContent")) ===
        title,
    );
  }
  await value(
    "[...document.querySelectorAll('.workspace-topbar button')].find(button=>button.textContent==='Modo oscuro').click()",
  );
  await waitFor(() =>
    value("document.documentElement.dataset.theme === 'dark'"),
  );
  for (const width of [1366, 1024, 768, 390]) {
    await viewport(width, 844);
    assert.ok(
      await value("document.documentElement.scrollWidth <= innerWidth"),
      `Desbordamiento a ${width} px`,
    );
  }
  await value("location.hash = 'clustering'");
  await waitFor(() =>
    value(
      "document.querySelector('main').innerText.includes('Perfiles históricos de Florida')",
    ),
  );
  assert.equal(
    await value("document.querySelectorAll('.pca-plot circle').length"),
    0,
  );
  await value(
    "(() => {const select=document.querySelector('.view-selector select'); select.value='technical'; select.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await waitFor(() =>
    value("document.querySelectorAll('.pca-plot circle').length > 100"),
  );
  await screenshot("perfiles-movil.png");
  await value("location.hash = 'validacion'");
  await waitFor(() =>
    value(
      "document.querySelector('main').innerText.includes('CatBoost sin conductividad')",
    ),
  );
  const model = await waitFor(async () => {
    const info = (
      await command("Runtime.evaluate", {
        expression: "fetch('/api/ml/state').then(response => response.json())",
        awaitPromise: true,
        returnByValue: true,
      })
    ).result.value;
    return info.status === "ready" && info;
  });
  assert.deepEqual(model.activeModels, ["catboost"]);
  assert.deepEqual(
    Object.keys(model.comparison.availability).filter(
      (key) => model.comparison.availability[key].loaded,
    ),
    ["catboost"],
  );
  await viewport(1366, 850);
  await value("location.hash = 'sesiones'");
  await waitFor(() =>
    value(
      "[...document.querySelectorAll('main button')].some(button=>button.textContent==='Reporte PDF')",
    ),
  );
  assert.equal(
    await value(
      `document.querySelector('a[href="/api/collection/${demoId}/export.csv"]')?.textContent`,
    ),
    "Descargar CSV",
  );
  await value(
    "[...document.querySelectorAll('main button')].find(button=>button.textContent==='Reporte PDF').click()",
  );
  await waitFor(() =>
    value(
      "document.querySelector('dialog[open] .session-print')?.textContent.includes('UI test')",
    ),
  );
  const pdf = await command("Page.printToPDF", { printBackground: true });
  assert(pdf.data.startsWith("JVBER"));
  await value("document.querySelector('dialog button').click()");
  await value(
    "[...document.querySelectorAll('main button')].find(button=>button.textContent==='Modo demostración').click()",
  );
  await waitFor(() =>
    value(
      "document.querySelector('dialog[open]')?.textContent.includes('Modo demostración — datos históricos')",
    ),
  );
  await waitFor(() =>
    value(
      `document.querySelector('dialog[open] input[type="range"]')?.max === '2'`,
    ),
  );
  await value("document.querySelector('dialog button').click()");
  await value("document.querySelector('.sidebar-logout').click()");
  await waitFor(() =>
    value("Boolean(document.querySelector('.access-entry form'))"),
  );
  await value("location.hash = 'iot'");
  assert.equal(
    await value("Boolean(document.querySelector('.workspace-shell'))"),
    false,
  );
  console.log(
    "Workspace: acceso privado, cinco opciones principales, rutas internas, asistente, temas, cuatro anchos, PCA y CatBoost.",
  );
} finally {
  socket?.close();
  browser?.kill();
  backend.kill();
}
