import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../server/auth.js";
const dir = fileURLToPath(new URL("../.local/", import.meta.url));
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, "users.json");
if (fs.existsSync(target)) {
  console.log(
    "Usuarios existentes conservados. No se cambió ninguna contraseña.",
  );
  process.exit(0);
}
const admin = crypto.randomBytes(24).toString("base64url"),
  operator = crypto.randomBytes(24).toString("base64url");
fs.writeFileSync(
  target,
  JSON.stringify(
    {
      admin: { role: "admin", ...hashPassword(admin) },
      operator: { role: "operator", ...hashPassword(operator) },
    },
    null,
    2,
  ),
  { mode: 0o600, flag: "wx" },
);
fs.writeFileSync(
  path.join(dir, "credenciales.txt"),
  `YakuToring: acceso privado. NO COMPARTIR NI INCLUIR EN ZIP.\n\nUsuario: admin\nContraseña: ${admin}\nPermisos: controlar COM y enviar WhatsApp.\n\nUsuario: operator\nContraseña: ${operator}\nPermisos: enviar WhatsApp, sin control de COM.\n\nVisitante sin sesión: solo lectura.\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Acceso configurado. Abre .local/credenciales.txt en esta computadora para consultar las contraseñas. No se imprimen en consola.",
);
