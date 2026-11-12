# STArchive Web Player

Self-hosted web player for the ST Archive — browse DJs, stream and download sets, follow live shows.

## What's new (12 Nov 2026)

- **Twitch metadata on artist pages** — time on Twitch, channel link, bio and social icons.
- **Live page** — Twitch viewer count per DJ, "Watch on Twitch", and dad jokes when nobody is live (no repeats).
- **Sidebar live counter** — red badge with the number of live DJs, hidden when zero.
- **Live artists** — the in-progress newest file is never offered; a LIVE NOW row opens the live page and starts that stream.
- **Artwork** — every DJ gets a picture (archive thumbnail, else Twitch avatar), refreshed daily.
- **Stream-safe refresh** — the 30 s poll updates stats without interrupting playback.

## Stack

Node 22 + Express (`server.mjs`), `api/*` handlers, prebuilt SPA in `assets/`, plus `live.html`, `admin.html`, `privacy.html`.

---

## Run locally

**Requirements:** Node.js 22 or newer, npm, and optionally Twitch API credentials.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file in the project root:

   ```bash
   TWITCH_CLIENT_ID=your_client_id
   TWITCH_CLIENT_SECRET=your_client_secret
   ```

   Both come from a Twitch developer application (https://dev.twitch.tv/console). They are used
   server-side only, for DJ bios and live metadata. Without them the site still runs — bios and
   Twitch viewer counts stay empty.

3. Start the server:

   ```bash
   PORT=8080 node server.mjs
   ```

   Expected output: `STArchive webapp-copy serving on :8080 (cwd=/path/to/project)`

4. Open:

   - `http://localhost:8080/` — archive / player
   - `http://localhost:8080/live` — live DJs, viewer counts, jokes when idle
   - `http://localhost:8080/coliflower` — DJ social-links editor

5. Quick checks:

   ```bash
   curl -s localhost:8080/api/live | head -c 200
   curl -s "localhost:8080/api/dj-profile?dj=thedjbigd" | head -c 200
   ```

   Both return JSON. `[]` from `/api/live` simply means nobody is streaming at that moment.

**Note:** the API handlers read Twitch credentials from the process environment. When running via
Docker, pass them as container environment variables instead (see below).

---

## Deploy (Hostinger VPS)

**Assumed setup:** Ubuntu/Debian VPS with Docker + Docker Compose, and a **Traefik** instance already
running on the host (here: `/docker/traefik`). This project's compose file does **not** start Traefik —
it defines only the `webapp` service, which Traefik discovers through Docker labels.

1. Point DNS at the server: an `A` record for `webapp.streambox.space` → your VPS IP.

2. Clone the repository onto the host:

   ```bash
   mkdir -p /docker/starchive-webapp
   cd /docker/starchive-webapp
   git clone https://github.com/Tarada42/starchive-webplayer.git .
   ```

3. Create the environment file (never commit it):

   ```bash
   cd /docker/starchive-webapp
   cat > .env <<'EOF'
   TWITCH_CLIENT_ID=your_client_id
   TWITCH_CLIENT_SECRET=your_client_secret
   COLIFLOWER_USERS=admin:$2y$05$REPLACE_WITH_REAL_HASH
   EOF
   chmod 600 .env
   ```

   Generate `COLIFLOWER_USERS` (basic auth for `/coliflower`) with:

   ```bash
   docker run --rm httpd:2.4-alpine htpasswd -nbB admin 'your-password'
   ```

   The `$` characters in the hash are safe in `.env` — Compose substitutes `${VAR}` references, and
   the value itself is used literally.

4. Build and start:

   ```bash
   docker compose up -d --build
   ```

   Expected tail: `Container starchive-webapp  Started`.

5. Verify:

   ```bash
   docker ps --filter name=starchive-webapp           # status "Up"
   curl -sI https://webapp.streambox.space | head -3  # 200 + valid certificate
   curl -s https://webapp.streambox.space/api/live    # JSON array
   ```

   Traefik requests the Let's Encrypt certificate automatically on first request (HTTP challenge),
   so allow a few seconds on a fresh domain.

6. Redeploy after a change:

   ```bash
   cd /docker/starchive-webapp
   git pull
   docker compose up -d --build
   ```

7. Operations:

   ```bash
   docker compose logs -f --tail=100 starchive-webapp   # logs
   docker compose restart starchive-webapp              # restart, no rebuild
   docker compose down                                  # stop and remove
   ```

**Gotchas learned the hard way:**

- Do **not** add a `traefik` service to this compose file — the host already runs one, and a second
  instance crash-loops fighting for ports 80/443.
- The compose file must define the `webapp` service with `container_name: starchive-webapp`; without it
  `docker compose up --build` rebuilds nothing and deploys appear to succeed while the site stays old.
- `DJ_SOCIALS_PATH=/app/data/dj-socials.json` writes into the mounted `./data` volume, so edits made in
  `/coliflower` survive redeploys. Keep that volume mounted.
- `avatars.json` is refreshed daily by a job that commits, pushes and triggers a redeploy; the API also
  resolves unknown artists live, so new DJs get artwork immediately.
