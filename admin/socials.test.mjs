// admin/socials.test.mjs — unit tests for the social-links editor helpers.
// Built-ins only; does not start any server.
import fs from "fs";
import os from "os";
import path from "path";
import {
  ALLOWED_SOCIAL_KEYS,
  isValidDjId,
  mergeDjList,
  mergeEditedSocials,
  normalizeDjId,
  readSocialsFile,
  sanitizeSocials,
  socialsPathFor,
  writeSocialsFile,
} from "./socials.mjs";

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
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${message} (expected ${e}, got ${a})`);
}

console.log("\nsanitizeSocials");
assertEqual(
  sanitizeSocials({ twitch: " https://www.twitch.tv/x ", website: "https://example.com" }),
  { twitch: "https://www.twitch.tv/x", website: "https://example.com" },
  "keeps and trims known http(s) keys"
);
assertEqual(sanitizeSocials({ twitch: "javascript:alert(1)" }), {}, "drops non-http(s) values");
assertEqual(sanitizeSocials({ twitch: "https://a.example/x\nInjected: yes" }), {}, "drops control characters");
assertEqual(sanitizeSocials({ evil: "https://example.com" }), {}, "drops unknown keys");
assertEqual(sanitizeSocials({ twitch: "" }), {}, "drops empty values");
assertEqual(sanitizeSocials(null), {}, "tolerates null");
assertEqual(sanitizeSocials([1, 2]), {}, "tolerates arrays");
assertEqual(
  sanitizeSocials({ website: "https://example.com/" + "a".repeat(400) }),
  {},
  "drops values over the length cap"
);
assertEqual(
  Object.keys(sanitizeSocials(Object.fromEntries(ALLOWED_SOCIAL_KEYS.map((k) => [k, "https://x.test"])))).length,
  ALLOWED_SOCIAL_KEYS.length,
  "accepts every allowed key"
);

console.log("\nisValidDjId / normalizeDjId");
assert(isValidDjId("thedjbigd"), "accepts a lowercase handle");
assert(isValidDjId("dj_ziyah_xo"), "accepts digits and underscores");
assert(!isValidDjId("DJ_BigD"), "rejects uppercase");
assert(!isValidDjId("dj-bigd"), "rejects hyphens");
assert(!isValidDjId("../admin"), "rejects path traversal");
assert(!isValidDjId(""), "rejects empty");
assert(!isValidDjId("a".repeat(65)), "rejects over-long ids");
assert(!isValidDjId(42), "rejects non-strings");
assertEqual(normalizeDjId("  THEdjBIGD "), "thedjbigd", "normalises case and whitespace");

console.log("\nread/write round trip");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starchive-socials-"));
const file = socialsPathFor(dir);
writeSocialsFile(file, { thedjbigd: { twitch: "https://www.twitch.tv/thedjbigd" } });
assert(fs.existsSync(file), "writeSocialsFile creates the file");
assertEqual(
  readSocialsFile(file),
  { thedjbigd: { twitch: "https://www.twitch.tv/thedjbigd" } },
  "readSocialsFile returns what was written"
);
writeSocialsFile(file, { thedjbigd: { twitter: "https://twitter.com/old", website: "https://ok.example" } });
assertEqual(
  readSocialsFile(file),
  { thedjbigd: { twitter: "https://twitter.com/old", website: "https://ok.example" } },
  "readSocialsFile preserves stored keys verbatim (no sanitising on read)"
);
fs.writeFileSync(file, "{ not json");
assertEqual(readSocialsFile(file), {}, "corrupt file degrades to an empty map");
fs.rmSync(dir, { recursive: true, force: true });

console.log("\nmergeDjList");
const merged = mergeDjList(
  [
    { id: "adamrackham", displayName: "Adam Rackham" },
    { id: "thedjbigd", displayName: "The DJ Big D" },
    { id: "adamrackham", displayName: "Duplicate" },
  ],
  { thedjbigd: { twitch: "https://www.twitch.tv/thedjbigd" }, ghostdj: {} }
);
assertEqual(merged.map((r) => r.id), ["adamrackham", "ghostdj", "thedjbigd"], "sorts, de-dupes and keeps orphan overrides");
assertEqual(merged.find((r) => r.id === "thedjbigd").socials, { twitch: "https://www.twitch.tv/thedjbigd" }, "attaches socials");
assertEqual(merged.find((r) => r.id === "adamrackham").socials, {}, "artist without socials gets an empty object");
assertEqual(mergeDjList(null, {}), [], "tolerates a null artist list");

console.log("\nmergeEditedSocials");
assertEqual(
  mergeEditedSocials(
    { twitter: "https://twitter.com/legacy", website: "https://old.example", custom: "keep-me" },
    { website: "https://new.example" }
  ),
  { twitter: "https://twitter.com/legacy", website: "https://new.example", custom: "keep-me" },
  "preserves legacy and unknown keys, replaces edited ones"
);
assertEqual(
  mergeEditedSocials({ twitch: "https://www.twitch.tv/x", custom: "keep" }, {}),
  { custom: "keep" },
  "clears keys the editor emptied but keeps unmanaged ones"
);
assertEqual(mergeEditedSocials(null, { website: "https://x.test" }), { website: "https://x.test" }, "handles a missing entry");
assertEqual(mergeEditedSocials({ a: 1 }, {}), { a: 1 }, "never drops keys the editor does not manage");

console.log("\ntwitter/x alias");
assert(sanitizeSocials({ twitter: "https://twitter.com/legacy" }).twitter === "https://twitter.com/legacy", "accepts the legacy twitter key");

console.log(`\n---\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
