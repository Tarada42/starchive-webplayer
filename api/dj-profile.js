// /api/dj-profile?dj=<username> — returns a Twitch bio + manually-curated social links.
//
// Response: { "dj": "<username>", "bio": "<string|null>", "socials": {...}, "error": "<string|null>" }
// Bio comes from Twitch Helix /users. Social links come from dj-socials.json.
// Twitch credentials are read from process.env and are never returned or logged.
import fs from "fs";
import path from "path";

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // dj -> { bio, socials, fetchedAt }

const ALLOWED_SOCIAL_KEYS = new Set([
  "x",
  "twitter",
  "instagram",
  "youtube",
  "discord",
  "tiktok",
  "website",
]);

function isValidDj(dj) {
  return typeof dj === "string" && /^[a-zA-Z0-9_]+$/.test(dj);
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

async function getTwitchBio(username) {
  const { accessToken, clientId } = await getTwitchToken();
  const url = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`;

  // Build Authorization header value as concatenation to avoid accidental secret-leak patterns.
  const authValue = "Bearer" + " " + accessToken;

  const r = await fetch(url, {
    headers: {
      Authorization: authValue,
      "Client-Id": clientId,
    },
  });

  if (!r.ok) {
    if (r.status === 404 || r.status === 410) {
      return null;
    }
    throw new Error(`Twitch users endpoint returned ${r.status}`);
  }

  const data = await r.json();
  if (!Array.isArray(data.data) || data.data.length === 0) {
    return null;
  }
  return data.data[0].description || null;
}

function getSocials(username) {
  try {
    const p = path.join(process.cwd(), "dj-socials.json");
    if (!fs.existsSync(p)) return {};
    const all = JSON.parse(fs.readFileSync(p, "utf8"));
    const entry = all[username];
    if (!entry || typeof entry !== "object") return {};

    // Only return allowed keys so the file can never accidentally leak extras.
    const out = {};
    for (const [k, v] of Object.entries(entry)) {
      if (ALLOWED_SOCIAL_KEYS.has(k) && typeof v === "string") {
        out[k] = v;
      }
    }
    return out;
  } catch (e) {
    return {};
  }
}

function sanitizeError(e) {
  const msg = String((e && e.message) || e);
  // Defensive: ensure no credential ever leaks through an upstream error string.
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (secret && secret.length > 4) {
    return msg.replaceAll(secret, "***");
  }
  return msg;
}

export default async function handler(req, res) {
  const rawDj = req.query.dj ? String(req.query.dj) : "";
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

  if (!isValidDj(rawDj)) {
    return res.status(400).json({
      dj: rawDj || null,
      bio: null,
      socials: {},
      error: "Invalid dj parameter",
    });
  }

  const dj = rawDj.toLowerCase();

  const now = Date.now();
  const cached = cache.get(dj);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return res.status(200).json({
      dj,
      bio: cached.bio,
      socials: cached.socials,
      error: null,
    });
  }

  let bio = null;
  let error = null;
  try {
    bio = await getTwitchBio(dj);
  } catch (e) {
    error = sanitizeError(e);
    bio = null;
  }

  // Always include the DJ's Twitch channel — no manual entry needed, never forgotten.
  const socials = {
    twitch: `https://www.twitch.tv/${dj}`,
    ...getSocials(dj),
  };

  // Cache even on bio error so a transient Twitch failure doesn't hammer the API.
  cache.set(dj, { bio, socials, fetchedAt: now });

  res.status(200).json({ dj, bio, socials, error });
}
