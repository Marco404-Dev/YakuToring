"""Bounded CSV imports distinct from NOAA, telemetry and model evaluation."""
import csv
import hashlib
import io
import json
from datetime import datetime, timezone

ORIGINS = {"Laboratorio", "Campo Perú", "Dispositivo IoT"}


class Datasets:
    def __init__(self, database):
        self.database = database
        self.database.execute('''
          CREATE TABLE IF NOT EXISTS imported_csv (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL,
            added_at TEXT NOT NULL, original TEXT NOT NULL, summary TEXT NOT NULL
          )
        ''')

    def save(self, name, origin, contents):
        if not isinstance(name, str) or not name.strip() or len(name) > 120 or origin not in ORIGINS:
            raise ValueError("Nombre u origen de dataset inválido.")
        if not isinstance(contents, str) or not contents.strip() or len(contents.encode("utf-8")) > 12000:
            raise ValueError("El CSV debe ocupar entre 1 byte y 12 kB.")
        reader = csv.reader(io.StringIO(contents.lstrip("\ufeff")), strict=True)
        headings = next(reader, [])
        if (not headings or len(headings) > 50 or len(set(headings)) != len(headings)
                or any(not cell.strip() for cell in headings)):
            raise ValueError("Se requiere un encabezado con nombres únicos (hasta 50 columnas).")
        rows = []
        for row in reader:
            if len(row) != len(headings):
                raise ValueError(f"Número de columnas inválido cerca de la línea {reader.line_num}.")
            rows.append(row)
        if not rows:
            raise ValueError("El CSV debe contener filas.")
        checksum = hashlib.sha256(contents.encode()).hexdigest()
        key = hashlib.sha256(f"{origin}:{checksum}".encode()).hexdigest()
        summary = {
            "checksum": checksum, "columns": headings, "records": len(rows),
            "duplicates": len(rows) - len(set(map(tuple, rows))),
            "empty": {item: sum(not row[i].strip() for row in rows)
                      for i, item in enumerate(headings)},
        }
        with self.database:
            self.database.execute(
                "INSERT OR IGNORE INTO imported_csv VALUES (?, ?, ?, ?, ?, ?)",
                (key, name, origin, datetime.now(timezone.utc).isoformat(), contents, json.dumps(summary)),
            )
        return {"id": key}

    def list(self):
        rows = self.database.execute(
            "SELECT id,name,origin,added_at,summary FROM imported_csv ORDER BY added_at DESC LIMIT 100"
        )
        return {"datasets": [
            {"id": key, "name": name, "origin": origin, "importedAt": at, **json.loads(summary)}
            for key, name, origin, at, summary in rows
        ]}

    def get(self, key, page=None, search=""):
        record = self.database.execute("SELECT original FROM imported_csv WHERE id=?", (key,)).fetchone()
        if record is None:
            raise ValueError("Dataset no encontrado.")
        if page is None:
            return {"csv": record[0]}
        if type(page) is not int or page < 0 or not isinstance(search, str) or len(search) > 120:
            raise ValueError("Paginación o búsqueda inválida.")
        reader = csv.reader(io.StringIO(record[0].lstrip("\ufeff")))
        columns = next(reader)
        rows = [row for row in reader if not search or any(search.casefold() in cell.casefold() for cell in row)]
        return {"columns": columns, "rows": rows[page*25:(page+1)*25], "records": len(rows)}
