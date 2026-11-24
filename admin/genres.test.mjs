// admin/genres.test.mjs — unit tests for genre validation, overrides and merging.
import fs from "fs";
import os from "os";
import path from "path";
import {
  MAX_GENRES_PER_DJ,
  genreVocabulary,
  isValidGenreName,
  mergeGenres,
  overridesPathFor,
  readOverrides,
  sanitizeGenres,
  writeOverrides,
} from "./genres.mjs";

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

console.log("\nisValidGenreName");
assert(isValidGenreName("Drum & Bass"), "accepts an ampersand");
assert(isValidGenreName("Retro / 80s-90s"), "accepts slashes and digits");
assert(isValidGenreName("UK Garage"), "accepts spaces");
assert(!isValidGenreName(""), "rejects empty");
assert(!isValidGenreName("   "), "rejects whitespace");
assert(!isValidGenreName("<script>"), "rejects markup");
assert(!isValidGenreName("a".repeat(41)), "rejects over-long names");
assert(isValidGenreName(" leading space"), "tolerates surrounding whitespace (values are trimmed)");
assert(!isValidGenreName(null), "rejects non-strings");

console.log("\nsanitizeGenres");
assertEqual(sanitizeGenres(["Trance", "trance", " Techno "]), ["Trance", "Techno"], "dedupes case-insensitively and trims");
assertEqual(sanitizeGenres(["House", "bad<script>", "Disco"]), ["House", "Disco"], "drops invalid entries, keeps the rest");
assertEqual(sanitizeGenres("House"), [], "rejects non-arrays");
assertEqual(sanitizeGenres(Array.from({ length: 10 }, (_, i) => `Genre${i}`)).length, MAX_GENRES_PER_DJ, "caps the list length");

console.log("\noverrides round trip");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starchive-genres-"));
const file = overridesPathFor(dir);
writeOverrides(file, { thedjbigd: { genres: ["Progressive House"], updatedAt: "2026-11-24T10:00:00Z", by: "nikolaj" } });
const back = readOverrides(file);
assertEqual(back.thedjbigd.genres, ["Progressive House"], "writes and reads an override");
assertEqual(back.thedjbigd.by, "nikolaj", "keeps the attribution");
writeOverrides(file, { bad: { genres: [] } });
assertEqual(readOverrides(file), {}, "an empty genre list is not stored");
fs.writeFileSync(file, "{ nope");
assertEqual(readOverrides(file), {}, "a corrupt file degrades to no overrides");
fs.rmSync(dir, { recursive: true, force: true });

console.log("\nmergeGenres");
const base = {
  generatedAt: "2026-11-13T00:00:00Z",
  artists: {
    thedjbigd: { genres: ["Progressive House", "House"], scores: { "Progressive House": 3 }, source: "twitch-tags", tags: ["x"] },
    adamrackham: { genres: ["Techno"], scores: { Techno: 3 }, source: "twitch-tags" },
    quietdj: { genres: [], scores: {}, source: "none" },
  },
};
const merged = mergeGenres(base, {
  adamrackham: { genres: ["Trance", "Techno"], updatedAt: "2026-11-24T10:00:00Z", by: "nikolaj" },
  quietdj: { genres: ["Ambient"], updatedAt: "", by: "" },
});
assertEqual(merged.artists.adamrackham.genres, ["Trance", "Techno"], "override wins over auto tags");
assertEqual(merged.artists.adamrackham.source, "manual", "overridden entries are marked manual");
assertEqual(merged.artists.thedjbigd.genres, ["Progressive House", "House"], "untouched DJs keep their auto genres");
assertEqual(merged.artists.thedjbigd.source, "twitch-tags", "untouched DJs keep their source");
assertEqual(merged.artists.quietdj.genres, ["Ambient"], "an untagged DJ can be tagged");
assertEqual(merged.generatedAt, "2026-11-13T00:00:00Z", "top-level metadata is preserved");
assert(merged.artists.adamrackham.tags === undefined || Array.isArray(merged.artists.adamrackham.tags), "no crash when tags are absent");

console.log("\ngenreVocabulary");
const vocab = genreVocabulary(base, { adamrackham: { genres: ["Trance"] } });
assert(vocab.some((g) => g.name === "Progressive House" && g.count === 1), "counts genres from the base");
assert(vocab.some((g) => g.name === "Trance" && g.count === 1), "counts genres from overrides");
assertEqual(vocab[0].count, 1, "counts are equal for single-use genres");
assert(vocab.findIndex((g) => g.name === "House") < vocab.findIndex((g) => g.name === "Trance"), "ties are ordered alphabetically");

console.log(`\n---\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);