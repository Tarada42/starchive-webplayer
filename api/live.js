// /api/live — returns currently-live STArchive DJs.
// Detects live mounts on the Icecast restream page (live.streambox.space), same signal
// the Android app uses ("twitch.tv/<username>" links), enriched with display name, the
// currently-playing track (from the Icecast metadata), and the direct MP3/OGG mount URLs.
//
// Response: [ { id, name, displayName, title, liveUrl, listeners } ] — empty array if none live.
import path from "path";
import fs from "fs";

const LIVE_BASE = "https://live.streambox.space";
const STREAM_BASE = "https://starchive.streambox.space";

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

async function liveMounts() {
  const res = await fetch(LIVE_BASE + "/", { headers: { "User-Agent": "starchive-api/1.0" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const html = await res.text();

  const mounts = [];
  const secRe = /<section[^>]*class="box"[^>]*>([\s\S]*?)<\/section>/gi;
  let sec;
  while ((sec = secRe.exec(html))) {
    const body = sec[1];
    const mountRe = /Mountpoint\s*<code>\/([^<]+)<\/code>/i;
    const m = mountRe.exec(body);
    if (!m) continue;
    const id = m[1].trim();
    if (!id || id === "." || id === "..") continue;

    const titleMatch = /<td>Currently playing:<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(body);
    const listenersMatch = /<td>Listeners \(current\):<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(body);
    mounts.push({
      id,
      title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "",
      listeners: listenersMatch ? parseInt(listenersMatch[1].replace(/[^\d]/g, ""), 10) || 0 : 0,
    });
  }
  return mounts;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
  try {
    const mounts = await liveMounts();
    const hide = hiddenSet();
    // Icecast exposes both the base OGG mount (/poddersdj) and the _hq MP3 variant
    // (/poddersdj_hq). Dedupe: prefer the base id, keep the higher-quality _hq stream URL,
    // and merge metadata from whichever mount reports a playing title.
    const merged = new Map();
    for (const m of mounts) {
      const id = m.id.endsWith("_hq") ? m.id.slice(0, -"_hq".length) : m.id;
      const existing = merged.get(id) || { id, title: "", listeners: 0 };
      if (m.title && !existing.title) existing.title = m.title;
      if (m.listeners > existing.listeners) existing.listeners = m.listeners;
      merged.set(id, existing);
    }
    const out = [...merged.values()]
      .filter((m) => !hide.has(m.id))
      .sort((a, b) => b.listeners - a.listeners)
      .map((m) => ({
        id: m.id,
        name: m.id,
        displayName: m.id.replace(/_/g, " "),
        title: m.title,
        listeners: m.listeners,
        liveUrl: `${LIVE_BASE}/${m.id}_hq`, // high-quality MP3 restream (matches the app)
      }));
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
}