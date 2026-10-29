// /api/artists — scrapes the STArchive Apache listing, shaped exactly like the original
// 66ejzz.vercel.app API: [{ id, name, displayName, date }] sorted newest (by folder mtime).
// Excludes DJs listed in hidden.json (removed from the app after being unreachable /
// without a picture for 14+ days).
const BASE = "https://starchive.streambox.space";
const fs = require("fs");
const path = require("path");

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

async function scrapeIndex() {
  const res = await fetch(BASE + "/", { headers: { "User-Agent": "starchive-api/1.0" } });
  const html = await res.text();
  const hide = hiddenSet();
  const artists = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const href = /<a[^>]+href="([^"]+)"/i.exec(row)?.[1] || "";
    if (!href.endsWith("/")) continue;
    if (href.startsWith("?")) continue;
    const id = decodeURIComponent(href.slice(0, -1).split("/").pop() || "");
    if (!id || id === "." || id === ".." || id === "thumbnails") continue;
    if (hide.has(id)) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, "").trim()
    );
    const date = cells[cells.length - 1] || "";
    artists.push({ id, name: id, displayName: id.replace(/_/g, " "), date });
  }
  artists.sort((a, b) => new Date(b.date) - new Date(a.date) || 0);
  return artists;
}

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=86400");
    res.status(200).json(await scrapeIndex());
  } catch (e) {
    res.status(502).json({ error: String(e && e.message || e) });
  }
}