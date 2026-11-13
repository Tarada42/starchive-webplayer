# ADMIN PHASE 1b — trust Cloudflare Access identity (remove the second login)

Goal: the admin no longer asks for a password. Identity comes from Cloudflare Access's
signed JWT, which Cloudflare injects on every request it proxies. The app verifies that
token cryptographically and uses the `email` claim as the user.

AUD tag (already issued for this application): `da6c3d8265d3e9ca3788406c3e3dfcc88819bd46c9643aa2d8e9d07cdcc6b249`

## Files

### NEW `admin/access.mjs`

```js
export async function verifyAccessJwt(token, { jwksFetcher }) -> { email, sub, iss, aud } | null
```

Rules (fail closed — any failure returns null):
1. Token must have exactly 3 dot-separated segments; decode base64url JSON.
2. Header `alg` must be `RS256`; header `kid` must be a non-empty string.
3. Payload `aud` must equal the configured AUD exactly (compare the string, or any element
   if `aud` is an array).
4. Payload `iss` must match `^https://[a-z0-9-]+\.cloudflareaccess\.com$` (no trailing slash).
5. `exp` must be a number and greater than now - 60s. `nbf`, if present, must be <= now + 60s.
6. `email` must be a non-empty string containing `@`.
7. Signature: fetch `iss + "/cdn-cgi/access/certs"`, take the JWK whose `kid` matches, build a
   public key with `crypto.createPublicKey({ key: jwk, format: "jwk" })`, and verify
   `RSA-SHA256` over `header.payload` with `crypto.verify`.
8. Cache the JWKS per issuer for 60 minutes; on verification failure, refetch once (key rotation).

Also export `const ACCESS_AUD` (the value above) and `parseJwtUnsafe(token)` for tests.

### NEW `admin/access-config.json`
```json
{ "aud": "da6c3d8265d3e9ca3788406c3e3dfcc88819bd46c9643aa2d8e9d07cdcc6b249", "issuer": null }
```
`issuer` starts null and is **pinned on the first successful verification** (written to
`data/access-issuer.json`, not to this file — the repo file stays read-only config).

### MODIFY `admin/server.mjs`

1. Before any route: if the request has header `cf-access-jwt-assertion`, verify it.
   - Valid → `req.accessEmail = email`.
   - Invalid → respond 401 JSON for `/api/*`, otherwise plain 403 text "Cloudflare identity rejected".
2. Auto-session: if `req.accessEmail` and there is no valid session, create one
   (`sid` cookie signed as today, `user` = the email, `csrf` random) so CSRF keeps working.
   Store sessions keyed by the signed sid as now.
3. `GET /api/admin/me` returns `{ user: <email>, csrf }`.
4. Password login (`POST /login`) must return **403 unless** env `ALLOW_PASSWORD_LOGIN` is
   exactly `"1"` (break-glass). `GET /login` still serves the shell.
5. Any request to the admin without a valid Cloudflare token AND without a valid session must
   be refused: 401 for `/api/*`, 403 text otherwise. (The session cookie alone must not be
   enough if the Cloudflare token is absent and password login is disabled — this keeps the
   Cloudflare gate authoritative.)
6. Keep the existing security headers, rate limits, and CSP.

### MODIFY `admin/app.js` + `admin/index.html`
- On load call `/api/admin/me`; if it succeeds, render the dashboard (no login form).
- If it returns 401, show a card: "Cloudflare session not detected — reload this page from
  https://webappadmin.perker.dk" (no password fields when password login is disabled).
- Keep the login form in the DOM but only show it if the server says password login is enabled:
  add `passwordLogin: true|false` to `/api/admin/me` (false by default).

## Security requirements (judge will check)
- No path where a request is authenticated without a valid, verified JWT (or the explicit
  break-glass flag).
- `aud` compared exactly; issuer pinned after first use; signature verified with the key whose
  `kid` matches; no `alg: none`, no `HS256` acceptance.
- JWKS fetched only over https from a `*.cloudflareaccess.com` host derived from the *validated*
  `iss` (never from a query parameter or header the client controls).
- Failures never leak the reason beyond a generic message.
- No secrets in client code.

## Verification (no servers in the foreground)
Write a self-contained test script `admin/access.test.mjs` (node built-ins only) that:
1. Generates an RSA keypair with `crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })`.
2. Exports the public key as JWK (`publicKey.export({ format: "jwk" })`), adds `kid`.
3. Signs a token with `aud` = ACCESS_AUD, `iss` = `https://test.cloudflareaccess.com`,
   `email` = `someone@example.com`, `exp` = now + 300.
4. Verifies it with an injected `jwksFetcher` returning that JWK → must pass.
5. Asserts these all fail: wrong `aud`; expired `exp`; `alg: none`; unknown `kid`; tampered
   payload; `iss` = `https://evil.example.com`; missing email.
Run it with `node admin/access.test.mjs` and make it exit non-zero on any failure.
