// /api/live — returns currently-live STArchive DJs.
// Detects live mounts on the Icecast restream page (live.streambox.space), same signal
// the Android app uses ("twitch.tv/<username>" links), enriched with display name, the
// currently-playing track (from the Icecast metadata), and the direct MP3/OGG mount URLs.
//
// Response: [ { id, name, displayName, title, liveUrl, listeners, twitch } ] — empty array if none live.
import path from "path";
import fs from "fs";

const LIVE_BASE = "https://live.streambox.space";
const STREAM_BASE = "https://starchive.streambox.space";
const TWITCH_STREAMS_CACHE_TTL_MS = 60_000;

let twitchStreamsCache = { map: null, fetchedAt: 0, promise: null };

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

// Icecast serves titles HTML-escaped ("Beers&amp;Beatz"). Decode once here so every
// consumer gets the real text; clients then escape it for display as usual.
function decodeEntities(input) {
  let s = String(input == null ? "" : input);
  s = s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
  // &amp; last, so "&amp;lt;" becomes "&lt;" instead of "<".
  return s.replace(/&amp;/g, "&");
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
      title: titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, "")).trim() : "",
      listeners: listenersMatch ? parseInt(listenersMatch[1].replace(/[^\d]/g, ""), 10) || 0 : 0,
    });
  }
  return mounts;
}

async function getTwitchToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Twitch credentials are not configured");
  }

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("grant_type", "client_credentials");

  const r = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(4000),
  });

  if (!r.ok) {
    throw new Error(`Twitch token endpoint returned ${r.status}`);
  }

  const data = await r.json();
  if (!data.access_token) {
    throw new Error("Twitch token response missing access_token");
  }
  return { accessToken: data.access_token, clientId };
}

async function fetchTwitchStreams(ids, token) {
  const url = new URL("https://api.twitch.tv/helix/streams");
  for (const id of ids) {
    url.searchParams.append("user_login", id);
  }

  // Build Authorization header value as concatenation to avoid accidental secret-leak patterns.
  const authValue = "Bearer" + " " + token.accessToken;

  const r = await fetch(url.toString(), {
    headers: {
      Authorization: authValue,
      "Client-Id": token.clientId,
    },
    signal: AbortSignal.timeout(4000),
  });

  if (!r.ok) {
    throw new Error(`Twitch streams endpoint returned ${r.status}`);
  }

  const data = await r.json();
  const map = new Map();
  for (const stream of data.data || []) {
    if (stream.type === "live") {
      map.set(stream.user_login.toLowerCase(), {
        isLive: true,
        title: stream.title || null,
        game: stream.game_name || null,
        viewers: typeof stream.viewer_count === "number" ? stream.viewer_count : null,
        startedAt: stream.started_at || null,
      });
    }
  }
  return map;
}

function attachTwitch(out, map) {
  return out.map((dj) => {
    if (map === null) return { ...dj, twitch: null };
    const stream = map.get(dj.id.toLowerCase());
    if (stream) return { ...dj, twitch: stream };
    return {
      ...dj,
      twitch: { isLive: false, title: null, game: null, viewers: null, startedAt: null },
    };
  });
}

async function enrichTwitch(out) {
  const ids = out.map((dj) => dj.id).filter(Boolean).slice(0, 100);
  if (!ids.length) return out.map((dj) => ({ ...dj, twitch: null }));

  const now = Date.now();
  if (now - twitchStreamsCache.fetchedAt < TWITCH_STREAMS_CACHE_TTL_MS) {
    return attachTwitch(out, twitchStreamsCache.map);
  }

  if (twitchStreamsCache.promise) {
    const map = await twitchStreamsCache.promise;
    return attachTwitch(out, map);
  }

  twitchStreamsCache.promise = (async () => {
    try {
      const token = await getTwitchToken();
      const map = await fetchTwitchStreams(ids, token);
      twitchStreamsCache.map = map;
      twitchStreamsCache.fetchedAt = Date.now();
      return map;
    } catch (e) {
      twitchStreamsCache.map = null;
      twitchStreamsCache.fetchedAt = Date.now();
      return null;
    } finally {
      twitchStreamsCache.promise = null;
    }
  })();

  const map = await twitchStreamsCache.promise;
  return attachTwitch(out, map);
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
    const enriched = await enrichTwitch(out);
    res.status(200).json(enriched);
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
}