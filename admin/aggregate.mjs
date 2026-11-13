// admin/aggregate.mjs — pure aggregation functions for dashboard data.
// Built-ins only.
import fs from "fs";
import path from "path";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 90;
const MIN_DAYS = 1;

export function clampDays(days) {
  const n = Number.isFinite(days) ? Math.floor(days) : NaN;
  if (!Number.isFinite(n) || n < MIN_DAYS) return MIN_DAYS;
  if (n > MAX_DAYS) return MAX_DAYS;
  return n;
}

export function dateStr(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export function readDayFiles(dataDir, subdir, days) {
  const clamped = clampDays(days);
  const dir = path.join(dataDir, subdir);
  const files = [];
  const now = Date.now();
  for (let i = 0; i < clamped; i += 1) {
    const d = new Date(now - i * DAY_MS);
    const name = `${dateStr(d)}.ndjson`;
    files.push({ date: dateStr(d), path: path.join(dir, name) });
  }
  return files;
}

export function readNdjson(p) {
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, "utf8");
  const lines = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // Tolerate corrupt lines.
    }
  }
  return lines;
}

export function readEvents(dataDir, days) {
  const out = [];
  for (const { date, path: p } of readDayFiles(dataDir, "events", days)) {
    for (const ev of readNdjson(p)) {
      if (!ev || typeof ev !== "object") continue;
      const type = String(ev.type || "");
      if (!type) continue;
      out.push({
        type,
        artist: String(ev.artist || ""),
        track: String(ev.track || ""),
        ts: ev.ts || `${date}T00:00:00.000Z`,
      });
    }
  }
  return out;
}

export function popularity(dataDir, days) {
  const clamped = clampDays(days);
  const events = readEvents(dataDir, clamped);

  const totals = { plays: 0, favorites: 0, livePlays: 0, pages: 0 };
  const artistMap = new Map();
  const trackMap = new Map();

  function artistEntry(name) {
    let e = artistMap.get(name);
    if (!e) {
      e = { artist: name, plays: 0, favorites: 0, livePlays: 0 };
      artistMap.set(name, e);
    }
    return e;
  }

  function trackKey(artist, track) {
    return `${artist}\t${track}`;
  }

  function trackEntry(artist, trackName) {
    const key = trackKey(artist, trackName);
    let e = trackMap.get(key);
    if (!e) {
      e = { artist, track: trackName, plays: 0 };
      trackMap.set(key, e);
    }
    return e;
  }

  for (const ev of events) {
    switch (ev.type) {
      case "play":
        totals.plays += 1;
        if (ev.artist) {
          artistEntry(ev.artist).plays += 1;
          if (ev.track) trackEntry(ev.artist, ev.track).plays += 1;
        }
        break;
      case "favorite":
        totals.favorites += 1;
        if (ev.artist) artistEntry(ev.artist).favorites += 1;
        break;
      case "unfavorite":
        // Recorded but not counted toward popularity favorites.
        break;
      case "live_play":
        totals.livePlays += 1;
        if (ev.artist) artistEntry(ev.artist).livePlays += 1;
        break;
      case "page":
        totals.pages += 1;
        break;
      default:
        break;
    }
  }

  const artists = Array.from(artistMap.values())
    .map((a) => ({
      artist: a.artist,
      plays: a.plays,
      favorites: a.favorites,
      livePlays: a.livePlays,
      score: a.plays + a.favorites * 3 + a.livePlays,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.artist.localeCompare(b.artist);
    });

  const tracks = Array.from(trackMap.values()).sort((a, b) => {
    if (b.plays !== a.plays) return b.plays - a.plays;
    if (a.artist !== b.artist) return a.artist.localeCompare(b.artist);
    return a.track.localeCompare(b.track);
  });

  return { days: clamped, totals, artists, tracks };
}

export function traffic(dataDir, days) {
  const clamped = clampDays(days);
  const kinds = new Set(["static", "api", "stream", "page"]);
  const dayMap = new Map();
  const totals = { static: 0, api: 0, stream: 0, page: 0, total: 0 };

  for (const { date, path: p } of readDayFiles(dataDir, "metrics", clamped)) {
    const day = { date, static: 0, api: 0, stream: 0, page: 0, total: 0 };
    for (const row of readNdjson(p)) {
      if (!row || typeof row !== "object") continue;
      const kind = String(row.kind || "");
      const bytes = typeof row.bytes === "number" && Number.isFinite(row.bytes) ? row.bytes : 0;
      if (!bytes || !kinds.has(kind)) continue;
      day[kind] += bytes;
      day.total += bytes;
      totals[kind] += bytes;
      totals.total += bytes;
    }
    dayMap.set(date, day);
  }

  const daysList = [];
  for (const { date } of readDayFiles(dataDir, "metrics", clamped)) {
    daysList.push(dayMap.get(date) || { date, static: 0, api: 0, stream: 0, page: 0, total: 0 });
  }

  return { days: clamped, daysList, totals };
}

export function liveStats(dataDir, days) {
  const clamped = clampDays(days);
  const samples = [];
  const dayTotals = new Map();
  const dayPeaks = new Map();
  const djMinutes = new Map();
  const djPeaks = new Map();

  for (const { date } of readDayFiles(dataDir, "metrics", clamped)) {
    // The sampler writes listeners-YYYY-MM-DD.ndjson (byte metrics use the bare date).
    const p = path.join(dataDir, "metrics", `listeners-${date}.ndjson`);
    for (const row of readNdjson(p)) {
      if (!row || typeof row !== "object") continue;
      if (typeof row.total !== "number" || !Number.isFinite(row.total)) continue;
      const ts = row.ts || `${date}T00:00:00.000Z`;
      const total = row.total;
      const mounts = row.mounts && typeof row.mounts === "object" ? row.mounts : {};

      samples.push({ ts, total, mounts });

      const prevTotal = dayTotals.get(date) || { sum: 0, count: 0 };
      prevTotal.sum += total;
      prevTotal.count += 1;
      dayTotals.set(date, prevTotal);

      const prevPeak = dayPeaks.get(date);
      if (prevPeak === undefined || total > prevPeak.total) {
        dayPeaks.set(date, { total, ts });
      }

      for (const [dj, n] of Object.entries(mounts)) {
        const count = typeof n === "number" && Number.isFinite(n) ? n : 0;
        if (!dj) continue;
        djMinutes.set(dj, (djMinutes.get(dj) || 0) + 1);
        const cur = djPeaks.get(dj);
        if (cur === undefined || count > cur) djPeaks.set(dj, count);
      }
    }
  }

  let peak = { total: 0, ts: null };
  let totalSum = 0;
  for (const s of samples) {
    totalSum += s.total;
    if (s.total > peak.total) peak = { total: s.total, ts: s.ts };
  }

  const average = samples.length ? totalSum / samples.length : 0;

  const byDay = [];
  for (const { date } of readDayFiles(dataDir, "metrics", clamped)) {
    const agg = dayTotals.get(date);
    const p = dayPeaks.get(date);
    byDay.push({
      date,
      peak: p ? p.total : 0,
      average: agg && agg.count ? agg.sum / agg.count : 0,
    });
  }

  const djs = Array.from(djMinutes.keys())
    .map((artist) => ({
      artist,
      minutes: djMinutes.get(artist) || 0,
      peak: djPeaks.get(artist) || 0,
    }))
    .sort((a, b) => {
      if (b.peak !== a.peak) return b.peak - a.peak;
      return a.artist.localeCompare(b.artist);
    });

  return {
    days: clamped,
    samples: samples.length,
    peak,
    average,
    byDay,
    djs,
  };
}
