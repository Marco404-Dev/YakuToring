import { SerialPort, ReadlineParser } from "serialport";
import dotenv from "dotenv";

dotenv.config({ quiet: true });
const token = process.env.YAKUTORING_INGEST_TOKEN;
const url = new URL(
  "/ingest/heltec",
  process.env.YAKUTORING_AGENT_URL || "http://localhost",
);
const portName = process.argv[2];
if (!portName || !token || token.length < 32 || url.protocol !== "https:")
  throw new Error(
    "Configura YAKUTORING_AGENT_URL (HTTPS), YAKUTORING_INGEST_TOKEN y pasa el puerto serial como argumento.",
  );
const port = new SerialPort({ path: portName, baudRate: 115200 });
const reader = port.pipe(new ReadlineParser({ delimiter: "\n" }));
const queue = [];
let busy = false;
reader.on("data", (value) => {
  const line = value.trim();
  if (line && line.length <= 240 && queue.length < 256) queue.push(line);
});
port.on("open", () => console.log(`Receiver abierto en ${portName}`));
port.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
  clearInterval(timer);
});
const timer = setInterval(async () => {
  if (busy || !queue.length) return;
  busy = true;
  const lines = queue.splice(0, 64);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lines }),
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok)
      console.error(`Backend respondió ${response.status}; lote descartado.`);
  } catch {
    console.error("Sin conexión HTTPS; lote descartado.");
  } finally {
    busy = false;
  }
}, 180);
process.on("SIGINT", () => {
  clearInterval(timer);
  if (port.isOpen) port.close();
});
