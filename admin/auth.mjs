// admin/auth.mjs — session, scrypt password, CSRF, and login rate-limiting.
// Built-ins only.
import crypto from "crypto";
import fs from "fs";
import path from "path";

const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

const COOKIE_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString("hex");

if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET not set — using a random per-process secret (sessions end on restart).");
}

function signSid(sid) {
  const mac = crypto.createHmac("sha256", COOKIE_SECRET).update(sid).digest("hex");
  return `${sid}.${mac}`;
}

function unsignSid(value) {
  if (typeof value !== "string") return null;
  const i = value.lastIndexOf(".");
  if (i <= 0) return null;
  const sid = value.slice(0, i);
  const mac = value.slice(i + 1);
  const expected = crypto.createHmac("sha256", COOKIE_SECRET).update(sid).digest("hex");
  return safeEqual(mac, expected) ? sid : null;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a == null ? "" : a), "utf8");
  const y = Buffer.from(String(b == null ? "" : b), "utf8");
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error("Failed to read JSON:", p, e.message);
    return fallback;
  }
}

function writeJsonAtomic(p, data) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

function scryptHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, SCRYPT_PARAMS, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString("hex"));
    });
  });
}

function isSecureProxy(req) {
  const fwd = req.headers["x-forwarded-proto"];
  return fwd === "https";
}

export function createAuth({ dataDir }) {
  const usersPath = path.join(dataDir, "admin-users.json");

  // Bootstrap the first admin user from env if no users file exists.
  function bootstrap() {
    if (fs.existsSync(usersPath)) return;
    const adminUser = process.env.ADMIN_USER;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminUser || !adminPassword) {
      console.warn(
        "No admin-users.json found and ADMIN_USER/ADMIN_PASSWORD not set. " +
          "Admin login will fail until a user is created."
      );
      return;
    }
    const salt = randomHex(32);
    const hash = crypto
      .scryptSync(adminPassword, salt, KEYLEN, SCRYPT_PARAMS)
      .toString("hex");
    writeJsonAtomic(usersPath, [
      { user: adminUser, salt, hash, createdAt: new Date().toISOString() },
    ]);
    console.log(`Bootstrapped admin user "${adminUser}".`);
  }

  bootstrap();

  const users = readJsonSafe(usersPath, []);
  const sessions = new Map(); // sid -> { user, csrf, lastSeen }
  const loginAttempts = new Map(); // ip -> { count, resetAt }

  function sweepSessions() {
    const now = Date.now();
    for (const [sid, s] of sessions.entries()) {
      if (now - s.lastSeen > SESSION_IDLE_MS) {
        sessions.delete(sid);
      }
    }
  }

  function getIp(req) {
    return (
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "unknown"
    );
  }

  function cookieOptions(req) {
    return {
      httpOnly: true,
      sameSite: "strict",
      secure: isSecureProxy(req),
      path: "/",
    };
  }

  function getSession(req) {
    const sid = unsignSid(req.cookies?.sid);
    if (!sid) return null;
    const s = sessions.get(sid);
    if (!s) return null;
    if (Date.now() - s.lastSeen > SESSION_IDLE_MS) {
      sessions.delete(sid);
      return null;
    }
    s.lastSeen = Date.now();
    s.sid = sid;
    return s;
  }

  function createSession(user) {
    const sid = randomHex(32);
    const csrf = randomHex(32);
    const session = { user, csrf, lastSeen: Date.now() };
    sessions.set(sid, session);
    return { sid, cookieValue: signSid(sid), csrf, user, session };
  }

  function requireAuth(req, res, next) {
    sweepSessions();
    const s = getSession(req);
    if (!s) {
      if (req.path.startsWith("/api/")) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      return res.redirect("/login");
    }
    req.session = s;
    next();
  }

  function requireCsrf(req, res, next) {
    const token = req.headers["x-csrf-token"];
    const s = req.session;
    if (!s || !token || !safeEqual(token, s.csrf)) {
      return res.status(403).json({ error: "Invalid CSRF token" });
    }
    next();
  }

  async function attemptLogin(user, password, ip) {
    const now = Date.now();
    const windowMs = 5 * 60 * 1000;
    const record = loginAttempts.get(ip);
    if (record && now > record.resetAt) {
      loginAttempts.delete(ip);
    }
    const current = loginAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
    if (current.count >= 5) {
      return { blocked: true };
    }

    const u = users.find((x) => x.user === user);
    if (!u) {
      current.count += 1;
      loginAttempts.set(ip, current);
      return { ok: false };
    }
    const hash = await scryptHash(password, u.salt);
    if (!safeEqual(hash, u.hash)) {
      current.count += 1;
      loginAttempts.set(ip, current);
      return { ok: false };
    }

    // Successful login: clear attempts for this IP.
    loginAttempts.delete(ip);
    const sid = randomHex(32);
    const csrf = randomHex(32);
    sessions.set(sid, { user: u.user, csrf, lastSeen: Date.now() });
    return { ok: true, sid, cookieValue: signSid(sid), csrf, user: u.user };
  }

  function logout(sid) {
    sessions.delete(sid);
  }

  return {
    cookieOptions,
    requireAuth,
    requireCsrf,
    attemptLogin,
    logout,
    getSession,
    createSession,
    sweepSessions,
    getIp,
  };
}
