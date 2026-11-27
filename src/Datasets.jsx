import React, { useEffect, useState } from "react";
import { Table } from "./Workspace.jsx";

export default function Datasets({ api, importEnabled = true }) {
  const [list, setList] = useState(null);
  const [selected, setSelected] = useState("");
  const [origin, setOrigin] = useState("Laboratorio");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dataset = list?.find((item) => item.id === selected);
  useEffect(() => {
    let active = true;
    api("environment/datasets")
      .then((data) => {
        if (active) setList(data.datasets);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [api]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setPreview(null);
    const query = new URLSearchParams({ page, search });
    api(`environment/datasets/${selected}?${query}`)
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [api, selected, page, search]);
  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    setError("");
    setBusy(true);
    try {
      if (!file?.size || file.size > 12000)
        throw new Error("Selecciona un CSV de hasta 12 kB.");
      const { id } = await api("environment/datasets", {
        name: file.name,
        origin,
        csv: await file.text(),
      });
      setList((await api("environment/datasets")).datasets);
      setSelected(id);
      setPage(0);
      setSearch("");
      form.reset();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel workspace-section">
      <h2>CSV de campañas y laboratorio</h2>
      {importEnabled && (
        <form onSubmit={save}>
          <div className="field-grid">
            <label>
              Procedencia
              <select
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
              >
                <option>Laboratorio</option>
                <option>Campo Perú</option>
                <option>Dispositivo IoT</option>
              </select>
            </label>
            <label>
              Archivo original · UTF-8, comas, hasta 12 kB
              <input required type="file" name="file" accept=".csv,text/csv" />
            </label>
          </div>
          <button className="primary" disabled={busy}>
            {busy ? "Guardando…" : "Importar CSV"}
          </button>
        </form>
      )}
      <label>
        Dataset
        <select
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            setSearch("");
            setPage(0);
          }}
        >
          <option value="">
            {list?.length
              ? "Selecciona un archivo"
              : "Sin archivos disponibles"}
          </option>
          {list?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.origin} · {item.records} filas
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {dataset && (
        <>
          <p>
            {dataset.records} filas · {dataset.duplicates} duplicados exactos ·{" "}
            {Object.values(dataset.empty).reduce(
              (sum, value) => sum + value,
              0,
            )}{" "}
            celdas vacías
          </p>
          <small title={dataset.checksum}>
            Versión SHA-256 {dataset.checksum.slice(0, 12)} ·{" "}
            {dataset.importedAt.slice(0, 10)}
          </small>
          <p>
            <a href={`/api/environment/datasets/${selected}/original.csv`}>
              Exportar archivo original
            </a>
          </p>
          <label>
            Buscar en los registros
            <input
              type="search"
              maxLength={120}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </label>
          {preview ? (
            <>
              <Table headings={preview.columns} rows={preview.rows} />
              <div className="pagination">
                <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Anterior
                </button>
                <small>
                  {preview.records} coincidencias · página {page + 1}
                </small>
                <button
                  disabled={(page + 1) * 25 >= preview.records}
                  onClick={() => setPage(page + 1)}
                >
                  Siguiente
                </button>
              </div>
            </>
          ) : (
            <p role="status">Cargando registros…</p>
          )}
        </>
      )}
    </section>
  );
}
