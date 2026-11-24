// admin/socials.mjs — validation + file I/O for the DJ social-links editor.
// Built-ins only: no Express, no network, so it can be unit-tested directly.
import crypto from "crypto";
import fs from "fs";
import path from "path";

/** The only keys the public /api/dj-profile endpoint reads. */
export const ALLOWED_SOCIAL_KEYS = [
  "twitch",
  "website",
  "x",
  "twitter",
  "instagram",
  "youtube",
  "discord",
  "tiktok",
];

/**
 * Keys the editor writes. "twitch" is intentionally absent: the public endpoint derives
 * https://www.twitch.tv/<dj> from the DJ id itself, so a stored value could only
 * override a link that is already correct. "twitter" is a legacy alias of "x".
 */
export const EDITABLE_SOCIAL_KEYS = ["website", "x", "instagram", "youtube", "discord", "tiktok"];

const MAX_VALUE_LENGTH = 300;
const MAX_KEY_LENGTH = 64;

/** A DJ id is the lowercase Twitch handle: letters, digits and underscore. */
export function isValidDjId(value) {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_KEY_LENGTH) return false;
  return /^[a-z0-9_]+$/.test(value);
}

export function normalizeDjId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Keep only known keys whose value is an http(s) URL. Unknown keys, empty values
 * and javascript:/data: URLs are dropped rather than rejected, so a partially
 * filled form still saves.
 */
export function sanitizeSocials(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const key of ALLOWED_SOCIAL_KEYS) {
    const raw = input[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value || value.length > MAX_VALUE_LENGTH) continue;
    if (!/^https?:\/\//i.test(value)) continue;
    // Reject control characters and anything that is not a printable URL.
    if (/[\u0000-\u001f\u007f\s]/.test(value)) continue;
    out[key] = value;
  }
  return out;
}

export function socialsPathFor(dataDir) {
  return path.join(dataDir, "dj-socials.json");
}

export function readSocialsFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Deliberately NOT sanitised here: this is the storage read. Sanitising on read
    // would silently drop legacy keys (e.g. "twitter") the moment anything is saved.
    const out = {};
    for (const [dj, entry] of Object.entries(parsed)) {
      const id = normalizeDjId(dj);
      if (!isValidDjId(id)) continue;
      out[id] = entry && typeof entry === "object" && !Array.isArray(entry) ? { ...entry } : {};
    }
    return out;
  } catch {
    return {};
  }
}

/** Atomic write: temp file in the same directory, then rename. */
export function writeSocialsFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Merge the live artist list with the stored overrides so the UI can show every
 * DJ, including those with no links yet.
 */
export function mergeDjList(artists, socialsByDj) {
  const list = Array.isArray(artists) ? artists : [];
  const seen = new Set();
  const rows = [];
  for (const artist of list) {
    const id = normalizeDjId(artist?.id);
    if (!isValidDjId(id) || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      name: artist?.displayName || artist?.name || id,
      socials: socialsByDj[id] || {},
    });
  }
  // Overrides for DJs that are not in the current artist list still need editing.
  for (const [id, socials] of Object.entries(socialsByDj || {})) {
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, name: id, socials });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
/**
 * Apply an editor save to an existing entry without destroying anything the editor
 * does not manage: keys outside ALLOWED_SOCIAL_KEYS survive untouched, and every
 * editable key is replaced by the submitted value (or removed when it is empty).
 */
export function mergeEditedSocials(existing, incoming) {
  const merged = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  // Only the keys the editor renders can be cleared by an empty submit; a legacy key
  // such as "twitter" must survive unless it is explicitly sent.
  for (const key of EDITABLE_SOCIAL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      merged[key] = incoming[key];
    } else {
      delete merged[key];
    }
  }
  for (const key of ALLOWED_SOCIAL_KEYS) {
    if (EDITABLE_SOCIAL_KEYS.includes(key)) continue;
    if (Object.prototype.hasOwnProperty.call(incoming, key)) merged[key] = incoming[key];
  }
  return merged;
}

/**
 * Serialise read-modify-write cycles inside this process. The admin runs in a single
 * container/process, so an in-process queue is sufficient (a multi-process deploy
 * would need a real file lock).
 */
let socialsChain = Promise.resolve();

export function withSocialsLock(fn) {
  const run = socialsChain.then(fn, fn);
  socialsChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Suggestions are produced outside the admin (agent research) and shipped with the
 * repo; declines are recorded on the data volume so a rejected suggestion never
 * comes back. Approved suggestions simply become normal stored links.
 */
export function readJsonObject(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function suggestionsPathFor(repoDir) {
  return path.join(repoDir, "dj-social-suggestions.json");
}

export function declinesPathFor(dataDir) {
  return path.join(dataDir, "dj-social-suggestions-declined.json");
}

/**
 * The suggestion a row should show, or null. A suggestion is hidden once the DJ has
 * stored links (nothing left to approve) or once an admin declined it.
 */
export function suggestionFor(dj, storedSocials, suggestions, declined) {
  const id = normalizeDjId(dj);
  if (!isValidDjId(id)) return null;
  const entry = suggestions?.[id];
  if (!entry || typeof entry !== "object") return null;

  // A decline silences the suggestion until a NEWER one is researched for that DJ.
  const decline = declined && Object.prototype.hasOwnProperty.call(declined, id) ? declined[id] : null;
  if (decline) {
    const declinedDay = String(decline.declinedAt || "").slice(0, 10);
    const foundDay = String(entry.foundAt || "").slice(0, 10);
    if (!foundDay || !declinedDay || foundDay <= declinedDay) return null;
  }
  const socials = sanitizeSocials(entry.socials);
  if (Object.keys(socials).length === 0) return null;
  const stored = storedSocials && typeof storedSocials === "object" ? storedSocials : {};
  const hasStored = Object.keys(stored).length > 0;
  if (hasStored) return null;
  return {
    socials,
    notes: typeof entry.notes === "string" ? entry.notes : "",
    sources: Array.isArray(entry.sources) ? entry.sources.filter((s) => typeof s === "string") : [],
    foundAt: typeof entry.foundAt === "string" ? entry.foundAt : "",
  };
}
