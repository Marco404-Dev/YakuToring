import fs from "node:fs";
import path from "node:path";

// Solo orígenes HTTPS completos y exactos de Quick Tunnel. Sin comodines,
// credenciales, rutas, puertos alternativos ni confianza en X-Forwarded-Host.
export function normalizeRemoteOrigin(value) {
  if (typeof value !== "string") return null;
  const origin = value.toLowerCase();
  return /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/.test(
    origin,
  )
    ? origin
    : null;
}
export function remoteOrigins(root) {
  const allowed = new Set();
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(root, "config", "access.json"), "utf8"),
    );
    if (Array.isArray(config.allowedRemoteOrigins))
      for (const candidate of config.allowedRemoteOrigins) {
        const origin = normalizeRemoteOrigin(candidate);
        if (origin) allowed.add(origin);
      }
  } catch {
    /* Configuración ausente/ilegible: no ampliar acceso. */
  }
  // El lanzador registra únicamente el dominio generado por su proceso activo.
  try {
    const { origin, pid } = JSON.parse(
      fs.readFileSync(path.join(root, ".local", "tunnel.json"), "utf8"),
    );
    if (Number.isSafeInteger(pid) && pid > 0) {
      process.kill(pid, 0);
      const valid = normalizeRemoteOrigin(origin);
      if (valid) allowed.add(valid);
    }
  } catch {
    /* Un registro temporal obsoleto no autoriza ningún dominio. */
  }
  return [...allowed];
}
