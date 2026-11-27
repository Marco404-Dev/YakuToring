import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
export class MLClient {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.pending = new Map();
    this.child = null;
    this.state = {
      status: "starting",
      latest: null,
      history: [],
      settings: {
        lotId: "campo-principal",
        validationEnabled: false,
        calibration: null,
      },
      metrics: { n: 0, mae: null, rmse: null, r2: null },
    };
    fs.mkdirSync(path.join(root, ".local"), { recursive: true });
    this.diagnose = (event) => {
      try {
        fs.appendFileSync(
          path.join(root, ".local", "ml-diagnostics.jsonl"),
          JSON.stringify({ at: new Date().toISOString(), event }) + "\n",
        );
      } catch {}
    };
    this.diagnose("starting_python_worker");
    const python =
      process.env.YAKUTORING_PYTHON ||
      path.join(
        root,
        ".venv-ml",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      );
    this.child = spawn(python, ["-u", path.join(root, "ml", "worker.py")], {
      cwd: root,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) =>
              !key.startsWith("WHATSAPP_") &&
              !["YAKUTORING_INGEST_TOKEN", "YAKUTORING_USERS_JSON"].includes(key),
          ),
        ),
        PYTHONUNBUFFERED: "1",
        OMP_NUM_THREADS: "1",
        ...(options.activeModels
          ? { YAKUTORING_ACTIVE_MODELS: options.activeModels }
          : {}),
        ...(options.provisionalEC
          ? { YAKUTORING_OD_ALLOW_PROVISIONAL_EC: "1" }
          : {}),
        ...(options.databasePath
          ? { YAKUTORING_ML_DB_PATH: options.databasePath }
          : {}),
      },
    });
    const failed = () => {
      this.diagnose("python_worker_unavailable");
      this.state = {
        ...this.state,
        status: "unavailable",
        error:
          "Servicio ML no disponible. Revisa el entorno Python y reinicia Node. Las lecturas seriales continúan.",
      };
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error("Servicio ML no disponible."));
      }
      this.pending.clear();
    };
    this.child.once("error", failed);
    this.child.once("exit", failed);
    this.child.stdin.on("error", () => {});
    this.child.stderr.on("data", () => {});
    readline
      .createInterface({ input: this.child.stdout })
      .on("line", (line) => {
        try {
          const m = JSON.parse(line);
          if (m.event === "ready") {
            this.state = m.snapshot;
            this.diagnose(
              m.snapshot.experimentalOd?.error
                ? "noaa_candidate_unavailable"
                : "python_worker_ready",
            );
            return;
          }
          const p = this.pending.get(m.id);
          if (!p) return;
          this.pending.delete(m.id);
          clearTimeout(p.timer);
          if (m.error) {
            this.diagnose("request_rejected");
            p.reject(new Error(m.error));
          } else {
            if (m.data?.modelVersion) this.state = m.data;
            p.resolve(m.data);
          }
        } catch {
          this.state = {
            ...this.state,
            error: "Respuesta ML inválida; no se inventan predicciones.",
          };
        }
      });
  }
  request(op, payload = {}) {
    if (!this.child || this.state.status !== "ready")
      return Promise.reject(
        new Error(this.state.error || "El modelo todavía está cargando."),
      );
    if (this.pending.size >= 200)
      return Promise.reject(
        new Error("Cola ML ocupada. La lectura cruda se conserva localmente."),
      );
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error("Servicio ML sin respuesta dentro del tiempo esperado."),
        );
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ id, op, ...payload }) + "\n",
        (err) => {
          if (err) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(new Error("No se pudo comunicar con Python."));
          }
        },
      );
    });
  }
  ingest(row) {
    const record = {
      ...row,
      lotId: this.state.settings?.lotId || "campo-principal",
    };
    try {
      fs.appendFileSync(
        this.options.telemetryPath ||
          path.join(this.root, ".local", "telemetry.jsonl"),
        JSON.stringify(record) + "\n",
      );
    } catch {
      this.state = {
        ...this.state,
        error: "No se pudo guardar el registro crudo en disco.",
      };
    }
    return this.request("ingest", { row: record }).catch((e) => {
      this.state = { ...this.state, error: e.message };
      return null;
    });
  }
  close() {
    if (this.child) this.child.kill();
  }
}
