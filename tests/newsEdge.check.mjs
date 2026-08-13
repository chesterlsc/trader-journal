// The only non-trivial logic here is coverageRead and the stance gate. If
// coverageRead breaks, every ratio on the pane is wrong and nothing else would
// notice; if the gate breaks, the desk issues advice off four trades.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseTimeline, coverageRead, bandFor, median, newsVerdict, newsLine,
  NEWS_MIN_POINTS, ELEVATED_AT, HEAVY_AT
} from "../src/lib/newsEdge.js";

assert.equal(median([]), 0);
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 3, 2]), 2.5);

// 1-2. The real capture: the live conjunctive gold query, HTTP 200, covering
//      2026-08-06T00:00Z .. 2026-08-12T23:00Z. 167 raw points, so 166 complete.
//      Every number asserted here was computed FROM this file, not chosen for
//      it: an earlier version of this test asserted n=165 and ratio=1.02
//      against a capture that was never taken.
const raw = parseTimeline(
  JSON.parse(readFileSync(new URL("./fixtures/gdelt-gold.json", import.meta.url)))
);
assert.equal(raw.length, 167, "fixture shape changed; recompute every constant below");

const gold = coverageRead(raw);
assert.equal(gold.n, 166, "the trailing partial bucket must be dropped");
assert.ok(Math.abs(gold.ratio - 1.287) < 0.005, `gold ratio ${gold.ratio}`);
assert.equal(gold.band, "normal");

// 3. THE LOAD-BEARING ONE. The trailing bucket is INFLATED, not depressed. On
//    this capture it is 2.60x the previous complete hour; across the four
//    distinct captures taken it ran 1.74x to 2.98x and never once deflated.
assert.ok(
  raw[raw.length - 1].value > raw[raw.length - 2].value,
  "fixture must still exhibit the inflated trailing bucket this guard exists for"
);
assert.ok(
  raw[raw.length - 1].value / raw[raw.length - 2].value > 2.5,
  "this capture's trailing bucket measured 2.60x the previous hour"
);

// 3b. THE CALIBRATION IS THE POINT, so it is asserted rather than trusted. The
//     thresholds are percentiles of THIS query's own distribution, and the
//     previous constants (1.6 / 2.0) were percentiles of a different, less
//     selective query. Carried across they fired on 24% and 13% of hours, so
//     "elevated" would have meant an ordinary Tuesday. If a future edit
//     reintroduces that, this fails.
const complete = raw.slice(0, -1).map((p) => p.value);
const base = median(complete);
const rolling = [];
for (let i = 2; i < complete.length; i += 1) {
  rolling.push((complete[i - 2] + complete[i - 1] + complete[i]) / 3 / base);
}
const shareAtOrAbove = (t) => rolling.filter((r) => r >= t).length / rolling.length;
assert.ok(
  Math.abs(shareAtOrAbove(ELEVATED_AT) - 0.1) < 0.02,
  `ELEVATED_AT must sit at the 90th percentile, fires on ${(shareAtOrAbove(ELEVATED_AT) * 100).toFixed(0)}%`
);
assert.ok(
  shareAtOrAbove(HEAVY_AT) <= 0.02,
  `HEAVY_AT must sit at the 99th, fires on ${(shareAtOrAbove(HEAVY_AT) * 100).toFixed(0)}%`
);
assert.ok(shareAtOrAbove(1.6) > 0.2, "1.6 on this query is a quarter of all hours, not a spike");

// 4. Under the floor there is no ratio, and the empty state names the number.
assert.equal(coverageRead(raw.slice(0, 10)).ratio, null);
assert.match(
  newsLine({ label: "GOLD", coverage: coverageRead(raw.slice(0, 10)) }),
  new RegExp(`${NEWS_MIN_POINTS} complete hourly buckets`)
);

// 5. A dead query is null, never a 0/0 NaN rendered as a number.
const dead = coverageRead(Array.from({ length: 60 }, (_, i) => ({ at: i, value: 0 })));
assert.equal(dead.ratio, null);
assert.equal(dead.band, "unknown");

// 6. Bands are the measured percentiles.
assert.equal(bandFor(0.5), "quiet");
assert.equal(bandFor(1.25), "normal", "p50 is 1.09 on this query: 1.25x is an ordinary hour");
assert.equal(bandFor(1.6), "normal", "1.6 fires on 24% of hours here, so it is NOT elevated");
assert.equal(bandFor(2.3), "elevated", "p90");
assert.equal(bandFor(3.45), "heavy", "p99");

// 2.4 is above ELEVATED_AT (2.3) and below HEAVY_AT (3.45), so the band that
// goes with it is "elevated". It said "heavy" while the thresholds were the
// old ones; the gate treats both the same, but a fixture that disagrees with
// bandFor is a trap for whoever reads it next.
const hot = { ratio: 2.4, band: "elevated", n: 165 };
const event = { key: "78-us-cpi-mm", title: "CPI m/m" };

// 7. A spike with NO record issues NO stance, and promises nothing.
const none = newsVerdict({
  label: "GOLD", coverage: hot, event,
  file: { samples: 0, wins: 0, losses: 0, verdict: "" }
});
assert.equal(none.stance, "");
assert.doesNotMatch(none.line, /will|expect|because|caused|likely/i);

// 8. A spike plus a thin record still issues no stance.
assert.equal(
  newsVerdict({ label: "GOLD", coverage: hot, event,
    file: { samples: 9, wins: 6, losses: 3, verdict: "" } }).stance,
  ""
);

// 9. Quiet coverage issues no stance even with a 30-print "worse" verdict.
assert.equal(
  newsVerdict({ label: "GOLD", coverage: { ratio: 0.9, band: "normal", n: 165 }, event,
    file: { samples: 30, wins: 5, losses: 25, verdict: "worse" } }).stance,
  ""
);

// 10. The ONLY case that issues one: both halves clear their own threshold.
const call = newsVerdict({ label: "GOLD", coverage: hot, event,
  file: { samples: 14, wins: 4, losses: 10, verdict: "worse" } });
assert.equal(call.stance, "stand-down");
assert.match(call.line, /measurably worse than your own average/);

// 11. The denominator is always on screen.
assert.match(call.line, /over 165 buckets/);

// 12. No prose dash in any runtime-assembled line (tests/copyDashes covers
//     source, not the strings this file concatenates at runtime).
for (const line of [none.line, call.line, gold.band]) {
  assert.doesNotMatch(String(line), /[\w%)\]][ \t]*[—–][ \t]*[\w(\[$]/);
}

// 13. THE INGEST, against a fake db. Its three failure modes all end in a row
//     that says it has no reading, and none of them throw: GDELT answers a rate
//     limit with plain prose and HTTP 200, which is why the body is sniffed
//     rather than the status, and I hit that response on most attempts to
//     capture the bitcoin query.
const { fetchNewsVolume, oldestAsset } = await import("../api/_lib/newsvol.js");
const capture = readFileSync(new URL("./fixtures/gdelt-gold.json", import.meta.url), "utf8");
const fakeDb = (store) => ({
  reads: store,
  failures: [],
  successes: [],
  ensured: [],
  async ensureFeedSource(source) { this.ensured.push(source); },
  async readFeedPayload() { return this.reads; },
  async writeFeedPayload(source, payload) { this.reads = payload; },
  async claimFeedFetch() { return true; },
  async markFeedSuccess(source, status) { this.successes.push(status); },
  async markFeedFailure(source, status) { this.failures.push(status); },
});

const db1 = fakeDb(null);
const fed = await fetchNewsVolume(db1, async () => ({ ok: true, text: async () => capture }));
const goldRow = fed.assets.find((a) => a.id === "gold");
assert.ok(Math.abs(goldRow.ratio - 1.287) < 0.005, `ingest ratio ${goldRow.ratio}`);
assert.equal(goldRow.n, 166);
assert.deepEqual(db1.successes, ["ok:gold"]);
// The feed row is asserted before the claim, because the claim is an UPDATE and
// with no row it matches nothing: the feature would be dead and silent.
assert.deepEqual(db1.ensured, ["mw_headlines"]);
// The asset never read still gets a row, so the pane's two lines never reorder.
const btcRow = fed.assets.find((a) => a.id === "btc");
assert.equal(btcRow.ratio, null);
assert.equal(btcRow.band, "unknown");
assert.equal(btcRow.stale, true);
assert.equal(oldestAsset(db1.reads).id, "btc", "round robin must pull the one with no reading next");

// GDELT's throttle body is HTTP 200 with prose. Status alone would store junk.
const stored = JSON.stringify(db1.reads);
const throttled = await fetchNewsVolume(db1, async () => ({
  ok: true, text: async () => "Please limit requests to one every 5 seconds",
}));
assert.equal(JSON.stringify(db1.reads), stored, "a throttle reply must never overwrite a good reading");
assert.ok(db1.failures.includes("empty:btc"));
assert.equal(throttled.assets.length, 2);

// A hard network error is the same story: soft-fail, never throw.
const dead2 = await fetchNewsVolume(db1, async () => { throw new Error("ECONNRESET"); });
assert.equal(dead2.assets.length, 2);

console.log("newsEdge.check.mjs: OK — trailing bucket dropped, bands measured, stance gated, ingest soft-fails");