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
import djProfile from "./api/dj-profile.js";
import { createAdminApp } from "./admin/server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const ADMIN_PORT = process.env.ADMIN_PORT;
const DATA_DIR = process.env.DJ_SOCIALS_PATH
  ? path.dirname(path.resolve(process.env.DJ_SOCIALS_PATH))
  : path.join(__dirname, "data");
const app = express();

// Metrics aggregation: {minute, kind, bytes, count}
const metrics = new Map();
const METRICS_FLUSH_MS = 60_000;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getKind(req) {
  const p = req.path || "";
  if (p.startsWith("/api/")) return "api";
  if (p.startsWith("/stream/")) return "stream";
  if (req.method === "GET" && /\/[^/]+\.[^/]+$/.test(p)) return "static";
  return "page";
}

function recordMetric(kind, bytes) {
  if (!bytes || bytes <= 0) return;
  const minute = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
  const key = `${minute}:${kind}`;
  const entry = metrics.get(key);
  if (entry) {
    entry.bytes += bytes;
    entry.count += 1;
  } else {
    metrics.set(key, { minute, kind, bytes, count: 1 });
  }
}

function flushMetrics() {
  if (metrics.size === 0) return;
  const dir = path.join(DATA_DIR, "metrics");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${todayStr()}.ndjson`);
  const lines = [];
  for (const entry of metrics.values()) {
    lines.push(JSON.stringify(entry));
  }
  fs.appendFileSync(file, lines.join("\n") + "\n");
  metrics.clear();
}

setInterval(flushMetrics, METRICS_FLUSH_MS);
process.on("SIGTERM", flushMetrics);

// Listener sampler: fetch Icecast status every 60 s (and once ~15 s after boot).
const ICECAST_STATUS_URL = "https://live.streambox.space/";
const LISTENER_SAMPLE_INTERVAL_MS = 60_000;
const LISTENER_SAMPLE_BOOT_DELAY_MS = 15_000;

function readLiveExcluded() {
  try {
    const p = path.join(__dirname, "live-excluded.json");
    if (!fs.existsSync(p)) return new Set();
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return new Set((data.excluded || []).map((s) => String(s).toLowerCase()));
  } catch {
    return new Set();
  }
}

function parseListenerSamples(html) {
  const excluded = readLiveExcluded();
  const mounts = new Map(); // base mount -> max listener count
  const parts = html.split(/Mountpoint/i);
  for (let i = 1; i < parts.length; i += 1) {
    const section = parts[i];
    const mpMatch = section.match(/<code>\s*\/([^<]+)\s*<\/code>/i);
    // The count sits in the next table cell: "Listeners (current):</td><td>3</td>"
    const listenerMatch = section.match(/Listeners\s*\(current\):\s*<\/td>\s*<td[^>]*>\s*(\d+)/i);
    if (!mpMatch || !listenerMatch) continue;
    let id = mpMatch[1].trim();
    id = id.replace(/_hq$/i, "");
    const count = parseInt(listenerMatch[1], 10);
    if (Number.isNaN(count)) continue;
    const base = id.toLowerCase();
    if (excluded.has(base)) continue;
    mounts.set(base, Math.max(mounts.get(base) || 0, count));
  }
  const result = {};
  let total = 0;
  for (const [id, count] of mounts) {
    result[id] = count;
    total += count;
  }
  return { total, mounts: result };
}

async function sampleListeners() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(ICECAST_STATUS_URL, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return;
    const html = await res.text();
    const sample = parseListenerSamples(html);
    const dir = path.join(DATA_DIR, "metrics");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `listeners-${todayStr()}.ndjson`);
    fs.appendFileSync(
      file,
      JSON.stringify({ ts: new Date().toISOString(), total: sample.total, mounts: sample.mounts }) + "\n"
    );
  } catch {
    // Skip silently on fetch or parse failure.
  }
}

setTimeout(sampleListeners, LISTENER_SAMPLE_BOOT_DELAY_MS);
setInterval(sampleListeners, LISTENER_SAMPLE_INTERVAL_MS);

// Byte-counting middleware: count every byte written by the response.
// Does not buffer; safe for the long-lived /stream proxy.
app.use((req, res, next) => {
  const kind = getKind(req);
  let contentLength = null;
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  const origSetHeader = res.setHeader.bind(res);

  res.setHeader = (name, value) => {
    if (String(name).toLowerCase() === "content-length") {
      const n = Number(value);
      if (Number.isFinite(n)) contentLength = n;
    }
    return origSetHeader(name, value);
  };

  let wrote = false;
  res.write = function (chunk, encoding, callback) {
    if (typeof encoding === "function") { callback = encoding; encoding = undefined; }
    if (chunk) {
      wrote = true;
      recordMetric(kind, Buffer.byteLength(chunk, encoding));
    }
    return origWrite(chunk, encoding, callback);
  };

  res.end = function (chunk, encoding, callback) {
    if (typeof chunk === "function") { callback = chunk; chunk = undefined; }
    if (typeof encoding === "function") { callback = encoding; encoding = undefined; }
    if (chunk) {
      wrote = true;
      recordMetric(kind, Buffer.byteLength(chunk, encoding));
    } else if (!wrote && contentLength !== null) {
      recordMetric(kind, contentLength);
    }
    return origEnd(chunk, encoding, callback);
  };

  next();
});

// JSON + basic logging. /api/events is parsed by its own 2 kB parser below, so the
// global (100 kB) parser skips it — otherwise the small cap never applies.
const globalJson = express.json();
app.use((req, res, next) => {
  // Mirror Express routing (case-insensitive, optional trailing slash) so no variant
  // reaches the global 100 kB parser before the route's own 2 kB one.
  const p = req.path.toLowerCase().replace(/\/+$/, "");
  if (p === "/api/events") return next();
  return globalJson(req, res, next);
});
app.use((req, _res, next) => {
  const t = new Date().toISOString();
  console.log(`[${t}] ${req.method} ${req.originalUrl}`);
  next();
});

// Event ingestion endpoint (public, unauthenticated, rate-limited).
const eventLimiters = new Map(); // ip -> { count, resetAt }

function sanitizeEventString(s) {
  if (s == null) return "";
  const t = String(s).slice(0, 100);
  return t.replace(/[^a-zA-Z0-9_\-./]/g, "");
}

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function checkEventRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const record = eventLimiters.get(ip);
  if (record && now > record.resetAt) {
    eventLimiters.delete(ip);
  }
  const current = eventLimiters.get(ip) || { count: 0, resetAt: now + windowMs };
  if (current.count >= 60) return false;
  current.count += 1;
  eventLimiters.set(ip, current);
  return true;
}

app.post(
  "/api/events",
  express.json({ limit: "2kb" }),
  (req, res) => {
    const ip = getClientIp(req);
    if (!checkEventRateLimit(ip)) {
      return res.status(429).json({ error: "Rate limit exceeded" });
    }

    const body = req.body || {};
    const allowedTypes = new Set(["play", "favorite", "unfavorite", "live_play", "page", "stream_stall"]);
    const type = allowedTypes.has(body.type) ? body.type : null;
    if (!type) {
      return res.status(400).json({ error: "Invalid event type" });
    }

    const event = {
      type,
      artist: sanitizeEventString(body.artist),
      track: sanitizeEventString(body.track),
      sid: sanitizeEventString(body.sid),
      ts: new Date().toISOString(),
    };

    const dir = path.join(DATA_DIR, "events");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${todayStr()}.ndjson`);
    fs.appendFileSync(file, JSON.stringify(event) + "\n");

    return res.status(204).end();
  }
);

// Admin routes for DJ socials editor (auth + rate-limiting handled by proxy).
// These must be defined before the SPA fallback and static catch-all.


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
