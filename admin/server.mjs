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
import {
  isValidDjId,
  mergeDjList,
  declinesPathFor,
  mergeEditedSocials,
  normalizeDjId,
  readJsonObject,
  readSocialsFile,
  sanitizeSocials,
  socialsPathFor,
  suggestionFor,
  suggestionsPathFor,
  withSocialsLock,
  writeSocialsFile,
} from "./socials.mjs";
import {
  genreVocabulary,
  genresBasePath,
  isValidGenreName,
  mergeGenres,
  overridesPathFor,
  sanitizeGenres,
  withGenresLock,
  writeOverrides,
  readJsonSafe as readJsonSafeGenres,
} from "./genres.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Social keys an admin may reject individually (mirrors the editor's fields). */
const ALLOWED_GENRE_SAFE_KEYS = new Set([
  "twitch",
  "website",
  "x",
  "twitter",
  "instagram",
  "youtube",
  "soundcloud",
  "mixcloud",
  "discord",
  "tiktok",
]);

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
  // Admin assets change with every deploy and are only reachable behind the tunnel,
  // so never let a browser serve a stale copy of the SPA.
  const noStore = { "Cache-Control": "no-store, must-revalidate" };
  app.get("/assets/admin.css", (_req, res) =>
    res.sendFile(path.join(__dirname, "admin.css"), { headers: noStore })
  );
  app.get("/assets/admin.js", (_req, res) =>
    res.sendFile(path.join(__dirname, "app.js"), { headers: noStore })
  );

  // The SPA shell must never be cached either: a stale HTML file paired with a fresh
  // admin.js is exactly how a deploy silently fails to appear.
  const noStoreHtml = { "Cache-Control": "no-store, must-revalidate" };
  app.get("/login", (_req, res) =>
    res.sendFile(path.join(__dirname, "index.html"), { headers: noStoreHtml })
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

      res.status(200).json({
        artists,
        liveNow: liveDjs.length,
        liveDJs: liveDjs,
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("GET /api/admin/overview failed:", e);
      res.status(500).json({ error: "Failed to build overview" });
    }
  });

  // ---- Content: DJ social links -------------------------------------------------
  // Writes go to the data volume (dj-socials.json), which the public
  // /api/dj-profile endpoint reads. Every change is attributed in the log.
  const socialsFile = socialsPathFor(dataDir);
  const declinesFile = declinesPathFor(dataDir);
  const genresBaseFile = genresBasePath(path.join(__dirname, ".."));
  const overridesFile = overridesPathFor(dataDir);
  const suggestionsFile = suggestionsPathFor(path.join(__dirname, ".."));

  function auditActor(req) {
    const user = req.session?.user;
    if (typeof user === "string") return user;
    return user?.email || req.accessEmail || "unknown";
  }

  function audit(req, action, target) {
    console.log(`[admin audit] ${new Date().toISOString()} ${auditActor(req)} ${action} ${target}`);
  }

  app.get("/api/admin/content/djs", async (_req, res) => {
    try {
      const artistsRes = await callHandler(artistsHandler, { method: "GET", url: "/api/artists" });
      const artists = Array.isArray(artistsRes.data) ? artistsRes.data : [];
      const stored = readSocialsFile(socialsFile);
      const suggestions = readJsonObject(suggestionsFile);
      const declined = readJsonObject(declinesFile);
      const djs = mergeDjList(artists, stored).map((row) => ({
        ...row,
        suggestion: suggestionFor(row.id, row.socials, suggestions, declined),
      }));
      res.status(200).json({ djs });
    } catch (e) {
      console.error("GET /api/admin/content/djs failed:", e);
      res.status(500).json({ error: "Failed to load DJs" });
    }
  });

  app.post("/api/admin/content/socials", auth.requireCsrf, async (req, res) => {
    const dj = normalizeDjId(req.body?.dj);
    if (!isValidDjId(dj)) return res.status(400).json({ error: "Invalid DJ id" });
    const socials = sanitizeSocials(req.body?.socials);

    try {
      const saved = await withSocialsLock(() => {
        const all = readSocialsFile(socialsFile);
        const merged = mergeEditedSocials(all[dj], socials);
        if (Object.keys(merged).length === 0) {
          delete all[dj];
        } else {
          all[dj] = merged;
        }
        writeSocialsFile(socialsFile, all);
        return merged;
      });
      audit(req, "socials.save", dj);
      return res.status(200).json({ ok: true, dj, socials: saved });
    } catch (e) {
      console.error("POST /api/admin/content/socials failed:", e);
      return res.status(500).json({ error: "Failed to save socials" });
    }
  });

  app.post("/api/admin/content/socials/delete", auth.requireCsrf, async (req, res) => {
    const dj = normalizeDjId(req.body?.dj);
    if (!isValidDjId(dj)) return res.status(400).json({ error: "Invalid DJ id" });

    try {
      const existed = await withSocialsLock(() => {
        const all = readSocialsFile(socialsFile);
        if (!(dj in all)) return false;
        delete all[dj];
        writeSocialsFile(socialsFile, all);
        return true;
      });
      if (!existed) return res.status(404).json({ error: "No links stored for that DJ" });
      audit(req, "socials.delete", dj);
      return res.status(200).json({ ok: true, dj });
    } catch (e) {
      console.error("POST /api/admin/content/socials/delete failed:", e);
      return res.status(500).json({ error: "Failed to delete socials" });
    }
  });

  app.post("/api/admin/content/suggestions/decline", auth.requireCsrf, async (req, res) => {
    const dj = normalizeDjId(req.body?.dj);
    if (!isValidDjId(dj)) return res.status(400).json({ error: "Invalid DJ id" });

    // keys = reject just those links; absent = reject the whole DJ's suggestion.
    const rawKeys = req.body?.keys;
    let keys = null;
    if (rawKeys !== undefined) {
      if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
        return res.status(400).json({ error: "keys must be a non-empty list" });
      }
      if (rawKeys.some((k) => !ALLOWED_GENRE_SAFE_KEYS.has(k))) {
        return res.status(400).json({ error: "Invalid social key" });
      }
      keys = rawKeys;
    }

    try {
      await withSocialsLock(() => {
        const declined = readJsonObject(declinesFile);
        const now = new Date().toISOString();
        if (!keys) {
          declined[dj] = { declinedAt: now, by: auditActor(req) };
        } else {
          const entry = declined[dj] && typeof declined[dj] === "object" ? declined[dj] : {};
          if (!entry.keys || typeof entry.keys !== "object") entry.keys = {};
          for (const key of keys) entry.keys[key] = now;
          entry.declinedAt = now;
          entry.by = auditActor(req);
          declined[dj] = entry;
        }
        writeSocialsFile(declinesFile, declined);
      });
      audit(req, "suggestion.decline", keys ? `${dj} [${keys.join(", ")}]` : dj);
      return res.status(200).json({ ok: true, dj, keys });
    } catch (e) {
      console.error("POST /api/admin/content/suggestions/decline failed:", e);
      return res.status(500).json({ error: "Failed to decline suggestion" });
    }
  });


  // ---- Content: genres ----------------------------------------------------------
  // Overrides live on the data volume; the public /genres.json endpoint merges them
  // over the auto-detected tags at request time.
  function currentGenresBase() {
    return readJsonSafeGenres(genresBaseFile, { artists: {} });
  }

  app.get("/api/admin/content/genres", async (_req, res) => {
    try {
      const base = currentGenresBase();
      const overrides = readJsonSafeGenres(overridesFile, {});
      const merged = mergeGenres(base, overrides).artists || {};
      const artistsRes = await callHandler(artistsHandler, { method: "GET", url: "/api/artists" });
      const artists = Array.isArray(artistsRes.data) ? artistsRes.data : [];

      const rows = artists
        .map((a) => {
          const id = normalizeDjId(a.id);
          const entry = merged[id] || {};
          return {
            id,
            name: a.displayName || a.name || id,
            genres: Array.isArray(entry.genres) ? entry.genres : [],
            source: entry.source || "none",
            tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 12) : [],
          };
        })
        .filter((r) => isValidDjId(r.id))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.status(200).json({ djs: rows, vocabulary: genreVocabulary(base, overrides) });
    } catch (e) {
      console.error("GET /api/admin/content/genres failed:", e);
      res.status(500).json({ error: "Failed to load genres" });
    }
  });

  app.post("/api/admin/content/genres", auth.requireCsrf, async (req, res) => {
    const dj = normalizeDjId(req.body?.dj);
    if (!isValidDjId(dj)) return res.status(400).json({ error: "Invalid DJ id" });

    const raw = req.body?.genres;
    if (!Array.isArray(raw)) return res.status(400).json({ error: "genres must be a list" });
    if (raw.some((g) => !isValidGenreName(g))) {
      return res.status(400).json({ error: "Invalid genre name" });
    }
    const genres = sanitizeGenres(raw);
    if (!genres.length) {
      return res.status(400).json({ error: "Keep at least one genre, or use Clear" });
    }

    try {
      await withGenresLock(() => {
        const stored = readJsonSafeGenres(overridesFile, { overrides: {} });
        const overrides = stored.overrides && typeof stored.overrides === "object" ? stored.overrides : {};
        overrides[dj] = { genres, updatedAt: new Date().toISOString(), by: auditActor(req) };
        writeOverrides(overridesFile, overrides);
      });
      audit(req, "genres.save", `${dj} (${genres.join(", ")})`);
      return res.status(200).json({ ok: true, dj, genres });
    } catch (e) {
      console.error("POST /api/admin/content/genres failed:", e);
      return res.status(500).json({ error: "Failed to save genres" });
    }
  });

  app.post("/api/admin/content/genres/clear", auth.requireCsrf, async (req, res) => {
    const dj = normalizeDjId(req.body?.dj);
    if (!isValidDjId(dj)) return res.status(400).json({ error: "Invalid DJ id" });

    try {
      const existed = await withGenresLock(() => {
        const stored = readJsonSafeGenres(overridesFile, { overrides: {} });
        const overrides = stored.overrides && typeof stored.overrides === "object" ? stored.overrides : {};
        if (!(dj in overrides)) return false;
        delete overrides[dj];
        writeOverrides(overridesFile, overrides);
        return true;
      });
      if (!existed) return res.status(404).json({ error: "No manual genres for that DJ" });
      audit(req, "genres.clear", dj);
      return res.status(200).json({ ok: true, dj });
    } catch (e) {
      console.error("POST /api/admin/content/genres/clear failed:", e);
      return res.status(500).json({ error: "Failed to clear genres" });
    }
  });

  // SPA shell for / and /admin*.
  app.get(["/", "/admin*"], (_req, res) => {
    res.sendFile(path.join(__dirname, "index.html"), { headers: noStoreHtml });
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
