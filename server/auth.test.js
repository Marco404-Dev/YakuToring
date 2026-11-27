import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { hashPassword, installSecurity } from "./auth.js";
test("backend aplica roles, cookie de sesión, CSRF, cierre de sesión y origen exacto del túnel", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yaku-auth-"));
  fs.mkdirSync(path.join(root, ".local"));
  fs.writeFileSync(
    path.join(root, ".local", "users.json"),
    JSON.stringify({
      admin: { role: "admin", ...hashPassword("test-admin-password") },
      operator: { role: "operator", ...hashPassword("test-operator-password") },
    }),
  );
  const app = express();
  app.use(express.json());
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  const permissions = installSecurity(app, root, port);
  let changes = 0;
  app.get("/api/state", (_, res) => res.json({ readings: [] }));
  app.post("/api/connect", permissions.admin, (_, res) => {
    changes++;
    res.json({ ok: true });
  });
  app.post("/api/messages", permissions.sender, (_, res) => {
    changes++;
    res.json({ ok: true });
  });
  const origin = `http://127.0.0.1:${port}`;
  async function call(route, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request(
        origin + route,
        {
          method: body ? "POST" : "GET",
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            ...headers,
          },
        },
        (r) => {
          let text = "";
          r.on("data", (chunk) => (text += chunk));
          r.on("end", () =>
            resolve({
              status: r.statusCode,
              data: JSON.parse(text),
              cookie: r.headers["set-cookie"]?.[0],
            }),
          );
        },
      );
      request.on("error", reject);
      request.end(body ? JSON.stringify(body) : undefined);
    });
  }
  try {
    assert.equal((await call("/api/state")).status, 200);
    for (const route of ["/api/connect", "/api/messages"])
      assert.equal((await call(route, {})).status, 401);
    const operator = await call("/api/auth/login", {
      username: "operator",
      password: "test-operator-password",
    });
    assert.equal(operator.status, 200);
    assert.match(operator.cookie, /HttpOnly/);
    assert.match(operator.cookie, /SameSite=Strict/);
    const headers = {
      Cookie: operator.cookie.split(";")[0],
      "X-CSRF-Token": operator.data.csrf,
    };
    assert.equal((await call("/api/connect", {}, headers)).status, 403);
    assert.equal((await call("/api/messages", {}, headers)).status, 200);
    const admin = await call("/api/auth/login", {
      username: "admin",
      password: "test-admin-password",
    });
    const cookie = admin.cookie.split(";")[0];
    assert.equal(
      (await call("/api/connect", {}, { Cookie: cookie })).status,
      403,
    );
    const adminHeaders = { Cookie: cookie, "X-CSRF-Token": admin.data.csrf };
    assert.equal((await call("/api/connect", {}, adminHeaders)).status, 200);
    assert.equal(
      (
        await call(
          "/api/connect",
          {},
          { ...adminHeaders, Origin: "https://attacker.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/auth/logout", {}, adminHeaders)).status,
      200,
    );
    // Un cloudflared iniciado manualmente no escribe .local/tunnel.json.
    // La lista explícita debe permitirlo sin desactivar Host/Origin ni roles.
    const manual =
      "https://scott-exit-republican-governmental.trycloudflare.com";
    fs.mkdirSync(path.join(root, "config"));
    fs.writeFileSync(
      path.join(root, "config", "access.json"),
      JSON.stringify({
        allowedRemoteOrigins: [
          manual,
          "https://next-yakutoring.trycloudflare.com",
          "https://*.trycloudflare.com",
          "https://attacker.example",
        ],
      }),
    );
    const manualHeaders = { Host: new URL(manual).host, Origin: manual };
    assert.equal(
      (await call("/api/state", undefined, manualHeaders)).status,
      200,
    );
    assert.equal(
      (
        await call("/api/state", undefined, {
          Host: new URL(manual).host.toUpperCase(),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("/api/state", undefined, {
          Host: "next-yakutoring.trycloudflare.com",
        })
      ).status,
      200,
    );
    for (const host of [
      "unknown.trycloudflare.com",
      "attacker.example",
      "scott-exit-republican-governmental.trycloudflare.com.evil.example",
    ])
      assert.equal(
        (await call("/api/state", undefined, { Host: host })).status,
        403,
      );
    assert.equal((await call("/api/connect", {}, manualHeaders)).status, 401);
    assert.equal((await call("/api/messages", {}, manualHeaders)).status, 401);
    assert.equal(
      (
        await call(
          "/api/auth/login",
          { username: "admin", password: "test-admin-password" },
          {
            ...manualHeaders,
            Origin: "https://next-yakutoring.trycloudflare.com",
          },
        )
      ).status,
      403,
    );
    const manualLogin = await call(
      "/api/auth/login",
      { username: "admin", password: "test-admin-password" },
      manualHeaders,
    );
    assert.equal(manualLogin.status, 200);
    assert.match(manualLogin.cookie, /Secure/);
    const authorized = {
      ...manualHeaders,
      Cookie: manualLogin.cookie.split(";")[0],
      "X-CSRF-Token": manualLogin.data.csrf,
    };
    assert.equal((await call("/api/connect", {}, authorized)).status, 200);
    assert.equal(
      (
        await call(
          "/api/connect",
          {},
          {
            ...authorized,
            Host: "next-yakutoring.trycloudflare.com",
            Origin: "https://next-yakutoring.trycloudflare.com",
          },
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await call(
          "/api/connect",
          {},
          { ...authorized, "X-CSRF-Token": "invalid" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await call("/api/state", undefined, { Host: `localhost:${port}` }))
        .status,
      200,
    );
    assert.equal(
      (
        await call("/api/state", undefined, {
          Host: "unlisted.example",
          "X-Forwarded-Host": new URL(manual).host,
        })
      ).status,
      403,
    );
    // La configuración se relee: quitar un origen revoca su autorización.
    fs.writeFileSync(path.join(root, "config", "access.json"), "{}");
    assert.equal(
      (await call("/api/state", undefined, manualHeaders)).status,
      403,
    );
    assert.equal((await call("/api/connect", {}, adminHeaders)).status, 401);
    assert.equal(changes, 3);
    assert.equal(
      (
        await call("/api/state", undefined, {
          Host: "anything.trycloudflare.com",
        })
      ).status,
      403,
    );
    const remote = "https://test-yakutoring.trycloudflare.com";
    fs.writeFileSync(
      path.join(root, ".local", "tunnel.json"),
      JSON.stringify({ origin: remote, pid: process.pid }),
    );
    const remoteHeaders = { Host: new URL(remote).host, Origin: remote };
    const remoteLogin = await call(
      "/api/auth/login",
      { username: "admin", password: "test-admin-password" },
      remoteHeaders,
    );
    assert.equal(remoteLogin.status, 200);
    assert.match(remoteLogin.cookie, /Secure/);
    assert.equal(
      (await call("/api/connect", {}, { ...remoteHeaders, ...headers })).status,
      401,
    );
    assert.equal(
      (
        await call(
          "/api/connect",
          {},
          {
            ...remoteHeaders,
            Cookie: remoteLogin.cookie.split(";")[0],
            "X-CSRF-Token": remoteLogin.data.csrf,
          },
        )
      ).status,
      200,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
