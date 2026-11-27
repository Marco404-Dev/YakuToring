import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { remoteOrigins } from "./origins.js";
import { webhookPath } from "./whatsapp-webhook.js";
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export function hashPassword(
  password,
  salt = crypto.randomBytes(16).toString("hex"),
) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}
export function verifyPassword(password, entry) {
  if (typeof password !== "string" || password.length > 256 || !entry)
    return false;
  const hash = crypto.scryptSync(password, entry.salt, 64);
  const expected = Buffer.from(entry.hash, "hex");
  return (
    expected.length === hash.length && crypto.timingSafeEqual(hash, expected)
  );
}
export function installSecurity(app, root, port) {
  const sessions = new Map(),
    failures = new Map();
  const configPath =
    process.env.YAKUTORING_USERS_PATH ||
    path.join(root, ".local", "users.json");
  const cloudOrigins = [
    process.env.RENDER_EXTERNAL_URL,
    process.env.YAKUTORING_FRONTEND_ORIGIN,
  ].filter((value) => value && /^https:\/\/[^/]+$/.test(value));
  const users = () => {
    try {
      return JSON.parse(process.env.YAKUTORING_USERS_JSON || fs.readFileSync(configPath, "utf8"));
    } catch {
      return {};
    }
  };
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    const origins = [...remoteOrigins(root), ...cloudOrigins];
    const localOrigins = [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ];
    const allowed = [...localOrigins, ...origins];
    const host = req.headers.host?.toLowerCase();
    if (req.path === "/healthz" && req.method === "GET") return next();
    if (!allowed.some((o) => new URL(o).host === host))
      return res.status(403).json({ error: "Host no autorizado." });
    const origin = origins.find((o) => new URL(o).host === host);
    const proxyOrigin =
      cloudOrigins.includes(origin) && process.env.YAKUTORING_FRONTEND_ORIGIN;
    req.remoteOrigin = !!origin;
    if (
      !["GET", "HEAD"].includes(req.method) &&
      !(req.method === "POST" && req.path === webhookPath) &&
      !(req.method === "POST" && req.path === "/ingest/heltec") &&
      (!req.headers.origin ||
        !(req.remoteOrigin ? origins : localOrigins).includes(
          req.headers.origin,
        ) ||
        (req.remoteOrigin &&
          req.headers.origin !== origin &&
          req.headers.origin !== proxyOrigin))
    )
      return res.status(403).json({ error: "Origen no autorizado." });
    const token = /(?:^|;\s*)yaku_session=([a-f0-9]{64})(?:;|$)/.exec(
      req.headers.cookie || "",
    )?.[1];
    const key = token ? digest(token) : null;
    const session = key ? sessions.get(key) : null;
    if (
      session &&
      session.expires > Date.now() &&
      session.remote === req.remoteOrigin &&
      session.origin === (origin || "local")
    )
      req.session = session;
    else if (key && (!session || session.expires <= Date.now()))
      sessions.delete(key);
    req.sessionKey = key;
    next();
  });
  const requireRole =
    (...roles) =>
    (req, res, next) => {
      if (!req.session)
        return res
          .status(401)
          .json({ error: "Inicia sesión para realizar esta acción." });
      if (!roles.includes(req.session.role))
        return res
          .status(403)
          .json({ error: "Tu usuario no tiene permiso para esta acción." });
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers["x-csrf-token"] !== req.session.csrf
      )
        return res.status(403).json({
          error: "Sesión o confirmación inválida. Vuelve a iniciar sesión.",
        });
      next();
    };
  app.get("/api/auth/me", (req, res) =>
    res.json({
      role: req.session?.role || "viewer",
      csrf: req.session?.csrf || null,
      configured: Object.keys(users()).length > 0,
    }),
  );
  app.post("/api/auth/login", (req, res) => {
    const key = req.remoteOrigin
      ? req.headers["cf-connecting-ip"] || "remote"
      : "local";
    const failure = failures.get(key);
    if (failure && failure.until > Date.now() && failure.count >= 8)
      return res
        .status(429)
        .json({ error: "Demasiados intentos. Espera 15 minutos." });
    const { username, password } = req.body || {};
    const entry =
      typeof username === "string" && Object.hasOwn(users(), username)
        ? users()[username]
        : null;
    if (!verifyPassword(password, entry)) {
      if (failures.size > 1000) failures.clear();
      failures.set(key, {
        count: failure?.until > Date.now() ? failure.count + 1 : 1,
        until: Date.now() + 900000,
      });
      return res
        .status(401)
        .json({ error: "Usuario o contraseña incorrectos." });
    }
    failures.delete(key);
    for (const [id, s] of sessions)
      if (s.expires < Date.now()) sessions.delete(id);
    if (sessions.size >= 200)
      return res.status(429).json({ error: "Límite de sesiones alcanzado." });
    if (req.sessionKey) sessions.delete(req.sessionKey);
    const token = crypto.randomBytes(32).toString("hex");
    const session = {
      role: entry.role,
      csrf: crypto.randomBytes(24).toString("hex"),
      expires: Date.now() + 8 * 3600000,
      remote: req.remoteOrigin,
      origin: req.remoteOrigin
        ? `https://${req.headers.host.toLowerCase()}`
        : "local",
    };
    sessions.set(digest(token), session);
    res.setHeader(
      "Set-Cookie",
      `yaku_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${req.remoteOrigin ? "; Secure" : ""}`,
    );
    res.json({ role: session.role, csrf: session.csrf });
  });
  app.post("/api/auth/logout", requireRole("admin", "operator"), (req, res) => {
    sessions.delete(req.sessionKey);
    res.setHeader(
      "Set-Cookie",
      `yaku_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${req.remoteOrigin ? "; Secure" : ""}`,
    );
    res.json({ ok: true });
  });
  return {
    admin: requireRole("admin"),
    sender: requireRole("admin", "operator"),
  };
}
