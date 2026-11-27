import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const COLLECTION_LIMIT = 100;
export const COLLECTION_MAX = 10000;

const ecStatus = "provisional_calibracion_en_verificacion";
const range = (value, low, high) =>
  Number.isFinite(value) && value >= low && value <= high;

function valid(row) {
  return (
    ["DATA", "YK"].includes(row.format) &&
    Number.isSafeInteger(row.packet) &&
    row.packet >= 0 &&
    typeof row.at === "string" &&
    /(?:Z|[+-]\d\d:\d\d)$/.test(row.at) &&
    Number.isFinite(Date.parse(row.at)) &&
    range(row.temperature, -55, 125) &&
    range(row.ph, 0, 14) &&
    range(row.conductivity, 0, Infinity) &&
    range(row.pressure, 0.01, 2000)
  );
}

export class Collection {
  constructor(filename) {
    if (filename !== ":memory:")
      mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    const columns = this.db
      .prepare("PRAGMA table_info(collection_sessions)")
      .all();
    const migrate =
      columns.length && !columns.some((column) => column.name === "target");
    if (migrate)
      this.db.exec(`
      BEGIN IMMEDIATE;
      DROP TRIGGER IF EXISTS collection_sample_added;
      DROP INDEX IF EXISTS collection_one_active;
      ALTER TABLE collection_sessions RENAME TO collection_sessions_v1;
      ALTER TABLE collection_samples RENAME TO collection_samples_v1;
    `);
    try {
      this.db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS collection_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'complete', 'finished')),
        count INTEGER NOT NULL DEFAULT 0 CHECK(count BETWEEN 0 AND ${COLLECTION_MAX}),
        target INTEGER NOT NULL DEFAULT 100 CHECK(target BETWEEN 1 AND ${COLLECTION_MAX}),
        name TEXT, location TEXT, depth REAL, notes TEXT, ecosystem TEXT, ended_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS collection_one_active
        ON collection_sessions(status) WHERE status = 'active';
      CREATE TABLE IF NOT EXISTS collection_samples (
        session_id INTEGER REFERENCES collection_sessions(id),
        number INTEGER NOT NULL CHECK(number BETWEEN 1 AND ${COLLECTION_MAX}),
        capture_id TEXT NOT NULL UNIQUE,
        sequence INTEGER NOT NULL,
        at TEXT NOT NULL,
        temperature REAL NOT NULL,
        ph REAL NOT NULL,
        conductivity REAL NOT NULL,
        pressure REAL NOT NULL,
        ec_status TEXT NOT NULL,
        PRIMARY KEY (session_id, number),
        UNIQUE (session_id, sequence)
      );
    `);
      if (migrate)
        this.db.exec(`
      INSERT INTO collection_sessions(id,created_at,status,count,ended_at)
      SELECT id,created_at,status,count,
        CASE WHEN status='complete' THEN (SELECT MAX(at) FROM collection_samples_v1 WHERE session_id=collection_sessions_v1.id) END
      FROM collection_sessions_v1;
      INSERT INTO collection_samples SELECT * FROM collection_samples_v1;
      DROP TABLE collection_samples_v1;
      DROP TABLE collection_sessions_v1;
    `);
      this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS collection_sample_added
      AFTER INSERT ON collection_samples BEGIN
        UPDATE collection_sessions
        SET count = NEW.number,
            status = CASE WHEN NEW.number = target THEN 'complete' ELSE status END,
            ended_at = CASE WHEN NEW.number = target THEN NEW.at ELSE ended_at END
        WHERE id = NEW.session_id;
      END;
    `);
      if (migrate) this.db.exec("COMMIT");
    } catch (error) {
      if (migrate) this.db.exec("ROLLBACK");
      throw error;
    }
    this.insert = this.db.prepare(`
      INSERT INTO collection_samples
      SELECT id, count + 1, ?, ?, ?, ?, ?, ?, ?, ?
      FROM collection_sessions
      WHERE status = 'active' AND count < target
      ON CONFLICT(session_id, sequence) DO NOTHING
    `);
  }

  snapshot() {
    const sessions = this.db
      .prepare(
        `
      SELECT id, created_at AS createdAt, ended_at AS endedAt, status, count,
        target,name,location,depth,notes,ecosystem,
        (SELECT MIN(at) FROM collection_samples WHERE session_id=collection_sessions.id) AS firstSample,
        (SELECT MAX(at) FROM collection_samples WHERE session_id=collection_sessions.id) AS lastSample
      FROM collection_sessions ORDER BY id DESC
    `,
      )
      .all();
    return { sessions, limit: COLLECTION_LIMIT, max: COLLECTION_MAX };
  }

  start(options = {}) {
    const { target = COLLECTION_LIMIT, depth = null } = options ?? {};
    if (!Number.isSafeInteger(target) || target < 1 || target > COLLECTION_MAX)
      throw new Error(
        `La cantidad debe ser un entero entre 1 y ${COLLECTION_MAX}.`,
      );
    if (depth !== null && !range(depth, 0, 11000))
      throw new Error("Profundidad inválida.");
    const fields = ["name", "location", "notes", "ecosystem"].map((key) => {
      const value = options?.[key] ?? "";
      if (
        typeof value !== "string" ||
        value.length > (key === "notes" ? 1000 : 120)
      )
        throw new Error("Metadatos de sesión inválidos o demasiado largos.");
      return value.trim() || null;
    });
    const result = this.db
      .prepare(
        `
      INSERT INTO collection_sessions(created_at, status,target,depth,name,location,notes,ecosystem)
      VALUES (?, 'active',?,?,?,?,?,?) ON CONFLICT DO NOTHING
    `,
      )
      .run(new Date().toISOString(), target, depth, ...fields);
    if (!result.changes)
      throw new Error("Ya hay una sesión de recolección activa.");
    return Number(result.lastInsertRowid);
  }

  finish(id) {
    if (
      !this.db
        .prepare(
          "UPDATE collection_sessions SET status='finished', ended_at=? WHERE id=? AND status IN ('active','paused')",
        )
        .run(new Date().toISOString(), id).changes
    )
      throw new Error("Selecciona una sesión activa o pausada.");
  }

  pause(id) {
    if (
      !this.db
        .prepare(
          `
      UPDATE collection_sessions
      SET status = CASE WHEN status = 'active' THEN 'paused' ELSE status END
      WHERE id = ?
    `,
        )
        .run(id).changes
    )
      throw new Error("No se encontró la sesión.");
  }

  resume(id) {
    if (
      !this.db
        .prepare(
          `
      UPDATE collection_sessions SET status = 'active'
      WHERE id = ? AND status = 'paused'
      AND NOT EXISTS (SELECT 1 FROM collection_sessions WHERE status = 'active')
    `,
        )
        .run(id).changes
    )
      throw new Error(
        "Selecciona una sesión pausada y detén cualquier sesión activa.",
      );
  }

  accept(row) {
    if (!valid(row)) return null;
    const captureId = randomUUID();
    const { changes } = this.insert.run(
      captureId,
      row.packet,
      row.at,
      row.temperature,
      row.ph,
      row.conductivity,
      row.pressure,
      ecStatus,
    );
    return changes ? captureId : null;
  }

  export(id) {
    const session = this.db
      .prepare("SELECT * FROM collection_sessions WHERE id = ?")
      .get(id);
    if (!session) {
      throw new Error("No se encontró la sesión.");
    }
    const records = this.measurements(id);
    const header = [
      "sesion_id",
      "numero_medicion",
      "fecha_hora",
      "temperatura_agua_c",
      "ph",
      "tds_ppm",
      "conductividad_ms_cm",
      "presion_hpa",
      "od_estimado_mg_l",
      "estado_estimacion",
      "od_referencia_mg_l",
      "error_absoluto_mg_l",
      "estado_calibracion_conductividad",
      "secuencia_lora",
    ];
    const lines = records.map((row) =>
      [
        id,
        row.id,
        row.at,
        row.temperature,
        row.ph,
        null,
        row.conductivity,
        row.pressure,
        row.od_estimado_mg_l,
        row.odStatus,
        row.od_referencia_mg_l,
        row.error_absoluto_mg_l,
        row.ecStatus,
        row.packet,
      ].join(","),
    );
    return {
      csv: [header.join(","), ...lines, ""].join("\r\n"),
      filename: `YakuToring_Mediciones_${session.created_at.slice(0, 10)}_Sesion${String(id).padStart(3, "0")}.csv`,
    };
  }

  measurements(id) {
    const hasOd = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'experimental_od'",
      )
      .get();
    const hasRuns = this.db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'comparison_runs'",
      )
      .get();
    const records = this.db
      .prepare(
        `
      SELECT s.*, ${hasOd ? "od.result" : "NULL AS result"}, ${hasRuns ? "cb.result AS cb_result" : "NULL AS cb_result"}
      FROM collection_samples s
      ${hasOd ? "LEFT JOIN experimental_od od ON od.id = s.capture_id" : ""}
      ${hasRuns ? "LEFT JOIN comparison_runs cb ON cb.id = s.capture_id" : ""}
      WHERE s.session_id = ? ORDER BY s.number
    `,
      )
      .all(id);
    return records.map((row) => {
      const od = row.result ? JSON.parse(row.result) : null;
      const run = row.cb_result ? JSON.parse(row.cb_result) : null;
      const catboost = run?.status ? run.models?.catboost : null;
      return {
        id: row.number,
        packet: row.sequence,
        at: row.at,
        temperature: row.temperature,
        ph: row.ph,
        conductivity: row.conductivity,
        pressure: row.pressure,
        od_estimado_mg_l: catboost
          ? catboost.value
          : (od?.od_estimado_mg_l ?? null),
        odStatus: catboost
          ? `catboost_${catboost.status}`
          : (od?.status ?? "sin_resultado_ml"),
        od_referencia_mg_l: od?.od_referencia_mg_l ?? null,
        error_absoluto_mg_l: catboost
          ? null
          : (od?.error_absoluto_mg_l ?? null),
        ecStatus: row.ec_status,
      };
    });
  }
}
