# ADMIN PHASE 2 — anonymous beacons + real dashboards

Goal: fill the three placeholder screens (Popularity, Live, Traffic) with real data collected
anonymously from the public site. No cookies, no IPs, no personal data — only event counts.

## A. Client beacons — `artist-extras.js` (already loaded on every page)

Add a small beacon module. Requirements:

1. **Session id**: random 16-byte hex, stored in `sessionStorage` under `starchive_sid` (per tab).
2. **Sender**: `navigator.sendBeacon("/api/events", blob)` with `content-type: application/json`;
   fall back to `fetch(..., {keepalive: true})`. Never throw, never block the UI.
3. **play / live_play**: capture-phase listener on `document` for `play` events.
   - `src` like `https://starchive.streambox.space/<artist>/<file>.mp4` → `{type:"play", artist, track:file}`
   - `src` like `/stream/<dj>` or `https://.../stream/<dj>` → `{type:"live_play", artist: dj}`
   - Ignore anything else. De-duplicate identical events fired within 2 seconds.
4. **favorite / unfavorite**: click listener on `button.fav-btn`.
   - Artist: nearest `.artist-card img[alt]`, else `.artist-hero-name` text (strip any `.ax-tribute` span), else skip.
   - Action: button `title` containing "Remove" → `unfavorite`, otherwise `favorite`.
5. **page**: on load and on SPA navigation (wrap `history.pushState`/`replaceState` and listen to
   `popstate`) → `{type:"page", track: location.pathname}` (max one per path per 5 s).
6. All payloads must match the existing `/api/events` contract: `type`, `artist`, `track`, `sid`
   (strings ≤100 chars). The server already validates and rate-limits.

## B. Listener sampler — `server.mjs`

Every 60 seconds (and once ~15 s after boot), fetch `https://live.streambox.space/` with a 5 s
timeout, parse each mount section for:
- mount id (`Mountpoint <code>/name</code>`, strip a trailing `_hq`)
- `Listeners (current):` value

Deduplicate `_hq`/base pairs by keeping the max. Append one NDJSON line per sample to
`data/metrics/listeners-YYYY-MM-DD.ndjson`:
`{"ts":"ISO","total":N,"mounts":{"<dj>":n,...}}`
Skip silently on fetch/parse failure (never crash the process). Do not count excluded DJs
(`live-excluded.json`).

## C. Aggregation — `admin/aggregate.mjs` (new, pure functions + a tiny NDJSON reader)

```js
readEvents(dataDir, days) -> [{type, artist, track, ts}]
popularity(dataDir, days) -> {
  days, totals:{plays,favorites,livePlays,pages},
  artists:[{artist, plays, favorites, livePlays, score}],   // score = plays + favorites*3 + livePlays
  tracks:[{artist, track, plays}]
}
traffic(dataDir, days) -> {
  days, daysList:[{date, static, api, stream, page, total}],
  totals:{static,api,stream,page,total}
}
liveStats(dataDir, days) -> {
  days, samples, peak:{total, ts}, average, byDay:[{date, peak, average}],
  djs:[{artist, minutes, peak}]     // minutes = samples where present (1 sample ≈ 1 min)
}
```
Rules: tolerate missing/corrupt lines; `days` clamped to 1..90; newest first for lists;
deterministic ordering (score desc, then name asc).

## D. Admin endpoints — `admin/server.mjs`

All behind the existing auth (Cloudflare JWT). Validate `days` as an integer 1..90, default 7.
- `GET /api/admin/popularity?days=7`
- `GET /api/admin/traffic?days=7`
- `GET /api/admin/live?days=7`
Return the objects above. Errors → 500 with a generic message, never a stack.

## E. Admin UI — `admin/index.html`, `admin/app.js`, `admin/admin.css`

Replace the three placeholder pages. Keep the existing dark shell, sidebar and typography.

- **Popularity**: 4 stat cards (plays, favourites, live plays, pages) + two tables:
  "Top DJs" (rank, DJ, plays, favourites, live plays, score) and "Top tracks" (rank, DJ, track, plays).
  A 7/30/90-day selector in the header of the page.
- **Live**: stat cards (peak listeners, average, samples) + a simple inline SVG sparkline of
  concurrent listeners over the period + a table "Live minutes by DJ" (DJ, minutes, peak).
- **Traffic**: stat cards (total bytes, stream bytes, static bytes, API bytes) + a per-day table
  (date, stream, static, API, pages, total) with human-readable sizes (KiB/MiB/GiB).

Tables: sticky header, right-aligned numbers, muted gridlines, max ~8 columns, empty state
("No data collected yet — beacons start recording after the next deploy").

## F. Tests — `admin/aggregate.test.mjs`

Fixture NDJSON written to a temp dir; assert: popularity ordering and scores, track aggregation,
traffic day sums, live peak/average, corrupt-line tolerance, `days` clamping. Exit non-zero on failure.

## Constraints
- Node built-ins + express only. No chart libraries, no external fonts.
- English (US) only.
- Never start a server in the foreground; verify with `node --check` and the test scripts only.
- Do not touch the public API handlers or the existing auth code.
