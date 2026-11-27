import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
const root = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: path.join(root, ".env"), quiet: true });
process.chdir(root);
const local = path.join(root, ".local");
fs.mkdirSync(local, { recursive: true });
const remoteFile = path.join(local, "tunnel.json");
const stopFile = path.join(local, "stop-tunnel");
if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
if (fs.existsSync(remoteFile)) {
  try {
    const old = JSON.parse(fs.readFileSync(remoteFile, "utf8"));
    process.kill(old.pid, 0);
    throw new Error(
      "Ya hay un túnel de YakuToring en ejecución. Detén esa terminal antes de iniciar otro.",
    );
  } catch (e) {
    if (
      e.code !== "ESRCH" &&
      e.code !== "EINVAL" &&
      !(e instanceof SyntaxError)
    )
      throw e;
    fs.unlinkSync(remoteFile);
  }
}
async function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("No se pudo preparar la aplicación.")),
    );
  });
}
await run(process.execPath, ["scripts/setup-auth.js"]);
await run(process.execPath, ["node_modules/vite/bin/vite.js", "build"]);
const port = Number(process.env.PORT || 3001);
const executable = fs.existsSync(path.join(root, "tools", "cloudflared.exe"))
  ? path.join(root, "tools", "cloudflared.exe")
  : "cloudflared";
const server = spawn(process.execPath, ["server/index.js"], {
  stdio: "inherit",
  windowsHide: true,
});
let cloud,
  stopping = false,
  ready = false;
const stopWatcher = setInterval(() => {
  if (fs.existsSync(stopFile)) {
    fs.unlinkSync(stopFile);
    clearInterval(stopWatcher);
    stop();
  }
}, 1000);
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(stopWatcher);
  if (cloud) cloud.kill();
  server.kill();
  if (fs.existsSync(remoteFile)) fs.unlinkSync(remoteFile);
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
server.once("error", () => {
  console.error("No se pudo iniciar Node.js.");
  stop(1);
});
server.once("exit", () => stop(ready ? 0 : 1));
for (let i = 0; i < 40; i++) {
  if (stopping) break;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
    if (r.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
if (!ready) {
  console.error("El servidor no inició. Revisa si PORT está ocupado.");
  stop(1);
} else {
  cloud = spawn(
    executable,
    ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  cloud.once("error", () => {
    console.error(
      "No se encontró cloudflared. Ejecuta scripts/install-cloudflared.ps1.",
    );
    stop(1);
  });
  cloud.once("exit", () => stop());
  let tail = "",
    published = false;
  function inspect(chunk) {
    tail = (tail + chunk.toString()).slice(-16000);
    const match = tail.match(
      /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com(?=[\s|]|$)/,
    );
    if (match && !published) {
      published = true;
      fs.writeFileSync(
        remoteFile,
        JSON.stringify({ origin: match[0], pid: cloud.pid }, null, 2),
      );
      console.log(
        `\nDashboard HTTPS temporal: ${match[0]}\nVisitantes: solo lectura. Acceso administrativo con usuario y contraseña.\nCredenciales privadas: .local/credenciales.txt\nDetener aplicación y túnel: Ctrl+C en esta terminal.\n`,
      );
    }
    if (
      /failed to request quick Tunnel|error parsing quick tunnel|failed to create tunnel/i.test(
        tail,
      )
    ) {
      console.error(
        "Cloudflare no pudo crear el túnel. Revisa Internet y la configuración de cloudflared.",
      );
      stop(1);
    }
  }
  cloud.stdout.on("data", inspect);
  cloud.stderr.on("data", inspect);
  const timeout = setTimeout(() => {
    if (!published) {
      console.error(
        "Cloudflare no devolvió URL en 60 segundos. Revisa Internet/firewall (salida 7844).",
      );
      stop(1);
    }
  }, 60000);
  timeout.unref();
}
