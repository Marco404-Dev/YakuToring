import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const python =
  process.env.YAKUTORING_PYTHON ||
  path.join(
    root,
    ".venv-ml",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
const result = spawnSync(
  python,
  ["-m", "unittest", "discover", "-s", "ml", "-p", "test_*.py", "-v"],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
if (result.error)
  console.error(
    "Prepara el entorno con scripts/setup-ml.ps1 antes de probar ML.",
  );
process.exitCode = result.status ?? 1;
