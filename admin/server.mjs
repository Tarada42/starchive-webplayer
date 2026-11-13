// admin/server.mjs — admin Express app for port 8081.
// No admin route may exist on the public app (port 8080).
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import { createAuth } from "./auth.mjs";
import { verifyAccessJwt, createJwksFetcher } from "./access.mjs";
import artistsHandler from "../api/artists.js";
import liveHandler from "../api/live.js";
import { popularity, traffic, liveStats } from "./aggregate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function ndjsonPath(dataDir, subdir) {
  return path.join(dataDir, subdir, `${todayStr()}.ndjson`);
}

function readJsonLines(p) {
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, "utf8").trim();
  if (!text) return [];
  return text.split("\n").map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  });
}

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error("Failed to read JSON:", p, e.message);
    return fallback;
  }
}

function writeJsonAtomic(p, data) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

// Call a Vercel-style handler and capture its JSON response.
function callHandler(handler, req) {
  return new Promise((resolve) => {
    const chunks = [];
    const mockRes = {
      headersSent: false,
      statusCode: 200,
      status(n) {
        this.statusCode = n;
        return this;
      },
      setHeader() {
        return this;
      },
      json(data) {
        this.headersSent = true;
        resolve({ status: this.statusCode, data });
      },
      send(data) {
        this.headersSent = true;
        resolve({ status: this.statusCode, data });
      },
      end(data) {
        this.headersSent = true;
        resolve({ status: this.statusCode, data });
      },
      write(chunk) {
        chunks.push(Buffer.from(chunk));
      },
    };
    const result = handler(req, mockRes);
    if (result && typeof result.then === "function") {
      result.catch((e) => resolve({ status: 500, error: e.message }));
    }
  });
}

export function createAdminApp({ dataDir }) {
  const auth = createAuth({ dataDir });
  const app = express();

  const accessIssuerPath = path.join(dataDir, "access-issuer.json");
  let pinnedIssuer = readJsonSafe(accessIssuerPath, { issuer: null }).issuer;
  let pinPromise = null;
  const jwksFetcher = createJwksFetcher();
  const allowPasswordLogin = () => process.env.ALLOW_PASSWORD_LOGIN === "1";

  function rejectAccess(req, res) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "Cloudflare identity rejected" });
    }
    return res.status(403).type("text/plain").send("Cloudflare identity rejected");
  }

  function ensureAccessSession(req, res) {
    if (!req.accessEmail) return;
    let s = auth.getSession(req);
    if (!s) {
      const created = auth.createSession(req.accessEmail);
      res.cookie("sid", created.cookieValue, auth.cookieOptions(req));
      // res.cookie only queues the header, so req.cookies still holds the old
      // (absent) value on this request — use the session we just created.
      s = created.session;
    } else if (s.user !== req.accessEmail) {
      s.user = req.accessEmail;
    }
    req.session = s;
  }

  function requireAccessOrSession(req, res, next) {
    auth.sweepSessions();

    if (req.accessEmail) {
      ensureAccessSession(req, res);
      return next();
    }

    if (allowPasswordLogin()) {
      const s = auth.getSession(req);
      if (s) {
        req.session = s;
        return next();
      }
    }

    return rejectAccess(req, res);
  }

  app.use((_req, res, next) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
    next();
  });

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: "2kb" }));

  // Cookie parser (minimal).
  app.use((req, _res, next) => {
    req.cookies = {};
    const cookie = req.headers.cookie;
    if (cookie) {
      for (const part of cookie.split(";")) {
        const [k, ...v] = part.trim().split("=");
        if (k) {
          const raw = v.join("=");
          try {
            req.cookies[k] = decodeURIComponent(raw);
          } catch {
            req.cookies[k] = raw; // malformed percent-encoding must not throw
          }
        }
      }
    }
    next();
  });

  // Cloudflare Access JWT verification.
  app.use(async (req, res, next) => {
    const token = req.headers["cf-access-jwt-assertion"];
    if (!token) return next();

    try {
      const result = await verifyAccessJwt(token, { jwksFetcher });
      if (!result) return rejectAccess(req, res);

      if (pinnedIssuer && result.iss !== pinnedIssuer) return rejectAccess(req, res);

      if (!pinnedIssuer) {
        // Serialise the first pin so two concurrent requests with different (both
        // valid-looking) issuers cannot race and leave the loser's issuer pinned.
        if (!pinPromise) {
          pinPromise = Promise.resolve().then(() => {
            if (pinnedIssuer) return;
            pinnedIssuer = result.iss;
            writeJsonAtomic(accessIssuerPath, { issuer: pinnedIssuer });
          });
        }
        await pinPromise;
        if (pinnedIssuer !== result.iss) return rejectAccess(req, res);
      }

      req.accessEmail = result.email;
      next();
    } catch {
      return rejectAccess(req, res);
    }
  });

  // Auto-provision a signed session from a verified Cloudflare identity.
  app.use((req, res, next) => {
    ensureAccessSession(req, res);
    next();
  });

  // Request logging.
  app.use((req, _res, next) => {
    console.log(`[admin ${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // Static assets for the admin SPA.
  app.get("/assets/admin.css", (_req, res) =>
    res.sendFile(path.join(__dirname, "admin.css"))
  );
  app.get("/assets/admin.js", (_req, res) =>
    res.sendFile(path.join(__dirname, "app.js"))
  );

  // Login page (GET) — served by the SPA shell.
  app.get("/login", (_req, res) =>
    res.sendFile(path.join(__dirname, "index.html"))
  );

  // Public auth endpoints.
  app.post("/login", async (req, res) => {
    if (!allowPasswordLogin()) {
      return res.status(403).json({ error: "Password login is disabled" });
    }
    const { user, password } = req.body || {};
    if (typeof user !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Invalid credentials" });
    }
    const ip = auth.getIp?.(req) || "unknown";
    const result = await auth.attemptLogin(user, password, ip);
    if (result.blocked) {
      return res.status(429).json({ error: "Too many login attempts. Try again later." });
    }
    if (!result.ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    res.cookie("sid", result.cookieValue, auth.cookieOptions(req));
    return res.redirect("/");
  });

  // All remaining routes require Cloudflare Access or a password session.
  app.use(requireAccessOrSession);

  app.get("/api/admin/me", (req, res) => {
    if (!req.session) return res.status(401).json({ error: "Unauthorized" });
    res.status(200).json({
      user: req.session.user,
      csrf: req.session.csrf,
      passwordLogin: allowPasswordLogin(),
    });
  });

  app.post("/logout", auth.requireCsrf, (req, res) => {
    auth.logout(req.session.sid);
    res.clearCookie("sid", auth.cookieOptions(req));
    return res.redirect("/login");
  });

  app.get("/api/admin/overview", async (_req, res) => {
    try {
      const [artistsRes, liveRes] = await Promise.all([
        callHandler(artistsHandler, { method: "GET", url: "/api/artists" }),
        callHandler(liveHandler, { method: "GET", url: "/api/live" }),
      ]);

      const artists = Array.isArray(artistsRes.data) ? artistsRes.data.length : 0;
      const liveDjs = Array.isArray(liveRes.data)
        ? liveRes.data.map((d) => d.displayName || d.name || d.id)
        : [];

      const eventsPath = ndjsonPath(dataDir, "events");
      const eventsToday = { play: 0, favorite: 0, live_play: 0, page: 0 };
      if (fs.existsSync(eventsPath)) {
        for (const ev of readJsonLines(eventsPath)) {
          if (ev && eventsToday[ev.type] !== undefined) {
            eventsToday[ev.type] += 1;
          }
        }
      }

      const metricsPath = ndjsonPath(dataDir, "metrics");
      let bytesToday = 0;
      if (fs.existsSync(metricsPath)) {
        for (const row of readJsonLines(metricsPath)) {
          if (row && typeof row.bytes === "number") {
            bytesToday += row.bytes;
          }
        }
      }

      res.status(200).json({
        artists,
        liveNow: liveDjs.length,
        liveDJs: liveDjs,
        eventsToday,
        bytesToday,
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("GET /api/admin/overview failed:", e);
      res.status(500).json({ error: "Failed to build overview" });
    }
  });

  function parseDays(req) {
    const raw = req.query?.days;
    if (raw === undefined || raw === "") return 7;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || Number.isNaN(n)) return 7;
    if (n < 1) return 1;
    if (n > 90) return 90;
    return n;
  }

  app.get("/api/admin/popularity", (req, res) => {
    try {
      const days = parseDays(req);
      res.status(200).json(popularity(dataDir, days));
    } catch (e) {
      console.error("GET /api/admin/popularity failed:", e);
      res.status(500).json({ error: "Failed to load popularity" });
    }
  });

  app.get("/api/admin/traffic", (req, res) => {
    try {
      const days = parseDays(req);
      res.status(200).json(traffic(dataDir, days));
    } catch (e) {
      console.error("GET /api/admin/traffic failed:", e);
      res.status(500).json({ error: "Failed to load traffic" });
    }
  });

  app.get("/api/admin/live", (req, res) => {
    try {
      const days = parseDays(req);
      res.status(200).json(liveStats(dataDir, days));
    } catch (e) {
      console.error("GET /api/admin/live failed:", e);
      res.status(500).json({ error: "Failed to load live stats" });
    }
  });

  // SPA shell for / and /admin*.
  app.get(["/", "/admin*"], (_req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
  });

  // Catch-all.
  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(path.join(__dirname, "index.html"));
  });

  return app;
}
