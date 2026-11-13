# ADMIN PHASE 1 — security spine, shell, minimal metrics

Repo: `/opt/data/projects/webapp-copy` (Node 22 + Express, no build step, Alpine container).
Public site: `webapp.streambox.space` -> container port **8080**.
Admin site: `webappadmin.perker.dk` -> Cloudflare Tunnel -> container port **8081** (published to host loopback only).
The tunnel is the ONLY way in; Cloudflare Access already sits in front of it.

## Absolute security rules (the judge will fail the work if any is violated)

1. **No admin route may exist on port 8080.** `/admin`, `/api/admin/*`, `/login` etc. must return 404 on the public app.
2. Every admin route on 8081 requires an authenticated session, EXCEPT `GET /login` and `POST /login`.
3. All state-changing requests require a valid CSRF token tied to the session.
4. Session cookie: `HttpOnly`, `SameSite=Strict`, `Secure` when `X-Forwarded-Proto=https`, `Path=/`, no expiry beyond the server-side idle timeout (30 min).
5. Passwords stored as scrypt hashes + per-user salt. Never log passwords or tokens.
6. Login is rate-limited: max 5 attempts per 5 minutes per IP, then HTTP 429.
7. No user-supplied filesystem paths anywhere. No `eval`, no shell calls.
8. No secrets in HTML/JS delivered to the browser.
9. Public `/api/events` is unauthenticated by design: validate strictly, cap body size (2 KB), rate-limit per IP (60/min), store no IPs.

## Files to create

### `admin/server.mjs`
Exports `export function createAdminApp({ dataDir })` returning an Express app that serves everything at the root of its own port:

- `GET /` and `GET /admin*` -> `admin/index.html` (static shell; client-side routing)
- `GET /assets/admin.css`, `GET /assets/admin.js` -> static
- `GET /api/admin/me` -> `{ user }` or 401
- `POST /login` (form-urlencoded `user`, `password`) -> sets cookie, 302 to `/`
- `POST /logout` -> clears session, 302 to `/login`
- `GET /api/admin/overview` -> real numbers:
  `{ artists: number, liveNow: number, liveDJs: string[], eventsToday: {play, favorite, live_play, page}, bytesToday: number, generatedAt: ISO }`
- Everything else -> 404 JSON for `/api/*`, else `admin/index.html`.

Auth implementation (in `admin/auth.mjs`, keep it small and readable):
- Users file `data/admin-users.json`: `[{ "user": "nikolaj", "salt": "hex", "hash": "hex", "createdAt": "ISO" }]`
- Bootstrap: if the file does not exist and env `ADMIN_USER` + `ADMIN_PASSWORD` are set, create that user (scrypt N=16384, r=8, p=1, 64-byte key). If env missing, log a clear warning and leave no users (login always fails).
- Sessions: in-memory `Map<sid, { user, csrf, lastSeen }>`, sid = 32 random bytes hex; expired after 30 min idle; sweep on access.
- CSRF token: 32 random bytes hex, returned by `GET /api/admin/me`, required as header `x-csrf-token` on every non-GET `/api/admin/*` call and on `POST /logout`.

### `admin/index.html`
Dark admin shell using the site palette (`--bg:#0a0a0f`, `--surface`, `--text`, `--text2`, accent colours) and DM Sans. **No external CSS/JS/CDN.**
Layout: fixed left sidebar (STArchive Admin + 6 nav items), main region with its own scroll (`height:100dvh`, grid).
Pages (hash routes `#/overview`, `#/popularity`, `#/live`, `#/traffic`, `#/content`, `#/system`):
- Overview: 4 stat cards (artists, live now, plays today, favourites today) + a "Live now" list + "Data collection started <date>".
- The other five pages: a single empty-state card stating what will live there ("Coming in phase 2/3"). Do not fake data.
Header right side: current user + Logout.
Login view: centred card, user + password, inline error, no page reload (fetch).

### `admin/app.js`
Vanilla JS. Fetches `/api/admin/me`; if 401 show login; after login fetch `/api/admin/overview` and render. Store CSRF token in a module variable (not localStorage).

### `admin/admin.css`
All styles. Responsive down to 480px (sidebar collapses to a top bar).

## Files to modify

### `server.mjs` (public app)
1. Add a byte-counting middleware: for each response, count `Content-Length` or bytes written, and accumulate in memory as `{minute, kind, bytes, count}` where kind is `static | api | stream | page`. Flush to `data/metrics/served-YYYY-MM-DD.ndjson` every 60 s and on SIGTERM (`fs.appendFileSync` is fine).
2. Add `POST /api/events`: JSON body `{type, artist, track, sid}`; `type` ∈ `play|favorite|unfavorite|live_play|page`; every string truncated to 100 chars and sanitised (alphanumeric, `_ - . /`); append one NDJSON line to `data/events/YYYY-MM-DD.ndjson` with a server timestamp; respond `204`. Rate limit 60/min per IP (in-memory).
3. Start the admin listener **only if `ADMIN_PORT` is set** (default `8081`):
   `createAdminApp({ dataDir }).listen(ADMIN_PORT, "0.0.0.0", ...)` with a startup log line.
4. Keep every existing route and behaviour byte-identical.

### `Dockerfile`
`COPY admin ./admin` and ensure `data/` exists at runtime (`RUN mkdir -p /app/data/events /app/data/metrics`).

### `docker-compose.yml`
- `ports: ["127.0.0.1:8081:8081"]` (loopback only — never `0.0.0.0`)
- env: `ADMIN_PORT=8081`, `ADMIN_USER=${ADMIN_USER}`, `ADMIN_PASSWORD=${ADMIN_PASSWORD}`, `SESSION_SECRET=${SESSION_SECRET}`

## Constraints

- Node built-ins + `express` only. No new npm dependencies.
- All code, comments and UI copy in **English (US)**.
- `node --check` must pass on every JS file.
- Never start a server in the foreground. To smoke-test, spawn with a timeout and kill it, or use `curl` against a short-lived background process you explicitly kill afterwards.
- Do not modify `api/*.js`, `artist-extras.js`, `live.html`, or anything unrelated to the files above.

## Definition of done

1. `node --check` clean on `server.mjs`, `admin/*.js`.
2. `curl localhost:8080/api/admin/overview` -> **404** (public app has no admin API).
3. `curl -i localhost:8081/api/admin/overview` -> **401** (no session).
4. `curl -i localhost:8081/login` -> 200 HTML.
5. Login with the bootstrap credentials via `curl -c jar -d 'user=...&password=...'` -> 302 + cookie; then `curl -b jar localhost:8081/api/admin/me` -> `{user}` with a CSRF token.
6. Wrong password 6× -> last response 429.
