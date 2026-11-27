import { readFile } from "node:fs/promises";
import path from "node:path";

export function installEnvironmentRoutes(app, root, permissions, ml) {
  const cache = new Map();
  async function artifact(name) {
    if (!cache.has(name)) {
      const file = path.join(root, "ml/environment_models", name);
      cache.set(name, JSON.parse(await readFile(file, "utf8")));
    }
    return cache.get(name);
  }
  app.get("/api/environment/reference", async (_, res) => {
    try {
      res.json(await artifact("florida-v1.json"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      res
        .status(503)
        .json({ error: "El artefacto Florida v1 todavía no está disponible." });
    }
  });
  app.get("/api/environment/evaluation", async (_, res) => {
    try {
      res.json(await artifact("noaa-experiments-v1.json"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      res
        .status(503)
        .json({ error: "La evaluación NOAA 2024 todavía no está disponible." });
    }
  });
  app.post(
    "/api/environment/predictions",
    permissions.sender,
    async (req, res) => {
      const { csv, row, validated, noConductivity } = req.body ?? {};
      if (
        (validated !== true && noConductivity !== true) ||
        (!row && typeof csv !== "string") ||
        (typeof csv === "string" && csv.length > 12000)
      ) {
        return res.status(400).json({
          error:
            "Confirma la conductividad específica y verifica el tamaño de la entrada.",
        });
      }
      res.json(
        await ml.request("environment_predictions", {
          csv,
          row,
          noConductivity: noConductivity === true,
        }),
      );
    },
  );
  app.get("/api/environment/datasets", permissions.sender, async (_, res) => {
    res.json(await ml.request("datasets_list"));
  });
  app.post(
    "/api/environment/datasets",
    permissions.sender,
    async (req, res) => {
      const { name, origin, csv } = req.body ?? {};
      res
        .status(201)
        .json(await ml.request("datasets_add", { name, origin, csv }));
    },
  );
  app.get(
    "/api/environment/datasets/:key",
    permissions.sender,
    async (req, res) => {
      res.json(
        await ml.request("datasets_get", {
          key: req.params.key,
          page: Number(req.query.page ?? 0),
          search: String(req.query.search ?? ""),
        }),
      );
    },
  );
  app.get(
    "/api/environment/datasets/:key/original.csv",
    permissions.sender,
    async (req, res) => {
      const { csv } = await ml.request("datasets_get", { key: req.params.key });
      res
        .attachment("YakuToring-original.csv")
        .type("text/plain; charset=utf-8")
        .send(csv);
    },
  );
}
