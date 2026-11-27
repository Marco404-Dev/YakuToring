import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRemoteOrigin, remoteOrigins } from "./origins.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
test("lista de orígenes exige HTTPS y un dominio exacto sin rutas ni comodines", () => {
  assert.equal(
    normalizeRemoteOrigin(
      "https://scott-exit-republican-governmental.trycloudflare.com",
    ),
    "https://scott-exit-republican-governmental.trycloudflare.com",
  );
  for (const value of [
    "*",
    "https://*.trycloudflare.com",
    "http://test.trycloudflare.com",
    "https://test.trycloudflare.com/path",
    "https://test.trycloudflare.com:444",
    "https://user@test.trycloudflare.com",
    "https://test.trycloudflare.com.evil.example",
    "https://test.trycloudflare.com?x=1",
    "https://evil.example",
    null,
  ])
    assert.equal(normalizeRemoteOrigin(value), null);
});
test("configuración ilegible y PID obsoleto no autorizan hosts remotos", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yaku-origins-"));
  try {
    fs.mkdirSync(path.join(root, "config"));
    fs.mkdirSync(path.join(root, ".local"));
    fs.writeFileSync(path.join(root, "config", "access.json"), "{invalid");
    fs.writeFileSync(
      path.join(root, ".local", "tunnel.json"),
      JSON.stringify({ origin: "https://stale.trycloudflare.com", pid: -1 }),
    );
    assert.deepEqual(remoteOrigins(root), []);
    fs.writeFileSync(
      path.join(root, "config", "access.json"),
      JSON.stringify({
        allowedRemoteOrigins: [
          "https://manual.trycloudflare.com",
          "https://manual.trycloudflare.com",
          "*",
        ],
      }),
    );
    assert.deepEqual(remoteOrigins(root), ["https://manual.trycloudflare.com"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
