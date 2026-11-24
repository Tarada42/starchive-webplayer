// admin/genres.mjs — genre overrides: validation, storage and the merged view the
// public site serves. Built-ins only so it can be unit-tested directly.
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const MAX_GENRES_PER_DJ = 6;
export const MAX_GENRE_LENGTH = 40;

/** Genre names are short human labels: letters, digits, spaces and a few separators. */
export function isValidGenreName(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v || v.length > MAX_GENRE_LENGTH) return false;
  return /^[A-Za-z0-9][A-Za-z0-9 &/+.'-]*$/.test(v);
}

/** Dedupe case-insensitively, keep the first spelling seen, cap the list length. */
export function sanitizeGenres(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (!isValidGenreName(raw)) continue;
    const name = raw.trim().replace(/\s+/g, " ");
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_GENRES_PER_DJ) break;
  }
  return out;
}

export function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function genresBasePath(repoDir) {
  return path.join(repoDir, "genres.json");
}

export function overridesPathFor(dataDir) {
  return path.join(dataDir, "genre-overrides.json");
}

/** Overrides are stored as { overrides: { dj: { genres: [...], updatedAt, by } } }. */
export function readOverrides(filePath) {
  const raw = readJsonSafe(filePath, {});
  const out = {};
  const source = raw && typeof raw.overrides === "object" && raw.overrides ? raw.overrides : {};
  for (const [dj, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== "object") continue;
    const genres = sanitizeGenres(entry.genres);
    if (!genres.length) continue;
    out[dj] = {
      genres,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
      by: typeof entry.by === "string" ? entry.by : "",
    };
  }
  return out;
}

export function writeOverrides(filePath, overrides) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const payload = {
    _comment:
      "Hand-curated genre overrides, managed from the admin Content -> Genres screen. These win over tags detected from Twitch.",
    overrides,
  };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * The /genres.json payload the site consumes: the generated base with overrides
 * applied. Shape is preserved so artist-extras.js needs no changes.
 */
export function mergeGenres(base, overrides) {
  const source = base && typeof base === "object" ? base : {};
  const artists = source.artists && typeof source.artists === "object" ? source.artists : {};
  const merged = {};
  for (const [dj, entry] of Object.entries(artists)) {
    merged[dj] = entry && typeof entry === "object" ? { ...entry } : {};
  }
  for (const [dj, override] of Object.entries(overrides || {})) {
    const existing = merged[dj] || {};
    merged[dj] = {
      ...existing,
      genres: override.genres,
      scores: Object.fromEntries(override.genres.map((g, i) => [g, Math.max(1, override.genres.length - i)])),
      source: "manual",
      overriddenAt: override.updatedAt || "",
    };
  }
  return { ...source, artists: merged };
}

/** Every genre currently in use, most common first, for the editor's suggestions. */
export function genreVocabulary(base, overrides) {
  const counts = new Map();
  const add = (name) => {
    const key = name;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  const artists = (base && base.artists) || {};
  for (const entry of Object.values(artists)) {
    for (const g of entry?.genres || []) add(g);
  }
  for (const entry of Object.values(overrides || {})) {
    for (const g of entry.genres) add(g);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

let chain = Promise.resolve();

/** Serialise read-modify-write cycles inside this process. */
export function withGenresLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}