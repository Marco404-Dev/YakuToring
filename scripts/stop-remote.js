import fs from "node:fs";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL("../.local/", import.meta.url));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(new URL("../.local/stop-tunnel", import.meta.url), "stop");
console.log(
  "Se solicitó detener la aplicación y el túnel (si se iniciaron con npm run remote).",
);
