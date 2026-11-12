// /api/tracks?artist=NAME — scrapes one artist folder on streambox, shaped like the
// original 66ejzz.vercel.app API: [{ id, artist, filename, title, url, thumbnailUrl,
//   pictureUrl, size, date, index }] sorted newest-first by filename timestamp.
const BASE = "https://starchive.streambox.space";
import fs from "fs";
import path from "path";

function isHidden(artistId) {
  try {
    const p = path.join(process.cwd(), "hidden.json");
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      return (d.hidden || []).includes(artistId);
    }
  } catch (e) {}
  return false;
}

function prettySize(bytes) {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KiB", "MiB", "GiB"];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

function titleFromName(name) {
  // e.g. dj_td_2026-06-17-20-54.mp4 -> "Jun 17, 2026 \u2014 20:54"
  const m = /(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/.exec(name);
  if (!m) return name.replace(/_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(?:\.mp4)?$/i, "").replace(/_/g, " ");
  const [, y, mo, d, hh, mi] = m.map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[mo-1]} ${d}, ${y} \u2014 ${String(hh).padStart(2,"0")}:${String(mi).padStart(2,"0")}`;
}

function dateField(name) {
  const m = /(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/.exec(name);
  if (!m) return "";
  const [, y, mo, d, hh, mi] = m.map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d).padStart(2,"0")}-${months[mo-1]}-${y} ${String(hh).padStart(2,"0")}:${String(mi).padStart(2,"0")}`;
}

/**
 * Is this artist streaming right now? Same signal /api/live uses: the Icecast
 * status page lists one mount per live DJ (plus an _hq variant).
 */
async function isArtistLive(artist) {
  try {
    const r = await fetch("https://live.streambox.space/", {
      headers: { "User-Agent": "starchive-api/1.0" },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return false;
    const html = await r.text();
    const mounts = [...html.matchAll(/Mountpoint\s*<code>\/([^<]+)<\/code>/gi)].map((m) => m[1].toLowerCase());
    const target = artist.toLowerCase();
    return mounts.some((m) => m === target || m === target + "_hq");
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  const artist = (req.query.artist || "").toString();
  if (!artist) return res.status(400).json({ error: "artist required" });
  if (isHidden(artist)) return res.status(200).json([]);
  try {
    const r = await fetch(`${BASE}/${encodeURIComponent(artist)}/`, { headers: { "User-Agent": "starchive-api/1.0" } });
    const html = await r.text();
    const tracks = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    let idx = 0;
    while ((m = rowRe.exec(html))) {
      const row = m[1];
      const href = /<a[^>]+href="([^"]+)"/i.exec(row)?.[1] || "";
      if (!href.endsWith(".mp4")) continue;
      const filename = decodeURIComponent(href.split("/").pop() || "");
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
        c[1].replace(/<[^>]+>/g, "").trim()
      );
      const ts = /(\d{4}-\d{2}-\d{2}-\d{2}-\d{2})/.exec(filename)?.[1] || "";
      const id = `${artist}__${filename}`;
      tracks.push({
        id,
        artist,
        filename,
        title: titleFromName(filename),
        url: `${BASE}/${encodeURIComponent(artist)}/${filename}`,
        thumbnailUrl: ts ? `${BASE}/thumbnails/${artist}_${ts}.jpg` : null,
        pictureUrl: ts ? `${BASE}/thumbnails/${artist}_picture_${ts}.jpg` : null,
        size: prettySize(parseInt(cells[1] || "0", 10)),
        date: dateField(filename),
        index: idx++,
      });
    }
    tracks.sort((a, b) => (b.filename < a.filename ? -1 : b.filename > a.filename ? 1 : 0));

    // A live DJ's newest file is still being written to - it cannot be played, so
    // never offer it as an archive track. The artist page shows a LIVE entry instead.
    const live = await isArtistLive(artist);
    if (live && tracks.length) {
      tracks.shift();
      tracks.forEach((t, i) => { t.index = i; });
    }

    res.setHeader(
      "Cache-Control",
      live ? "s-maxage=30, stale-while-revalidate=120" : "s-maxage=600, stale-while-revalidate=86400"
    );
    res.status(200).json(tracks);
  } catch (e) {
    res.status(502).json({ error: String(e && e.message || e) });
  }
}
