// /api/artist-thumbnails[?artist=NAME] — returns { artistId: pictureUrl }.
//
// Primary source: the statically deployed avatars.json (refreshed once per day by a
// VPS cron job) — instant, no per-request scraping. If avatars.json is missing, falls
// back to live scraping of streambox + Twitch (decapi.me) so the endpoint still works.
// Shaped like the original API: { "<id>": "https://..." }
import fs from "fs";
import path from "path";
const BASE = "https://starchive.streambox.space";

function staticAvatars() {
  try {
    const p = path.join(process.cwd(), "avatars.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    /* ignore */
  }
  return null;
}

function hiddenSet() {
  try {
    const p = path.join(process.cwd(), "hidden.json");
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      return new Set(d.hidden || []);
    }
  } catch (e) {}
  return new Set();
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "starchive-api/1.0" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}

async function artistIds() {
  const html = await fetchText(BASE + "/");
  const ids = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html))) {
    const href = /<a[^>]+href="([^"]+)"/i.exec(m[1])?.[1] || "";
    if (!href.endsWith("/")) continue;
    const id = decodeURIComponent(href.slice(0, -1).split("/").pop() || "");
    if (!id || id === "." || id === ".." || id === "thumbnails") continue;
    ids.push(id);
  }
  return ids;
}

async function streamboxNewest() {
  const html = await fetchText(BASE + "/thumbnails/");
  const newest = new Map();
  const re = /href="([^"]+_picture_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.jpg)"/g;
  let m;
  while ((m = re.exec(html))) {
    const fname = decodeURIComponent(m[1].split("/").pop() || "");
    const artist = fname.split("_picture_")[0];
    const ts = fname.split("_picture_")[1]?.replace(".jpg", "") || "";
    if (artist && ts && (!newest.has(artist) || ts > newest.get(artist))) {
      newest.set(artist, ts);
    }
  }
  return newest;
}

async function twitchAvatar(username) {
  try {
    const text = await fetchText(`https://decapi.me/twitch/avatar/${encodeURIComponent(username)}`);
    return text.startsWith("http") ? text.trim() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const want = req.query.artist ? req.query.artist.toString() : null;
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=86400");

  // Fast path: daily-refreshed static map.
  const cached = staticAvatars();
  if (cached) {
    const hide = hiddenSet();
    const filtered = {};
    for (const [k, v] of Object.entries(cached)) {
      if (!hide.has(k)) filtered[k] = v;
    }
    if (want) {
      return res.status(200).json({ url: filtered[want] || null, id: want });
    }
    return res.status(200).json(filtered);
  }

  // Fallback: live scrape (only when avatars.json is absent).
  try {
    const [allIds, streambox] = await Promise.all([artistIds(), streamboxNewest()]);
    const missing = allIds.filter((id) => !streambox.has(id));
    const out = {};
    for (const [artist, ts] of streambox) {
      if (!want || want === artist) out[artist] = `${BASE}/thumbnails/${artist}_picture_${ts}.jpg`;
    }
    await Promise.all(
      missing.filter((id) => !want || want === id).map(async (id) => {
        const av = await twitchAvatar(id);
        if (av) out[id] = av;
      })
    );
    if (want) return res.status(200).json({ url: out[want] || null, id: want });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: String(e && e.message || e) });
  }
}