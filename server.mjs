// STArchive webapp-copy self-hosted server (replaces Vercel).
// Serves static files + mounts the three api handlers as Express routes.
// Was: Vercel serverless. Now: one Node process, no Vercel dependency.
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import artists from "./api/artists.js";
import tracks from "./api/tracks.js";
import thumbnails from "./api/artist-thumbnails.js";
import live from "./api/live.js";
import djProfile, { ALLOWED_SOCIAL_KEYS } from "./api/dj-profile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const app = express();

// JSON + basic logging
app.use(express.json());
app.use((req, _res, next) => {
  const t = new Date().toISOString();
  console.log(`[${t}] ${req.method} ${req.originalUrl}`);
  next();
});

// Admin routes for DJ socials editor (auth + rate-limiting handled by proxy).
// These must be defined before the SPA fallback and static catch-all.

function repoSocialsPath() {
  return path.join(process.cwd(), "dj-socials.json");
}

function writableSocialsPath() {
  return process.env.DJ_SOCIALS_PATH
    ? path.resolve(process.env.DJ_SOCIALS_PATH)
    : repoSocialsPath();
}

function readSocialsPath() {
  const writable = writableSocialsPath();
  if (fs.existsSync(writable)) return writable;
  return repoSocialsPath();
}

function readSocials() {
  const p = readSocialsPath();
  try {
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error("Failed to read socials file:", e);
    return {};
  }
}

function writeSocials(data) {
  const target = writableSocialsPath();
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
}

function isValidAdminUsername(u) {
  return typeof u === "string" && /^[a-zA-Z0-9_]+$/.test(u);
}

function sanitizeAdminSocials(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED_SOCIAL_KEYS.has(k)) continue;
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    if (!/^https?:\/\//.test(trimmed)) continue;
    out[k] = trimmed;
  }
  return out;
}

app.get("/coliflower/socials", (_req, res) => {
  try {
    const all = readSocials();
    const out = {};
    for (const [username, entry] of Object.entries(all)) {
      if (!entry || typeof entry !== "object") continue;
      const clean = {};
      for (const [k, v] of Object.entries(entry)) {
        if (ALLOWED_SOCIAL_KEYS.has(k) && typeof v === "string") {
          clean[k] = v;
        }
      }
      out[username] = clean;
    }
    res.status(200).json({ djs: out });
  } catch (e) {
    console.error("GET /coliflower/socials failed:", e);
    res.status(500).json({ error: "Failed to load socials" });
  }
});

app.post("/coliflower/socials", (req, res) => {
  try {
    const { username, socials } = req.body || {};
    if (!isValidAdminUsername(username)) {
      return res.status(400).json({ error: "Invalid username" });
    }
    const dj = username.toLowerCase();
    const cleaned = sanitizeAdminSocials(socials);
    const all = readSocials();
    all[dj] = cleaned;
    writeSocials(all);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("POST /coliflower/socials failed:", e);
    res.status(500).json({ error: "Failed to save" });
  }
});

app.post("/coliflower/socials/delete", (req, res) => {
  try {
    const { username } = req.body || {};
    if (!isValidAdminUsername(username)) {
      return res.status(400).json({ error: "Invalid username" });
    }
    const dj = username.toLowerCase();
    const all = readSocials();
    if (!(dj in all)) {
      return res.status(400).json({ error: "DJ not found" });
    }
    delete all[dj];
    writeSocials(all);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("POST /coliflower/socials/delete failed:", e);
    res.status(500).json({ error: "Failed to save" });
  }
});

app.get("/coliflower", (_req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Static files
app.use(express.static(__dirname, { index: "index.html" }));

// API routes (Express adapter for the Vercel-style handlers)
app.get("/api/artists", (req, res) => artists(req, res));
app.get("/api/tracks", (req, res) => tracks(req, res));
app.get("/api/artist-thumbnails", (req, res) => thumbnails(req, res));
app.get("/api/live", (req, res) => live(req, res));
app.get("/api/dj-profile", (req, res) => djProfile(req, res));

// Dedicated /live page (also reachable via /live.html served by express.static)
app.get("/live", (_req, res) => res.sendFile(path.join(__dirname, "live.html")));

// Streaming proxy: /stream/:dj -> live.streambox.space/<dj>_hq (HQ MP3).
// Native <audio> cannot reliably play unlimited Icecast streams directly (browser
// treats the endless chunked MP3 as a finite file and stops after its buffer cycle,
// ~30-40s, especially with interleaved icy-metadata). Piping through Express makes it
// a clean, infinite audio/mpeg stream the browser plays indefinitely. Traffic rides
// the site's own bandwidth (user has 8 TB/mo headroom).
// Serve a one-line m3u with the proper media content-type so the OS opens it in
// the user's local media player (e.g. VLC) instead of a download prompt. Points at
// the direct HQ stream on the Icecast host so playback does NOT ride this proxy.
app.get("/stream/:dj.m3u", (req, res) => {
  const dj = String(req.params.dj || "").replace(/[^A-Za-z0-9_]/g, "");
  if (!dj) return res.status(400).send("missing dj");
  const href = `https://live.streambox.space/${dj}_hq`;
  res.status(200);
  res.setHeader("Content-Type", "audio/x-mpegurl");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "no-cache");
  res.end(href + "\n");
});

app.get("/stream/:dj", async (req, res) => {
  const dj = String(req.params.dj || "").replace(/[^A-Za-z0-9_]/g, "");
  if (!dj) return res.status(400).send("missing dj");
  const up = `https://live.streambox.space/${dj}_hq`;
  let upstream;
  let ctrl;
  try {
    ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30_000); // drop a dead upstream
    upstream = await fetch(up, {
      headers: { "User-Agent": "STArchive-Web/1.0", "Accept": "audio/mpeg" },
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!upstream.ok) return res.status(502).send("upstream " + upstream.status);

    res.status(200);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Explicitly pump the upstream body through; proving-viable reader pattern.
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    res.end();
  } catch (e) {
    try {
      if (!res.headersSent) res.status(502).send("proxy error");
      else res.destroy();
    } catch {}
  } finally {
    if (ctrl) { try { ctrl.abort(); } catch {} }
  }
});

// SPA fallback -> index.html for non-API GETs
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

// Injected server-binding override so the api handlers find hidden.json/avatars.json
// in the project root regardless of Node's cwd (they use process.cwd()).
process.chdir(__dirname);

app.listen(PORT, () => {
  console.log(`STArchive webapp-copy serving on :${PORT} (cwd=${process.cwd()})`);
});