# LIVE PLAYER — stall recovery, single-stream, explicit STOP

## Diagnosis (already established)
- `GET /stream/<dj>` on the server streams continuously: measured 300 s with no stall, ~33 KiB/s,
  `audio/mpeg`, no Content-Length (chunked). The direct Icecast `_hq` mount behaves the same.
- Therefore the 1:30–2:10 stop is client-side: the page creates `<audio controls preload="none">`
  per card and does nothing on `stalled` / `waiting` / `error` / `ended`, so once playback stops it
  never recovers without a reload.
- `pause()` keeps the connection and buffer alive; there is no way to tear a stream down.
- Reloading can leave the previous (iframe) page's audio running while the new page starts another
  stream — two sessions at once.

## Changes — all in `live.html` only

### 1. One stream at a time
Keep a module-level `activeAudio`. Starting a card calls `stopCard()` on any other card first.

### 2. Explicit STOP (not pause)
Each card gets a **Stop** button next to the player (visible while that card is playing or
reconnecting). Stopping must:
1. `audio.pause()`
2. `audio.removeAttribute("src"); audio.load();`  ← aborts the network request
3. reset the card UI to its idle state ("Play")
4. clear the watchdog timer and the reconnect attempt counter
Stop must not resume on its own afterwards.

### 3. Stall watchdog + auto-recovery
While a card is meant to be playing:
- sample `audio.currentTime` every 2 s; if it has not advanced for **6 s**, treat it as stalled.
- also react to `stalled`, `waiting` (only if no progress for 6 s), `error`, and `ended`.
- recovery: `stopCard()` then reconnect the same card with `src = "/stream/<dj>?r=" + Date.now()`
  (cache-buster), after 300 ms, 900 ms, 2000 ms; give up after 3 attempts and show
  "Stream unavailable — press Play to retry".
- do not fight the user: if the user pressed Stop or paused, never auto-reconnect.

### 4. Teardown on unload
`pagehide` and `beforeunload` → `stopCard(activeAudio)`. This prevents an orphaned stream when the
SPA removes or replaces the Live iframe.

### 5. Status text
Small line under the player showing one of: `Playing`, `Reconnecting… (1/3)`, `Stopped`,
`Stream unavailable`. Keep it subtle (`.status-text`, muted, 0.75 rem).

### 6. Telemetry (diagnostic, optional but wanted)
When a stall triggers a reconnect, send one beacon `{"type":"stream_stall","artist":"<dj>","track":"<reason>"}`
where reason is one of `stalled|waiting|error|ended`. `/api/events` must accept the new type
`stream_stall` — add it to the allowlist in `server.mjs` only.

## Constraints
- Only touch `live.html` and the allowlist line in `server.mjs`. No other files.
- No new dependencies. English (US) in code and UI strings.
- The existing card layout, genre/live polling, chat link and modal must keep working.
- Never run a server in the foreground; verify with `node --check` where applicable and by reading
  the file. Do not commit or deploy.
