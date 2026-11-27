// Prueba física explícita: node scripts/check-serial.js COM16
import fs from "node:fs";
import dotenv from "dotenv";
import { setTimeout } from "node:timers/promises";
dotenv.config({ path: new URL("../.env", import.meta.url), quiet: true });
const base = `http://127.0.0.1:${process.env.PORT || 3001}`;
const text = fs.readFileSync(
  new URL("../.local/credenciales.txt", import.meta.url),
  "utf8",
);
const password = /Usuario: admin\r?\nContraseña: ([^\r\n]+)/.exec(text)?.[1];
let headers = { Origin: base, "Content-Type": "application/json" };
async function api(route, body) {
  const r = await fetch(base + "/api/" + route, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Falló la prueba.");
  return { data, cookie: r.headers.get("set-cookie") };
}
const auth = await api("auth/login", { username: "admin", password });
headers = {
  ...headers,
  Cookie: auth.cookie.split(";")[0],
  "X-CSRF-Token": auth.data.csrf,
};
const selected = process.argv[2];
if (!selected)
  throw new Error(
    "Indica el puerto explícitamente: node scripts/check-serial.js COM16",
  );
const before = (await api("state")).data;
if (before.status.connected)
  throw new Error(
    "Desconecta el Receiver desde la aplicación antes de iniciar esta prueba para no interrumpir una sesión existente.",
  );
let connected = false;
try {
  await api("connect", { path: selected });
  connected = true;
  console.log(
    "Conectado:",
    selected,
    "a 115200 baudios. Observando lecturas reales…",
  );
  await setTimeout(20000);
  const first = (await api("state")).data;
  const samples = first.readings.slice(before.readings.length);
  console.log(
    JSON.stringify(
      { received: samples.length, last: samples.slice(-3) },
      null,
      2,
    ),
  );
  await api("disconnect", {});
  connected = false;
  await api("connect", { path: selected });
  connected = true;
  await setTimeout(10000);
  const after = (await api("state")).data;
  const resumed = after.readings.slice(first.readings.length);
  const result = {
    units: {
      temperature: "°C",
      ph: "pH",
      conductivity: "mS/cm",
      pressure: "hPa",
    },
    capturedAt: new Date().toISOString(),
    source: `Receiver real USB ${selected}, 115200 baudios`,
    readings: after.readings.slice(before.readings.length),
    beforeReconnect: samples.length,
    afterReconnect: resumed.length,
  };
  const directory = new URL("../verification/", import.meta.url);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    new URL("receiver-conductivity.json", directory),
    JSON.stringify(result, null, 2),
  );
  console.log("Mediciones después de reconectar:", resumed.length);
  console.log("Evidencia guardada en verification/receiver-conductivity.json.");
  if (!samples.some((r) => r.format === "DATA"))
    throw new Error(
      "No se observaron paquetes DATA reales. La recepción de cuatro sensores sigue pendiente.",
    );
  if (!resumed.length)
    throw new Error(
      "No llegaron paquetes durante la ventana posterior a reconexión.",
    );
} finally {
  if (connected) await api("disconnect", {});
  await api("auth/logout", {});
}
