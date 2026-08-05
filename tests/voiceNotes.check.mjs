// Drives the REAL 1f #06 voice-note storage layer out of app.js (sliced by
// name, never copied). Recording itself needs a microphone and a browser; the
// part that can quietly destroy a journal is the STORAGE arithmetic, and that
// is pure and testable.
//
// What would rot silently here:
//   * the two ceilings drifting apart from the codec settings, so a clip that
//     the recorder is happy to produce is one the store refuses to hold — the
//     trader talks for a minute and is told "too big" at the end of it;
//   * the total-budget check forgetting to subtract the clip it is REPLACING,
//     which makes re-saving an unchanged trade fail once the journal is full;
//   * the data:audio/ scheme check going missing — voiceClipFor() is the only
//     thing between the clip store and three <audio src> assignments;
//   * a clip silently surviving the trade it belongs to, unreachable through
//     the UI and holding the budget hostage forever;
//   * the clip store leaking into the server sync payload, which is the whole
//     reason it is a separate key.
//
// Run: node tests/voiceNotes.check.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { readStorageJson } from "../src/lib/core.js";

const appSrc = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function takeFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, `unterminated function ${name}`);
  return src.slice(start, end + 3);
}

// The constants are READ from the real declarations, so changing one in app.js
// moves this check with it instead of desyncing from it.
function takeConst(name) {
  const match = new RegExp(`^const ${name} = ([^;]+);`, "m").exec(appSrc);
  assert.ok(match, `missing const ${name}`);
  // eslint-disable-next-line no-new-func
  return Number(new Function(`return (${match[1]});`)());
}

const VOICE_MAX_SECONDS = takeConst("VOICE_MAX_SECONDS");
const VOICE_WARN_SECONDS = takeConst("VOICE_WARN_SECONDS");
const VOICE_BITS_PER_SECOND = takeConst("VOICE_BITS_PER_SECOND");
const VOICE_MAX_CLIP_CHARS = takeConst("VOICE_MAX_CLIP_CHARS");
const VOICE_TOTAL_CHARS = takeConst("VOICE_TOTAL_CHARS");

// --- 0. The arithmetic actually closes ------------------------------------
// A clip recorded right up to the hard cap, at the bitrate the recorder asks
// for, has to FIT the per-clip ceiling — base64 included. If it does not, the
// feature's failure mode is "talk for the full minute, then be refused".
const worstCaseClipChars = Math.ceil(((VOICE_MAX_SECONDS * VOICE_BITS_PER_SECOND) / 8) * (4 / 3));
assert.ok(
  worstCaseClipChars <= VOICE_MAX_CLIP_CHARS,
  `a full ${VOICE_MAX_SECONDS}s clip at ${VOICE_BITS_PER_SECOND}bps is ~${worstCaseClipChars} chars, ` +
    `over the ${VOICE_MAX_CLIP_CHARS}-char per-clip ceiling`
);
assert.ok(
  VOICE_MAX_CLIP_CHARS * 2 <= VOICE_TOTAL_CHARS,
  "the total budget cannot hold even two maximum clips"
);
assert.ok(VOICE_WARN_SECONDS < VOICE_MAX_SECONDS, "the warning fires after the hard stop");

// --- harness ---------------------------------------------------------------
const store = {
  map: new Map(),
  full: false,
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  },
  setItem(key, value) {
    if (this.full) {
      const error = new Error("QuotaExceededError");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.map.set(key, value);
  }
};

const STORAGE_KEYS = { voice: "axiom_journal_voice_v1" };
let trades = [];

const bundle = [
  takeFunction(appSrc, "voiceStoreRead"),
  takeFunction(appSrc, "voiceStoreWrite"),
  takeFunction(appSrc, "voiceClipFor"),
  takeFunction(appSrc, "voiceUsedChars"),
  takeFunction(appSrc, "formatVoiceSize"),
  takeFunction(appSrc, "formatVoiceDuration"),
  takeFunction(appSrc, "oldestVoiceClipLabel"),
  takeFunction(appSrc, "pruneVoiceNotes"),
  takeFunction(appSrc, "commitVoiceClip"),
  takeFunction(appSrc, "voiceDurationIndex"),
  "return { voiceStoreRead, voiceClipFor, pruneVoiceNotes, commitVoiceClip, voiceDurationIndex," +
    " formatVoiceDuration, formatVoiceSize, oldestVoiceClipLabel };"
].join("\n\n");

const api = new Function(
  "readStorageJson",
  "journalStore",
  "journalKey",
  "STORAGE_KEYS",
  "allTrades",
  "formatIsoShort",
  "console",
  "VOICE_MAX_CLIP_CHARS",
  "VOICE_TOTAL_CHARS",
  bundle
)(
  readStorageJson,
  () => store,
  (key) => key,
  STORAGE_KEYS,
  () => trades,
  (iso) => iso,
  { error() {} },
  VOICE_MAX_CLIP_CHARS,
  VOICE_TOTAL_CHARS
);

const DATA_PREFIX = "data:audio/webm;base64,";
// `chars` is the EXACT stored length, because that is the unit both ceilings
// are expressed in — an off-by-one here would hide an off-by-one there.
const clip = (chars, seconds = 10) => ({
  data: DATA_PREFIX + "A".repeat(Math.max(0, chars - DATA_PREFIX.length)),
  mime: "audio/webm",
  seconds
});
assert.equal(clip(4000).data.length, 4000, "the fixture must produce exactly the length it claims");

const reset = () => {
  store.map.clear();
  store.full = false;
};

// --- 1. A clip round-trips -------------------------------------------------
reset();
trades = [{ id: "t1", asset: "EURUSD", date: "2026-03-01" }];
assert.equal(api.commitVoiceClip("t1", clip(5000)), "", "a small clip should save");
assert.equal(api.voiceClipFor("t1").seconds, 10);
assert.equal(api.voiceDurationIndex().get("t1"), 10);

// --- 2. The per-clip ceiling holds, and nothing is written ------------------
reset();
const before = store.map.size;
const tooBig = api.commitVoiceClip("t1", clip(VOICE_MAX_CLIP_CHARS + 1));
assert.match(tooBig, /per-clip ceiling/, "an oversize clip must be refused by name");
assert.equal(store.map.size, before, "a refused clip must not touch storage");

// --- 3. The total budget holds — and subtracts the clip being replaced ------
reset();
trades = [
  { id: "t1", asset: "EURUSD", date: "2026-03-01" },
  { id: "t2", asset: "GBPUSD", date: "2026-03-02" }
];
const half = Math.floor(VOICE_TOTAL_CHARS / 2);
assert.equal(api.commitVoiceClip("t1", clip(Math.min(half, VOICE_MAX_CLIP_CHARS))), "");
assert.equal(api.commitVoiceClip("t2", clip(Math.min(half, VOICE_MAX_CLIP_CHARS))), "");

// Fill the rest so the budget is genuinely exhausted.
let filler = 0;
while (true) {
  const id = `f${filler}`;
  trades.push({ id, asset: "USDJPY", date: "2026-03-03" });
  if (api.commitVoiceClip(id, clip(VOICE_MAX_CLIP_CHARS))) {
    break;
  }
  filler += 1;
  assert.ok(filler < 50, "the total budget never filled — the cap is not being enforced");
}
trades.push({ id: "t3", asset: "AUDUSD", date: "2026-03-09" });
const full = api.commitVoiceClip("t3", clip(VOICE_MAX_CLIP_CHARS));
assert.match(full, /Voice storage is full/, "a full store must say so");
assert.match(full, /EURUSD on 2026-03-01/, "and must name the oldest clip so it can be found");

// The replacement path: re-saving t1's OWN clip at the same size still fits,
// because its existing bytes are subtracted before the comparison.
const t1Size = api.voiceClipFor("t1").data.length;
assert.equal(
  api.commitVoiceClip("t1", clip(t1Size)),
  "",
  "replacing a clip with one of the same size must not be blocked by the total cap"
);

// --- 4. Re-saving an unchanged clip keeps its original timestamp ------------
reset();
trades = [{ id: "t1", asset: "EURUSD", date: "2026-03-01" }];
const same = clip(4000);
api.commitVoiceClip("t1", same);
const firstStamp = api.voiceClipFor("t1").createdAt;
api.commitVoiceClip("t1", same);
assert.equal(
  api.voiceClipFor("t1").createdAt,
  firstStamp,
  "an unchanged clip must not be shuffled to the back of the oldest-clip queue"
);

// --- 5. Delete ------------------------------------------------------------
assert.equal(api.commitVoiceClip("t1", null), "");
assert.equal(api.voiceClipFor("t1"), null);
assert.equal(api.commitVoiceClip("t1", null), "", "deleting nothing is not an error");

// --- 6. The scheme check ---------------------------------------------------
reset();
store.map.set(
  STORAGE_KEYS.voice,
  JSON.stringify({
    ok: { data: "data:audio/webm;base64,AAAA", seconds: 3 },
    js: { data: "javascript:alert(1)", seconds: 3 },
    img: { data: "data:image/png;base64,AAAA", seconds: 3 },
    nul: { data: null, seconds: 3 }
  })
);
assert.ok(api.voiceClipFor("ok"), "a real audio data URL must pass");
assert.equal(api.voiceClipFor("js"), null, "a javascript: URL must never reach an <audio src>");
assert.equal(api.voiceClipFor("img"), null, "a non-audio data URL must be refused");
assert.equal(api.voiceClipFor("nul"), null);
assert.deepEqual([...api.voiceDurationIndex().keys()], ["ok"], "the table index applies the same check");

// A corrupt store degrades to "no clips" rather than throwing on the sheet.
store.map.set(STORAGE_KEYS.voice, "{not json");
assert.deepEqual(api.voiceStoreRead(), {});
store.map.set(STORAGE_KEYS.voice, "[1,2,3]");
assert.deepEqual(api.voiceStoreRead(), {});

// --- 7. Orphans are pruned, live clips are not -----------------------------
reset();
trades = [{ id: "alive", asset: "EURUSD", date: "2026-03-01" }];
store.map.set(
  STORAGE_KEYS.voice,
  JSON.stringify({
    alive: { data: "data:audio/webm;base64,AAAA", seconds: 4 },
    ghost: { data: "data:audio/webm;base64,BBBB", seconds: 9 }
  })
);
api.pruneVoiceNotes();
assert.deepEqual(Object.keys(api.voiceStoreRead()), ["alive"]);

// --- 8. A quota error surfaces as a sentence, never as silence -------------
reset();
trades = [{ id: "t1", asset: "EURUSD", date: "2026-03-01" }];
store.full = true;
const refused = api.commitVoiceClip("t1", clip(4000));
assert.ok(refused, "a throwing setItem must produce a message, not an empty string");
assert.match(refused, /Everything else on this trade was saved/);

// --- 9. Formatting --------------------------------------------------------
assert.equal(api.formatVoiceDuration(0), "0:00");
assert.equal(api.formatVoiceDuration(7), "0:07");
assert.equal(api.formatVoiceDuration(60), "1:00");
assert.equal(api.formatVoiceDuration(75), "1:15");
assert.equal(api.formatVoiceSize(0), "0 KB");
assert.equal(api.formatVoiceSize(1024), "1 KB");

// --- 10. The clip store never rides the server sync -------------------------
const syncSrc = takeFunction(appSrc, "saveToPhpStorage");
assert.ok(
  !/voice/i.test(syncSrc),
  "saveToPhpStorage mentions voice — the clip store must stay out of the sync payload"
);
const persistSrc = takeFunction(appSrc, "persistState");
assert.ok(
  !/STORAGE_KEYS\.voice/.test(persistSrc),
  "persistState writes the voice key — clips are committed by commitVoiceClip alone"
);
// And it must not be part of a trade record either, or exports and the server
// would carry it by the back door.
const buildSrc = takeFunction(appSrc, "buildTradeRecord");
assert.ok(!/voice/i.test(buildSrc), "buildTradeRecord carries a voice field — clips belong to their own key");

// --- 11. Nothing in the UI promises a transcript ----------------------------
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const promises = /transcri(be|pt|ption)|speech.to.text|dictat/i;
const voiceBlock = html.slice(html.indexOf('class="jrn-voice"'), html.indexOf("journalVoiceQuota") + 400);
assert.ok(voiceBlock.length > 100, "the voice block is no longer in index.html");
assert.ok(!promises.test(voiceBlock), "the voice markup implies transcription, and there is none");
const voiceStrings = appSrc.slice(appSrc.indexOf("function voiceStoreRead"), appSrc.indexOf("function isJournalSheetOpen"));
assert.ok(
  !/["`][^"`]*transcri[^"`]*["`]/i.test(voiceStrings),
  "a user-facing string implies transcription, and there is none"
);
// The three honest claims have to actually be made somewhere the trader reads.
assert.match(voiceStrings, /not searchable/, "the UI must say a clip is not searchable");
assert.match(voiceStrings, /never synced/, "the UI must say a clip is not synced");

// --- 12. The near-full warning arrives BEFORE the refusal -------------------
// A cap the trader only learns about at the moment it stops them is not a cap,
// it is an ambush. voiceQuotaLine() is the one string that has to say "nearly"
// while there is still room to delete something.
const quotaSrc = takeFunction(appSrc, "voiceQuotaLine");
assert.match(quotaSrc, /VOICE_TOTAL_CHARS \* 0\.8/, "the near-full threshold is gone from voiceQuotaLine");
assert.match(quotaSrc, /Nearly full/, "voiceQuotaLine no longer warns before the ceiling");
assert.match(quotaSrc, /oldestVoiceClipLabel\(\)/, "the warning must name something the trader can delete");

console.log(
  "voiceNotes.check.mjs: OK — %ds @ %dbps fits %d chars (ceiling %d), budget %d chars",
  VOICE_MAX_SECONDS,
  VOICE_BITS_PER_SECOND,
  worstCaseClipChars,
  VOICE_MAX_CLIP_CHARS,
  VOICE_TOTAL_CHARS
);
