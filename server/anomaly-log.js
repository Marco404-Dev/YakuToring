import { DatabaseSync } from "node:sqlite";
import { reviewReadings } from "../src/environment.js";
import { sensors } from "../src/sensors.js";

const GROUP_MS = 5 * 60_000;

export class AnomalyLog {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS environment_anomalies (
        id INTEGER PRIMARY KEY, sensor TEXT NOT NULL, cause TEXT NOT NULL,
        firstAt INTEGER NOT NULL, lastAt INTEGER NOT NULL, value REAL, score REAL,
        occurrences INTEGER NOT NULL DEFAULT 1, reviewed INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS environment_anomalies_recent ON environment_anomalies(lastAt DESC);
      CREATE TABLE IF NOT EXISTS environment_anomaly_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1), threshold REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS environment_sensor_settings (
        id INTEGER PRIMARY KEY CHECK(id=1), temperature_tolerance REAL NOT NULL
      );
    `);
    this.threshold =
      this.db
        .prepare(
          "SELECT threshold FROM environment_anomaly_settings WHERE id = 1",
        )
        .get()?.threshold ?? 3.5;
    this.record = this.db.prepare(`
      INSERT INTO environment_anomalies(sensor,cause,firstAt,lastAt,value,score) VALUES(?,?,?,?,?,?)
    `);
    this.tolerance =
      this.db
        .prepare(
          "SELECT temperature_tolerance AS value FROM environment_sensor_settings WHERE id=1",
        )
        .get()?.value ?? 0.25;
    this.group = this.db.prepare(`
      UPDATE environment_anomalies SET lastAt=?, value=?, score=?, occurrences=occurrences+1
      WHERE id = (SELECT id FROM environment_anomalies
        WHERE sensor=? AND cause=? AND reviewed=0 AND lastAt BETWEEN ? AND ?
        ORDER BY lastAt DESC LIMIT 1)
    `);
  }

  accept(readings) {
    for (const event of reviewReadings(
      readings,
      sensors,
      this.threshold,
      1,
      this.tolerance,
    )) {
      this.add(
        event.sensor.key,
        event.cause,
        Date.parse(event.row.at),
        event.value,
        event.score,
      );
    }
  }

  add(sensor, cause, at, value = null, score = null) {
    const update = this.group.run(
      at,
      value,
      score,
      sensor,
      cause,
      at - GROUP_MS,
      at,
    );
    if (!update.changes) this.record.run(sensor, cause, at, at, value, score);
  }

  snapshot() {
    return {
      threshold: this.threshold,
      tolerance: this.tolerance,
      events: this.db
        .prepare(
          "SELECT * FROM environment_anomalies ORDER BY lastAt DESC, id DESC LIMIT 100",
        )
        .all(),
    };
  }

  setTolerance(value) {
    if (!Number.isFinite(value) || value < 0.0625 || value > 5)
      throw new Error("Tolerancia de temperatura inválida.");
    this.db
      .prepare("INSERT OR REPLACE INTO environment_sensor_settings VALUES(1,?)")
      .run(value);
    this.tolerance = value;
  }

  between(start, end) {
    return this.db
      .prepare(
        "SELECT * FROM environment_anomalies WHERE lastAt>=? AND firstAt<=? ORDER BY firstAt LIMIT 500",
      )
      .all(start, end);
  }

  configure(threshold) {
    if (!Number.isFinite(threshold) || threshold < 2 || threshold > 8) {
      throw new Error("El umbral z robusto debe estar entre 2 y 8.");
    }
    this.db
      .prepare(
        "INSERT OR REPLACE INTO environment_anomaly_settings VALUES (1, ?)",
      )
      .run(threshold);
    this.threshold = threshold;
  }

  review(id) {
    if (!Number.isSafeInteger(id) || id < 1)
      throw new Error("Identificador de evento inválido.");
    this.db
      .prepare("UPDATE environment_anomalies SET reviewed=1 WHERE id=?")
      .run(id);
  }
}
