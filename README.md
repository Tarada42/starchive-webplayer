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

## Run locally

```bash
npm install
PORT=8080 node server.mjs
```

## Deploy (Hostinger VPS)

```bash
cd /docker/starchive-webapp && git pull && docker compose up -d --build
```

Environment: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `COLIFLOWER_USERS` (kept in the server-side `.env`).
