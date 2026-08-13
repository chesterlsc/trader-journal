// THE NEWS EDGE — coverage volume, and the gate that stops it becoming advice.
//
// WHAT IS MEASURED: how much of the world's monitored English press is
// publishing on a fixed query right now, against how much it published over the
// last seven days. That is a COVERAGE VOLUME RATIO. It is not price, it is not
// sentiment, and it is not causation. A spike is a headline count.
//
// NOT A TRANSCRIPT, and it cannot be. The wall's monitors are cross-origin
// YouTube iframes: a parent page cannot read their audio, their caption track,
// their MediaStream or their DOM, no browser API grants it, and the server-side
// path means re-encoding the broadcast, which contradicts the wall's own
// "nothing is stored or rebroadcast" promise. Text coverage is the honest
// substitute and it is the better one, because it is countable.
import { EDGE_MIN_VERDICT } from "./eventEdge.js";

// 48 complete hourly buckets = two days. Under that, a "7 day median" is a
// comparison against a weekend.
export const NEWS_MIN_POINTS = 48;

// MEASURED, and measured on the query this code actually sends. That
// qualification is the whole point: an earlier calibration of these constants
// was taken from a bare "gold" timeline, and the conjunctive query in
// api/_lib/newsvol.js is far more selective, so its hourly share is much
// noisier and its distribution much wider. Carried across, 1.60 as "the 90th
// percentile" fired on 24% of hours and 2.00 as "the 99th" on 13% — which is
// precisely the "that is not elevated, that is Tuesday" failure the thresholds
// exist to avoid, reintroduced by calibrating against the wrong series.
//
// Recomputed from tests/fixtures/gdelt-gold.json, the live conjunctive-query
// capture for 2026-08-06T00:00Z .. 2026-08-12T23:00Z, 167 raw points, 166
// complete, 164 rolling readings:
//
//   p5=0.41  p10=0.49  p25=0.74  p50=1.09  p75=1.53  p90=2.30  p95=2.60  p99=3.44
//
// So 2.30 is the 90th percentile and 3.44 the 99th, and they fire on 10% and 1%
// of hours respectively. QUIET_BELOW stays where it was, now with backing it
// did not have before: p25 measures 0.74.
//
// GOLD ONLY. Every capture of the bitcoin conjunctive query returned GDELT's
// throttle message rather than JSON, so bitcoin runs on gold's numbers and is
// UNCALIBRATED. Its own distribution will differ; a sibling capture of a
// different gold query measured p90=2.54 against gold's 2.30, so the gap is
// real and not negligible. Recalibrate per asset once the cron has banked a
// week of its own readings.
export const QUIET_BELOW = 0.75;
export const ELEVATED_AT = 2.3;
export const HEAVY_AT = 3.45;

/** "20260812T210000Z" -> epoch ms. Null for anything else. */
export function parseGdeltStamp(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(stamp ?? ""));
  return m === null
    ? null
    : Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** GDELT timelinevol JSON -> [{at, value}]. Never throws. */
export function parseTimeline(json) {
  const data = json?.timeline?.[0]?.data;
  if (!Array.isArray(data)) return [];
  const points = [];
  for (const row of data) {
    const at = parseGdeltStamp(row?.date);
    const value = Number(row?.value);
    if (at !== null && Number.isFinite(value)) points.push({ at, value });
  }
  return points;
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The coverage reading: the last 3 COMPLETE hours over the window median.
 *
 * THE TRAILING BUCKET IS DROPPED, always, because it is a partial hour. The
 * reason matters and it is the opposite of the obvious one: `value` is a SHARE
 * of all monitored coverage, so a thin partial hour does not read as a
 * collapse, it reads as a SPIKE.
 *
 * Measured across four distinct captures, the trailing bucket ran 2.60x, 1.74x,
 * 2.98x and 2.60x the previous complete hour. Four, not the five it looks like:
 * two of the files hold byte-identical series. Every one of them inflated, none
 * deflated, so one dropped point out of 167 is the cheapest guard in the file.
 *
 * What is NOT claimed, because it did not reproduce: an earlier version of this
 * comment said keeping the bucket printed "1.79x on a market whose real reading
 * was 0.60x". Under the formula below, keeping it moves the worst capture from
 * 1.01 to 1.29 and the shipped one from 1.29 to 1.09. The direction of the
 * artefact is real and verified; those particular magnitudes were not.
 *
 * The MEDIAN, not the mean: the measured sd/mean on the shipped gold query is
 * 0.752, and on a distribution that skewed the mean is dragged upward by the
 * very spikes it is supposed to be a baseline for.
 */
export function coverageRead(points) {
  const complete = (Array.isArray(points) ? points : []).slice(0, -1);
  if (complete.length < NEWS_MIN_POINTS) {
    return { n: complete.length, base: 0, now: 0, ratio: null, band: "unknown", through: null };
  }
  const values = complete.map((p) => p.value);
  const base = median(values);
  const now = values.slice(-3).reduce((sum, v) => sum + v, 0) / 3;
  return {
    n: complete.length,
    base,
    now,
    // A query nobody covers is a divide by nothing, not an infinite spike.
    ratio: base > 0 ? now / base : null,
    band: bandFor(base > 0 ? now / base : null),
    through: new Date(complete[complete.length - 1].at).toISOString(),
  };
}

export function bandFor(ratio) {
  if (ratio === null || !Number.isFinite(ratio)) return "unknown";
  if (ratio >= HEAVY_AT) return "heavy";
  if (ratio >= ELEVATED_AT) return "elevated";
  if (ratio < QUIET_BELOW) return "quiet";
  return "normal";
}

const isUp = (band) => band === "elevated" || band === "heavy";

/**
 * THE FUSION, and the gate.
 *
 * A STANCE NEEDS BOTH HALVES, and the gate lives here so a renderer physically
 * cannot bypass it: coverage must be elevated or heavy AND eventFile().verdict
 * must be non-empty. `verdict` is already "" below EDGE_MIN_VERDICT prints, so
 * either half short of its own threshold means no call — and no call is by far
 * the common case.
 *
 * NO COMPOSITE SCORE, permanently. Blending a coverage ratio with a win rate
 * would produce a fabricated quantity wearing a decimal point. Coverage is
 * stated, the record is stated, and the only synthesis is this three-valued
 * stance.
 *
 * @param {{label, coverage, file, event}} input  `file` is eventFile() output
 *        or null; `event` is the next USD release or null.
 */
export function newsVerdict({ label, coverage, file, event }) {
  const loud = isUp(coverage?.band);
  const stance =
    loud && file?.verdict === "worse" ? "stand-down"
    : loud && file?.verdict === "better" ? "your-window"
    : "";
  return { stance, line: newsLine({ label, coverage, file, event, stance }) };
}

/**
 * The sentence, built HERE for the reason eventEdge.js builds its own: if this
 * copy lived in the renderer, someone would eventually write "gold is about to
 * move" over a headline count. Every branch states a measurement and stops.
 */
export function newsLine({ label, coverage, file, event, stance }) {
  const name = label || "This asset";
  if (!coverage || coverage.ratio === null) {
    return `${name}: no coverage reading. Needs ${NEWS_MIN_POINTS} complete hourly buckets, has ${coverage?.n ?? 0}.`;
  }
  const x = `${coverage.ratio.toFixed(2)}x its 7 day hourly median over ${coverage.n} buckets`;
  if (!isUp(coverage.band)) {
    return `${name}: coverage ${x}. ${
      coverage.band === "quiet" ? "Quiet" : "Normal"
    }, so there is nothing to read into it.`;
  }
  if (!event || !file) {
    return `${name}: coverage ${x}. No USD release ahead to file it against.`;
  }
  if (stance === "stand-down") {
    return `${name}: coverage ${x}. Your file into ${event.title} is ${file.samples} prints, ${file.wins}W/${file.losses}L, and measurably worse than your own average.`;
  }
  if (stance === "your-window") {
    return `${name}: coverage ${x}. Your file into ${event.title} is ${file.samples} prints, ${file.wins}W/${file.losses}L, and measurably better than your own average.`;
  }
  if (file.samples === 0) {
    return `${name}: coverage ${x}. You have no file on ${event.title}, so there is no call to make.`;
  }
  return `${name}: coverage ${x}. Your file into ${event.title} is ${file.samples} prints, under the ${EDGE_MIN_VERDICT} a verdict needs.`;
}