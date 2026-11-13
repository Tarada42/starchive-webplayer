// admin/aggregate.test.mjs — unit tests for the aggregation module.
// Built-ins only; does not start any server.
import fs from "fs";
import path from "path";
import os from "os";
import { readEvents, popularity, traffic, liveStats, clampDays } from "./aggregate.mjs";

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

function assertDeep(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aggregate-test-"));
}

function writeLines(dir, subdir, date, lines, prefix = "") {
  const target = path.join(dir, subdir);
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, `${prefix}${date}.ndjson`), lines.join("\n") + "\n");
}

function runTests() {
  const tmp = makeTempDir();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  try {
    console.log("\nclampDays");
    assertEqual(clampDays(0), 1, "clamps 0 to 1");
    assertEqual(clampDays(-5), 1, "clamps negative to 1");
    assertEqual(clampDays(7), 7, "leaves 7 intact");
    assertEqual(clampDays(90), 90, "leaves 90 intact");
    assertEqual(clampDays(100), 90, "clamps 100 to 90");
    assertEqual(clampDays(NaN), 1, "clamps NaN to 1");

    console.log("\nreadEvents tolerates corrupt lines");
    writeLines(tmp, "events", today, [
      '{"type":"play","artist":"dj_one","track":"track_a","ts":"2026-01-01T00:00:00Z"}',
      "this is not json",
      '{"type":"favorite","artist":"dj_one","track":"","ts":"2026-01-01T00:01:00Z"}',
      '{"type":"live_play","artist":"dj_two","track":"","ts":"2026-01-01T00:02:00Z"}',
      '{"type":"page","artist":"","track":"/live","ts":"2026-01-01T00:03:00Z"}',
    ]);
    const events = readEvents(tmp, 1);
    assertEqual(events.length, 4, "parses 4 valid events");

    console.log("\npopularity ordering and scores");
    writeLines(tmp, "events", today, [
      '{"type":"play","artist":"dj_one","track":"track_a"}',
      '{"type":"play","artist":"dj_one","track":"track_a"}',
      '{"type":"play","artist":"dj_one","track":"track_b"}',
      '{"type":"favorite","artist":"dj_one"}',
      '{"type":"favorite","artist":"dj_one"}',
      '{"type":"play","artist":"dj_two","track":"track_c"}',
      '{"type":"live_play","artist":"dj_two"}',
    ]);
    const pop = popularity(tmp, 1);
    assertEqual(pop.days, 1, "popularity returns requested days");
    assertDeep(
      pop.totals,
      { plays: 4, favorites: 2, livePlays: 1, pages: 0 },
      "popularity totals are correct"
    );
    assertEqual(pop.artists.length, 2, "two artist entries");
    assertEqual(pop.artists[0].artist, "dj_one", "top artist by score");
    assertEqual(pop.artists[0].plays, 3, "dj_one plays");
    assertEqual(pop.artists[0].favorites, 2, "dj_one favorites");
    assertEqual(pop.artists[0].livePlays, 0, "dj_one livePlays");
    assertEqual(pop.artists[0].score, 9, "dj_one score = 3 + 6 + 0");
    assertEqual(pop.artists[1].artist, "dj_two", "second artist");
    assertEqual(pop.artists[1].score, 2, "dj_two score = 1 + 0 + 1");

    assertEqual(pop.tracks.length, 3, "three track entries");
    assertEqual(pop.tracks[0].track, "track_a", "top track");
    assertEqual(pop.tracks[0].plays, 2, "top track plays");

    console.log("\ntraffic day sums");
    writeLines(tmp, "metrics", today, [
      '{"minute":"2026-01-01T00:00","kind":"static","bytes":1024,"count":1}',
      '{"minute":"2026-01-01T00:00","kind":"api","bytes":512,"count":2}',
      '{"minute":"2026-01-01T00:01","kind":"stream","bytes":2048,"count":1}',
      '{"minute":"2026-01-01T00:01","kind":"page","bytes":256,"count":1}',
    ]);
    writeLines(tmp, "metrics", yesterday, [
      '{"minute":"2026-01-01T00:00","kind":"stream","bytes":4096,"count":2}',
    ]);
    const tr = traffic(tmp, 2);
    assertEqual(tr.days, 2, "traffic returns requested days");
    assertEqual(tr.daysList.length, 2, "traffic has one entry per day");
    assertEqual(tr.daysList[0].date, today, "newest day first");
    assertEqual(tr.daysList[0].total, 3840, "today total bytes");
    assertEqual(tr.daysList[0].stream, 2048, "today stream bytes");
    assertEqual(tr.daysList[1].total, 4096, "yesterday total bytes");
    assertEqual(tr.totals.total, 7936, "overall total bytes");

    console.log("\nlive peak/average and DJ minutes");
    // Production filename is listeners-YYYY-MM-DD.ndjson (byte metrics use the bare date).
    writeLines(tmp, "metrics", today, [
      '{"ts":"2026-01-01T00:00:00Z","total":5,"mounts":{"dj_one":3,"dj_two":2}}',
      '{"ts":"2026-01-01T00:01:00Z","total":8,"mounts":{"dj_one":5,"dj_two":3}}',
      '{"ts":"2026-01-01T00:02:00Z","total":4,"mounts":{"dj_one":4}}',
    ], "listeners-");
    const live = liveStats(tmp, 1);
    assertEqual(live.samples, 3, "three samples");
    assertEqual(live.peak.total, 8, "peak total listeners");
    assertEqual(live.average, (5 + 8 + 4) / 3, "average total listeners");
    assertEqual(live.djs.length, 2, "two DJs");
    assertEqual(live.djs[0].artist, "dj_one", "top DJ by peak");
    assertEqual(live.djs[0].minutes, 3, "dj_one minutes");
    assertEqual(live.djs[0].peak, 5, "dj_one peak");
    assertEqual(live.djs[1].artist, "dj_two", "second DJ");
    assertEqual(live.djs[1].minutes, 2, "dj_two minutes");
    assertEqual(live.byDay.length, 1, "one byDay entry");
    assertEqual(live.byDay[0].peak, 8, "byDay peak");

    console.log("\ndays clamping");
    const popClamped = popularity(tmp, 365);
    assertEqual(popClamped.days, 90, "popularity clamps days to 90");
    const liveClamped = liveStats(tmp, -3);
    assertEqual(liveClamped.days, 1, "live clamps days to 1");

    console.log("\nempty data");
    const emptyTmp = makeTempDir();
    const emptyPop = popularity(emptyTmp, 7);
    assertDeep(emptyPop.totals, { plays: 0, favorites: 0, livePlays: 0, pages: 0 }, "empty popularity totals");
    assertEqual(emptyPop.artists.length, 0, "empty popularity artists");
    const emptyTraffic = traffic(emptyTmp, 7);
    assertDeep(emptyTraffic.totals, { static: 0, api: 0, stream: 0, page: 0, total: 0 }, "empty traffic totals");
    const emptyLive = liveStats(emptyTmp, 7);
    assertEqual(emptyLive.samples, 0, "empty live samples");
    assertEqual(emptyLive.peak.total, 0, "empty live peak");
    assertEqual(emptyLive.djs.length, 0, "empty live djs");
    fs.rmSync(emptyTmp, { recursive: true, force: true });

    console.log("\n---");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  runTests();
} catch (err) {
  console.error("Test runner crashed:", err);
  process.exit(1);
}
