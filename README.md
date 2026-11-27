# STArchive webplayer

Self-hosted web player for the STArchive archive: static pages plus a small
Express server that proxies the Icecast live stream and reads the archive
listings.

## Layout

- `index.html`, `live.html`, `privacy.html` — pages (the React source is gone;
  features are injected by `artist-extras.js`)
- `server.mjs` — Express server: static files, the `/api/*` routes, the
  `/stream/:dj` relay, and the guard that keeps private paths private
- `api/*.js` — request handlers
- `admin/` — admin app, served only by its own listener (never on the public port)
- `data/` — runtime state, mounted as a volume, never served over HTTP

## Deploy

Pushes to `main` deploy automatically within 15 minutes: a watcher on the
Hermes host reads `origin/main` with a single `git ls-remote`, and when the SHA
changes it opens the command-locked deploy account (which runs
`git pull && docker compose up -d --build` on the web host) and then verifies
the live site from the outside.

Manual deploy, from the web host:

```bash
cd /docker/starchive-webapp && git pull && docker compose up -d --build
```

## Invariants

- `webapp.streambox.space` serves the public app only. `/data`, `/admin`,
  `/node_modules`, `package*.json`, `server.mjs` and the `api/*.js` sources must
  return 404 there.
- Never commit secrets. Twitch and session credentials live in the deploy
  environment, not in this repository.
