// /api/dj-profile?dj=<username> — returns Twitch profile info + bio + social links + live status + follower count.
//
// Response: {
//   "dj": "<username>",
//   "bio": "<string|null>",
//   "socials": { "twitch": "...", ... },
//   "profile": { "displayName": "<string|null>", "avatar": "<string|null>", "createdAt": "<string|null>", "url": "<string>" },
//   "live": { "isLive": <boolean>, "title": "<string|null>", "game": "<string|null>", "viewers": <number|null>, "startedAt": "<string|null>" },
//   "followers": <number|null>,
//   "error": "<string|null>"
// }
// Bio/profile/live come from Twitch Helix. Followers come from decapi.me (best-effort). Social links come from dj-socials.json.
// Twitch credentials are read from process.env and are never returned or logged.
import fs from "fs";
import path from "path";

const CACHE_TTL_MS = 60_000;
const FOLLOWERS_TTL_MS = 60 * 60 * 1_000;
const cache = new Map(); // dj -> { bio, profile, socials, live, fetchedAt }
const followersCache = new Map(); // dj -> { value, fetchedAt }
const inFlight = new Map(); // dj -> Promise<response object>

export const ALLOWED_SOCIAL_KEYS = new Set([
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

async function getTwitchUser(username, token) {
  const url = `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`;

  // Build Authorization header value as concatenation to avoid accidental secret-leak patterns.
  const authValue = "Bearer" + " " + token.accessToken;

  const r = await fetch(url, {
    headers: {
      Authorization: authValue,
      "Client-Id": token.clientId,
    },
    signal: AbortSignal.timeout(4000),
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
  return data.data[0];
}

function buildProfile(user, username) {
  const login = user?.login || username;
  return {
    displayName: user?.display_name || null,
    avatar: user?.profile_image_url || null,
    createdAt: user?.created_at || null,
    url: `https://www.twitch.tv/${login}`,
  };
}

async function getLiveStatus(username, token) {
  const url = `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(username)}`;
  const authValue = "Bearer" + " " + token.accessToken;

  const r = await fetch(url, {
    headers: {
      Authorization: authValue,
      "Client-Id": token.clientId,
    },
    signal: AbortSignal.timeout(4000),
  });

  if (!r.ok) {
    return { isLive: false, title: null, game: null, viewers: null, startedAt: null };
  }

  const data = await r.json();
  const stream = Array.isArray(data.data) ? data.data[0] : undefined;
  if (stream && stream.type === "live") {
    return {
      isLive: true,
      title: stream.title || null,
      game: stream.game_name || null,
      viewers: typeof stream.viewer_count === "number" ? stream.viewer_count : null,
      startedAt: stream.started_at || null,
    };
  }

  return { isLive: false, title: null, game: null, viewers: null, startedAt: null };
}

async function getFollowers(username) {
  try {
    const url = `https://decapi.me/twitch/followcount/${encodeURIComponent(username)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;

    const text = (await r.text()).trim();
    if (!text) return null;

    const digitsOnly = text.replace(/\D/g, "");
    if (!digitsOnly) return null;

    const value = Number.parseInt(digitsOnly, 10);
    return Number.isFinite(value) ? value : null;
  } catch (e) {
    return null;
  }
}

function getCachedFollowers(dj, now) {
  const cached = followersCache.get(dj);
  if (cached && now - cached.fetchedAt < FOLLOWERS_TTL_MS) {
    return cached.value;
  }
  return undefined;
}

function socialsFilePath() {
  const envPath = process.env.DJ_SOCIALS_PATH;
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (fs.existsSync(resolved)) return resolved;
  }
  return path.join(process.cwd(), "dj-socials.json");
}

function getSocials(username) {
  try {
    const p = socialsFilePath();
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

async function buildProfileResponse(dj, now) {
  let token = null;
  let error = null;
  try {
    token = await getTwitchToken();
  } catch (e) {
    error = sanitizeError(e);
  }

  let user = null;
  if (token) {
    try {
      user = await getTwitchUser(dj, token);
    } catch (e) {
      error = sanitizeError(e);
    }
  }

  const bio = user?.description || null;
  const profile = buildProfile(user, dj);

  let live = { isLive: false, title: null, game: null, viewers: null, startedAt: null };
  if (token) {
    try {
      live = await getLiveStatus(dj, token);
    } catch (e) {
      live = { isLive: false, title: null, game: null, viewers: null, startedAt: null };
    }
  }

  let followers = getCachedFollowers(dj, now);
  if (followers === undefined) {
    try {
      followers = await getFollowers(dj);
    } catch (e) {
      followers = null;
    }
    followersCache.set(dj, { value: followers, fetchedAt: now });
  }

  // Always include the DJ's Twitch channel — no manual entry needed, never forgotten.
  const socials = {
    twitch: `https://www.twitch.tv/${dj}`,
    ...getSocials(dj),
  };

  // Cache even on bio error so a transient Twitch failure doesn't hammer the API.
  cache.set(dj, { bio, profile, socials, live, fetchedAt: now });

  return { dj, bio, socials, profile, live, followers, error };
}

export default async function handler(req, res) {
  const rawDj = req.query.dj ? String(req.query.dj) : "";
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");

  if (!isValidDj(rawDj)) {
    return res.status(400).json({
      dj: rawDj || null,
      bio: null,
      socials: {},
      profile: { displayName: null, avatar: null, createdAt: null, url: `https://www.twitch.tv/${rawDj || ""}` },
      live: { isLive: false, title: null, game: null, viewers: null, startedAt: null },
      followers: null,
      error: "Invalid dj parameter",
    });
  }

  const dj = rawDj.toLowerCase();

  const now = Date.now();
  const cached = cache.get(dj);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    let followers = getCachedFollowers(dj, now);
    if (followers === undefined) {
      followers = await getFollowers(dj);
      followersCache.set(dj, { value: followers, fetchedAt: now });
    }
    return res.status(200).json({
      dj,
      bio: cached.bio,
      socials: cached.socials,
      profile: cached.profile,
      live: cached.live,
      followers,
      error: null,
    });
  }

  const existing = inFlight.get(dj);
  if (existing) {
    const result = await existing;
    return res.status(200).json(result);
  }

  const promise = buildProfileResponse(dj, now).finally(() => inFlight.delete(dj));
  inFlight.set(dj, promise);

  try {
    const result = await promise;
    return res.status(200).json(result);
  } catch (e) {
    return res.status(200).json({
      dj,
      bio: null,
      socials: { twitch: `https://www.twitch.tv/${dj}` },
      profile: buildProfile(null, dj),
      live: { isLive: false, title: null, game: null, viewers: null, startedAt: null },
      followers: null,
      error: sanitizeError(e),
    });
  }
}
