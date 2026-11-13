# STArchive webapp-copy — self-hosted (replaces Vercel).
# Serves static files + the /api handlers as one Node process.
# Designed to be run behind Traefik (auto TLS via labels on the host).
FROM node:22-alpine

WORKDIR /app

# deps first for caching
COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

# app code
COPY server.mjs ./
COPY index.html live.html privacy.html manifest.json manifest.webmanifest favicon.svg registerSW.js shim.js sw.js admin.html artist-extras.js ./
COPY video_playback.mp4 ./
COPY assets ./assets
COPY icon-192.png icon-32.png icon-512.png apple-touch-icon.png ./
COPY api ./api
COPY avatars.json hidden.json dj-socials.json dad-jokes.json live-excluded.json genres.json genre-overrides.json artist-sources.json ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]