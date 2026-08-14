// The wall's link parser decides what becomes an iframe src, so it is a
// security boundary and this file is mostly an attack list. The rule it must
// hold: allowlist only. A named YouTube host, an id matching YouTube's own
// shape, or null. Nothing is cleaned up, nothing is guessed.
//
// Run: node tests/wallLink.check.mjs
import assert from "node:assert/strict";
import {
  parseWallLink,
  wallEmbedUrl,
  wallSlotValue,
  parseWallSlot,
  wallLinkNote,
} from "../src/lib/wallLink.js";

const CH = "UChqUTb7kYRX8-EiaN3XFrSQ"; // Reuters, a real roster id
const VID = "MjVtJ2mhyMY"; // a real 11 char video id

// --- 1. THE ATTACK LIST. Every one of these must be null. ------------------
for (const hostile of [
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "  javascript:alert(1)  ",
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  `https://evil.test/watch?v=${VID}`,
  `https://youtube.com.evil.test/watch?v=${VID}`,
  `https://notyoutube.com/watch?v=${VID}`,
  `https://evil.test/embed/live_stream?channel=${CH}`,
  // A YouTube host with an id that is not YouTube's shape.
  "https://www.youtube.com/watch?v=../../etc/passwd",
  "https://www.youtube.com/watch?v=<script>",
  "https://www.youtube.com/channel/UC",
  "https://www.youtube.com/channel/notachannelid",
  "https://www.youtube.com/watch?v=tooshort",
  // A handle names a channel we cannot resolve without an API call.
  "https://www.youtube.com/@Reuters",
  "https://www.youtube.com/c/Reuters",
  "https://www.youtube.com/user/Reuters",
  "",
  "   ",
  null,
  undefined,
  {},
  [],
]) {
  assert.equal(
    parseWallLink(hostile),
    null,
    `must refuse: ${JSON.stringify(String(hostile)).slice(0, 60)}`
  );
}

// A javascript: URL that mentions a real host must still die. This is the one
// a regex-based "does it contain youtube.com" check would let through.
assert.equal(parseWallLink("javascript:fetch('https://www.youtube.com')"), null);

// --- 2. The shapes a trader actually pastes. -------------------------------
const video = (input) =>
  assert.deepEqual(parseWallLink(input), { kind: "video", id: VID }, `video: ${input}`);
const channel = (input) =>
  assert.deepEqual(parseWallLink(input), { kind: "channel", id: CH }, `channel: ${input}`);

video(`https://www.youtube.com/watch?v=${VID}`);
video(`https://youtube.com/watch?v=${VID}`);
video(`https://m.youtube.com/watch?v=${VID}`);
video(`https://music.youtube.com/watch?v=${VID}`);
video(`https://www.youtube-nocookie.com/embed/${VID}`);
video(`https://youtu.be/${VID}`);
video(`https://www.youtube.com/live/${VID}`);
video(`https://www.youtube.com/embed/${VID}`);
video(`https://www.youtube.com/shorts/${VID}`);
video(`https://www.youtube.com/v/${VID}`);
video(VID); // a bare id, which is what people paste after copying out of a URL
// Extra params, a timestamp, and a playlist are all normal on a copied link.
video(`https://www.youtube.com/watch?v=${VID}&t=42s&list=PLxxx&feature=share`);
// No scheme, which is what a browser address bar copy often gives.
video(`youtube.com/watch?v=${VID}`);
video(`www.youtube.com/watch?v=${VID}`);
// Surrounding whitespace from a sloppy paste.
video(`  https://youtu.be/${VID}  `);

channel(`https://www.youtube.com/channel/${CH}`);
channel(`https://www.youtube.com/embed/live_stream?channel=${CH}`);
channel(CH);

// http is allowed and upgraded by YouTube itself; the embed we build is https.
video(`http://www.youtube.com/watch?v=${VID}`);

// --- 3. The embed URL. ------------------------------------------------------
const chUrl = wallEmbedUrl({ kind: "channel", id: CH }, "https://example.test");
assert.ok(chUrl.startsWith("https://www.youtube.com/embed/live_stream?channel="));
assert.ok(chUrl.includes(CH));
assert.ok(chUrl.includes("enablejsapi=1"), "the dark-channel detector needs the js api");
assert.ok(chUrl.includes("mute=1"), "autoplay is only allowed muted");
assert.ok(chUrl.includes("origin=https%3A%2F%2Fexample.test"));

const vidUrl = wallEmbedUrl({ kind: "video", id: VID }, "https://example.test");
assert.ok(vidUrl.includes("enablejsapi=1"));
assert.equal(wallEmbedUrl(null), "");

// EVERY built URL must parse, and every param must land in the query string.
// The first version of this assertion allowed "embed/ID?" OR "embed/ID&", and
// the "&" branch shipped: with no "?" anywhere, YouTube read autoplay=1 as part
// of the video id and the frame loaded nothing. Parse it instead of matching on
// substrings, so the separator is checked rather than assumed.
for (const target of [{ kind: "video", id: VID }, { kind: "channel", id: CH }]) {
  const built = new URL(wallEmbedUrl(target, "https://example.test"));
  assert.equal(built.origin, "https://www.youtube.com", `origin for ${target.kind}`);
  assert.equal(built.searchParams.get("autoplay"), "1", `autoplay reachable for ${target.kind}`);
  assert.equal(built.searchParams.get("mute"), "1", `mute reachable for ${target.kind}`);
  assert.equal(built.searchParams.get("enablejsapi"), "1", `js api reachable for ${target.kind}`);
  assert.equal(built.searchParams.get("origin"), "https://example.test");
  // The id must survive in the path (or in ?channel=), not leak into a param.
  if (target.kind === "video") {
    assert.equal(built.pathname, `/embed/${VID}`, "video id is the whole path");
  } else {
    assert.equal(built.pathname, "/embed/live_stream");
    assert.equal(built.searchParams.get("channel"), CH);
  }
}

// Every URL this builds is https on a youtube host, whatever went in.
for (const input of [`https://youtu.be/${VID}`, CH, `youtube.com/live/${VID}`]) {
  const built = wallEmbedUrl(parseWallLink(input), "https://example.test");
  assert.match(built, /^https:\/\/www\.youtube\.com\/embed\//, `built src for ${input}`);
}

// --- 4. Storage round trip. A stored video can never be read as a roster id.
assert.equal(wallSlotValue({ kind: "channel", id: CH }), CH);
assert.equal(wallSlotValue({ kind: "video", id: VID }), `v:${VID}`);
assert.deepEqual(parseWallSlot(CH), { kind: "channel", id: CH });
assert.deepEqual(parseWallSlot(`v:${VID}`), { kind: "video", id: VID });
assert.equal(parseWallSlot("v:notanid"), null);
assert.equal(parseWallSlot("garbage"), null);
assert.equal(parseWallSlot(""), null);
// The prefix is what keeps the two namespaces apart: an 11 char video id is
// not a 24 char channel id, and the stored form says which it is.
assert.notEqual(wallSlotValue({ kind: "video", id: VID }), VID);

// --- 5. The readback the trader reads before committing. -------------------
assert.deepEqual(wallLinkNote(""), { state: "empty", note: "", target: null });
assert.deepEqual(wallLinkNote("   "), { state: "empty", note: "", target: null });

const okVideo = wallLinkNote(`https://youtu.be/${VID}`);
assert.equal(okVideo.state, "ok");
assert.deepEqual(okVideo.target, { kind: "video", id: VID });

// THE CASE ASSERTION. A video id is case sensitive, so the readback must carry
// it through byte for byte. This fails if anyone uppercases the note, in CSS or
// in JS, which would make the one row that exists to confirm the parse lie
// about it.
const mixed = "dQw4w9WgXcQ";
assert.ok(
  wallLinkNote(`https://youtu.be/${mixed}`).note.includes(mixed),
  "the readback must preserve the exact case of a video id"
);
assert.ok(!/[A-Z]/.test(wallLinkNote(`https://youtu.be/${mixed}`).note.replace(mixed, "")),
  "everything around the id is authored lowercase");

assert.equal(wallLinkNote(`https://www.youtube.com/channel/${CH}`).state, "ok");
assert.ok(wallLinkNote(`https://www.youtube.com/channel/${CH}`).note.includes(CH));

// A handle is refused, and says so specifically: it looks entirely valid to the
// person pasting it, so "not a youtube link" would read as a bug.
for (const handle of [
  "https://www.youtube.com/@Reuters",
  "https://www.youtube.com/c/Reuters",
  "https://www.youtube.com/user/Reuters",
]) {
  const note = wallLinkNote(handle);
  assert.equal(note.state, "bad", handle);
  assert.equal(note.target, null);
  assert.match(note.note, /handle/, "a handle gets its own message");
}

const hostile = wallLinkNote("javascript:alert(1)");
assert.equal(hostile.state, "bad");
assert.equal(hostile.target, null);
assert.equal(hostile.note, "not a youtube link");

// No dashes anywhere in copy this module authors: the project bans them and
// these strings reach the screen.
for (const probe of ["", `https://youtu.be/${VID}`, "https://www.youtube.com/@x", "garbage"]) {
  assert.ok(!/[–—]/.test(wallLinkNote(probe).note), "no em or en dashes in the readback");
}

console.log("wallLink.check.mjs: OK — allowlist holds, 10 paste shapes parse, readback preserves id case, storage round trips");
