// admin/access.test.mjs — unit tests for Cloudflare Access JWT verification.
// Built-ins only; does not start any server.
import crypto from "crypto";
import { ACCESS_AUD, parseJwtUnsafe, verifyAccessJwt } from "./access.mjs";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  PASS: ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function signJwt(header, payload, privateKey) {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${h}.${p}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(data, "utf8"), privateKey);
  return `${data}.${signature.toString("base64url")}`;
}

function makeJwksFetcher(jwk, { kid } = {}) {
  return async (iss, requestedKid, { force } = {}) => {
    if (requestedKid === (kid || jwk.kid)) return jwk;
    return null;
  };
}

async function runTests() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "test-key-1";

  const fetcher = makeJwksFetcher(jwk);

  const baseHeader = { alg: "RS256", typ: "JWT", kid: jwk.kid };
  const basePayload = {
    aud: ACCESS_AUD,
    iss: "https://test.cloudflareaccess.com",
    email: "someone@example.com",
    exp: Math.floor(Date.now() / 1000) + 300,
    sub: "user-123",
  };

  console.log("\nPositive case");
  const validToken = signJwt(baseHeader, basePayload, privateKey);
  const validResult = await verifyAccessJwt(validToken, { jwksFetcher: fetcher });
  assert(validResult !== null, "valid token verifies");
  assertEqual(validResult.email, "someone@example.com", "email returned");
  assertEqual(validResult.sub, "user-123", "sub returned");
  assertEqual(validResult.iss, "https://test.cloudflareaccess.com", "iss returned");
  assertEqual(validResult.aud, ACCESS_AUD, "aud returned");

  console.log("\nNegative cases");

  const wrongAudToken = signJwt(
    baseHeader,
    { ...basePayload, aud: "wrong-audience" },
    privateKey
  );
  assert(
    (await verifyAccessJwt(wrongAudToken, { jwksFetcher: fetcher })) === null,
    "wrong aud fails"
  );

  const expiredPayload = {
    ...basePayload,
    exp: Math.floor(Date.now() / 1000) - 120,
  };
  const expiredToken = signJwt(baseHeader, expiredPayload, privateKey);
  assert(
    (await verifyAccessJwt(expiredToken, { jwksFetcher: fetcher })) === null,
    "expired exp fails"
  );

  const noneHeader = { alg: "none", typ: "JWT" };
  const nonePayload = { ...basePayload };
  const noneToken = `${Buffer.from(JSON.stringify(noneHeader)).toString("base64url")}.${Buffer.from(
    JSON.stringify(nonePayload)
  ).toString("base64url")}.`;
  assert(
    (await verifyAccessJwt(noneToken, { jwksFetcher: fetcher })) === null,
    "alg: none fails"
  );

  const unknownKidHeader = { ...baseHeader, kid: "unknown-kid" };
  const unknownKidToken = signJwt(unknownKidHeader, basePayload, privateKey);
  assert(
    (await verifyAccessJwt(unknownKidToken, { jwksFetcher: fetcher })) === null,
    "unknown kid fails"
  );

  const parts = validToken.split(".");
  parts[1] = Buffer.from(
    JSON.stringify({ ...basePayload, email: "evil@example.com" })
  ).toString("base64url");
  const tamperedToken = `${parts[0]}.${parts[1]}.${parts[2]}`;
  assert(
    (await verifyAccessJwt(tamperedToken, { jwksFetcher: fetcher })) === null,
    "tampered payload fails"
  );

  const evilIssPayload = { ...basePayload, iss: "https://evil.example.com" };
  const evilIssToken = signJwt(baseHeader, evilIssPayload, privateKey);
  assert(
    (await verifyAccessJwt(evilIssToken, { jwksFetcher: fetcher })) === null,
    "evil iss fails"
  );

  const missingEmailPayload = { ...basePayload };
  delete missingEmailPayload.email;
  const missingEmailToken = signJwt(baseHeader, missingEmailPayload, privateKey);
  assert(
    (await verifyAccessJwt(missingEmailToken, { jwksFetcher: fetcher })) === null,
    "missing email fails"
  );

  console.log("\nparseJwtUnsafe helper");
  const parsed = parseJwtUnsafe(validToken);
  assert(parsed !== null, "parseJwtUnsafe returns parsed token");
  assertEqual(parsed.header.alg, "RS256", "parseJwtUnsafe header alg");
  assertEqual(parsed.payload.email, "someone@example.com", "parseJwtUnsafe payload email");

  console.log("\n---");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
