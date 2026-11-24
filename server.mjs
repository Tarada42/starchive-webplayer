// STArchive webapp-copy self-hosted server (replaces Vercel).
// Serves static files + mounts the three api handlers as Express routes.
// Was: Vercel serverless. Now: one Node process, no Vercel dependency.
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import artists from "./api/artists.js";
import tracks from "./api/tracks.js";
import thumbnails from "./api/artist-thumbnails.js";
import live from "./api/live.js";
import djProfile from "./api/dj-profile.js";
import { createAdminApp } from "./admin/server.mjs";
import { genresBasePath, mergeGenres, overridesPathFor, readOverrides } from "./admin/genres.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const ADMIN_PORT = process.env.ADMIN_PORT;
const DATA_DIR = process.env.DJ_SOCIALS_PATH
  ? path.dirname(path.resolve(process.env.DJ_SOCIALS_PATH))
  : path.join(__dirname, "data");
const app = express();

app.use(express.json());
app.use((req, _res, next) => {
  const t = new Date().toISOString();
  console.log(`[${t}] ${req.method} ${req.originalUrl}`);
  next();
});

// Genres: the generated Twitch-tag file with the admin's manual overrides applied.
// Must be declared before express.static, which would otherwise serve the raw file.
app.get("/genres.json", (_req, res) => {
  try {
    const base = JSON.parse(fs.readFileSync(genresBasePath(__dirname), "utf8"));
    const overrides = readOverrides(overridesPathFor(DATA_DIR));
    res.setHeader("Cache-Control", "no-cache");
    res.status(200).json(mergeGenres(base, overrides));
  } catch (e) {
    console.error("GET /genres.json failed:", e);
    res.status(500).json({ artists: {} });
  }
});

// Static files
// The admin app lives in admin/ and must ONLY be served by the separate admin
// listener (ADMIN_PORT). Block it on the public port before the static handler.
app.use((req, res, next) => {
  let p = req.path;
  try {
    p = decodeURIComponent(p);
  } catch (e) {
    return res.status(400).type("text/plain").send("Bad request");
  }
  p = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").toLowerCase();
  const isAdminUi = p === "/admin" || p.startsWith("/admin/") || /^\/assets\/admin\.(js|css)$/.test(p);
  if (isAdminUi) return res.status(404).type("text/plain").send("Not found");
  next();
});

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
    // FIREFOX COMPATIBILITY - DO NOT "IMPROVE" THESE HEADERS.
    // Verified working in Firefox, Edge and Chrome. Adding any of the following broke
    // playback in at least one of them:
    //   - ICY framing (icy-metaint + metadata blocks): jitter in Chromium, and the upstream
    //     advertises icy-metaint but sends no metadata, so synthesised framing is fragile.
    //   - Accept-Ranges: none / Cache-Control: no-store / Pragma / Expires: media elements
    //     stopped decoding entirely (readyState 0).
    // Keep it plain: audio/mpeg + no-cache + X-Accel-Buffering: no.
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

// Admin listener on its own port (loopback-published only in production).
if (ADMIN_PORT) {
  const adminApp = createAdminApp({ dataDir: DATA_DIR });
  adminApp.listen(Number(ADMIN_PORT), "0.0.0.0", () => {
    console.log(`STArchive admin serving on :${ADMIN_PORT}`);
  });
}
