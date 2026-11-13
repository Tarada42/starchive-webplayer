// admin/access.mjs — Cloudflare Access JWT verification.
// Built-ins only.
import crypto from "crypto";

export const ACCESS_AUD =
  "da6c3d8265d3e9ca3788406c3e3dfcc88819bd46c9643aa2d8e9d07cdcc6b249";

const ISSUER_REGEX = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/;

export function parseJwtUnsafe(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return { header, payload, signature: parts[2] };
  } catch {
    return null;
  }
}

export async function verifyAccessJwt(token, { jwksFetcher }) {
  const parsed = parseJwtUnsafe(token);
  if (!parsed) return null;

  const { header, payload, signature } = parsed;

  if (!header || typeof header !== "object") return null;
  if (header.alg !== "RS256") return null;
  if (typeof header.kid !== "string" || header.kid.length === 0) return null;

  if (!payload || typeof payload !== "object") return null;

  if (Array.isArray(payload.aud)) {
    if (!payload.aud.includes(ACCESS_AUD)) return null;
  } else if (payload.aud !== ACCESS_AUD) {
    return null;
  }

  if (typeof payload.iss !== "string" || !ISSUER_REGEX.test(payload.iss)) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds - 60) return null;

  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== "number" || payload.nbf > nowSeconds + 60) return null;
  }

  if (
    typeof payload.email !== "string" ||
    payload.email.length === 0 ||
    !payload.email.includes("@")
  ) {
    return null;
  }

  const parts = token.split(".");
  const signedData = `${parts[0]}.${parts[1]}`;

  async function tryVerify(force = false) {
    const jwk = await jwksFetcher(payload.iss, header.kid, { force });
    if (!jwk || typeof jwk !== "object") return false;
    try {
      const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
      const signatureBuf = Buffer.from(signature, "base64url");
      return crypto.verify(
        "RSA-SHA256",
        Buffer.from(signedData, "utf8"),
        publicKey,
        signatureBuf
      );
    } catch {
      return false;
    }
  }

  let ok = await tryVerify(false);
  if (!ok) {
    ok = await tryVerify(true);
  }
  if (!ok) return null;

  return {
    email: payload.email,
    sub: payload.sub,
    iss: payload.iss,
    aud: Array.isArray(payload.aud) ? ACCESS_AUD : payload.aud,
  };
}

export function createJwksFetcher({ fetch = globalThis.fetch, cacheMs = 60 * 60 * 1000 } = {}) {
  const cache = new Map(); // issuer -> { keys, expiresAt }

  return async function fetchJwk(issuer, kid, { force = false } = {}) {
    if (typeof issuer !== "string" || !ISSUER_REGEX.test(issuer)) return null;
    if (typeof kid !== "string" || kid.length === 0) return null;

    const now = Date.now();
    const cached = cache.get(issuer);

    if (!force && cached && cached.expiresAt > now) {
      return cached.keys.find((k) => k && k.kid === kid) || null;
    }

    try {
      const url = new URL("/cdn-cgi/access/certs", issuer);
      const res = await fetch(url);
      if (!res.ok) return null;
      const jwks = await res.json();
      if (!jwks || !Array.isArray(jwks.keys)) return null;

      const keys = jwks.keys.filter(
        (k) => k && typeof k.kid === "string" && k.kid.length > 0
      );
      cache.set(issuer, { keys, expiresAt: now + cacheMs });
      return keys.find((k) => k.kid === kid) || null;
    } catch {
      return null;
    }
  };
}
