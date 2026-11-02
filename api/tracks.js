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
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=86400");
    res.status(200).json(tracks);
  } catch (e) {
    res.status(502).json({ error: String(e && e.message || e) });
  }
}
