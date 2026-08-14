// PASTED YOUTUBE LINKS, and the gate that decides what is allowed to become an
// iframe src.
//
// THIS IS A SECURITY BOUNDARY, not a convenience parser. Whatever comes back
// from here is interpolated into a YouTube embed URL and loaded in a frame, so
// the rule is allowlist only: the host must be a YouTube host we name, the id
// must match YouTube's own id shape exactly, and anything else returns null.
// A "clean it up and hope" parser is how a javascript: or data: URL reaches a
// src attribute, so nothing is cleaned up here and nothing is guessed.
//
// TWO KINDS OF TARGET, because the wall already embeds both:
//   channel  a 24-char UCxxxx id, embedded as live_stream?channel=ID, which
//            survives a nightly stream restart and is what the roster uses.
//   video    an 11-char id, embedded as embed/ID, which is what a pasted link
//            to a specific live stream resolves to.

/** YouTube channel ids: literally "UC" plus 22 id characters. */
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
/** YouTube video ids: exactly 11 id characters. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

/**
 * A pasted string to a wall target, or null.
 *
 * Accepts a bare id of either kind, and these link shapes:
 *   youtube.com/watch?v=ID          youtu.be/ID
 *   youtube.com/live/ID             youtube.com/embed/ID
 *   youtube.com/shorts/ID           youtube.com/v/ID
 *   youtube.com/channel/UCxxxx      youtube.com/embed/live_stream?channel=UCxxxx
 *
 * @returns {{kind: "channel"|"video", id: string}|null}
 */
export function parseWallLink(input) {
  const raw = String(input ?? "").trim();
  if (raw === "") return null;

  // A bare id, which is what someone pastes when they copied it out of a URL.
  if (CHANNEL_ID.test(raw)) return { kind: "channel", id: raw };
  if (VIDEO_ID.test(raw)) return { kind: "video", id: raw };

  // Anything else has to parse as a URL on a host we name. A scheme-less paste
  // is given https, which is why the protocol is checked AFTER parsing rather
  // than by sniffing the string: "javascript:alert(1)" parses with protocol
  // javascript: and is refused here, not by a regex someone can outwit.
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  // ?channel= wins wherever it appears, because that is the live_stream shape.
  const channelParam = url.searchParams.get("channel");
  if (channelParam && CHANNEL_ID.test(channelParam)) {
    return { kind: "channel", id: channelParam };
  }

  const v = url.searchParams.get("v");
  if (v && VIDEO_ID.test(v)) return { kind: "video", id: v };

  const parts = url.pathname.split("/").filter(Boolean);

  // youtu.be/ID carries the id as the whole path.
  if (url.hostname.toLowerCase().endsWith("youtu.be")) {
    return parts[0] && VIDEO_ID.test(parts[0]) ? { kind: "video", id: parts[0] } : null;
  }

  const at = (name) => {
    const i = parts.indexOf(name);
    return i === -1 ? "" : parts[i + 1] || "";
  };

  const channelPath = at("channel");
  if (CHANNEL_ID.test(channelPath)) return { kind: "channel", id: channelPath };

  for (const name of ["live", "embed", "shorts", "v"]) {
    const id = at(name);
    if (VIDEO_ID.test(id)) return { kind: "video", id };
  }

  // A handle link (youtube.com/@name) names a channel we cannot resolve to an
  // id without an API call, so it is refused rather than guessed at.
  return null;
}

/**
 * A parsed target to the embed URL the wall loads.
 * `origin` is passed in rather than read from location, so this stays pure and
 * testable in node.
 */
export function wallEmbedUrl(target, origin = "") {
  if (!target) return "";
  // The channel form already carries ?channel=, the video form carries no query
  // at all, so the separator is chosen per shape. Hardcoding "&" produced
  // embed/ID&autoplay=1, which YouTube reads as part of the video id.
  const base =
    target.kind === "channel"
      ? `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(target.id)}&`
      : `https://www.youtube.com/embed/${encodeURIComponent(target.id)}?`;
  const params = `autoplay=1&mute=1&enablejsapi=1${origin ? `&origin=${encodeURIComponent(origin)}` : ""}`;
  return base + params;
}

/** The value stored in a wall slot. A video target is prefixed so a stored
 *  slot can never be mistaken for a roster channel id. */
export function wallSlotValue(target) {
  if (!target) return "";
  return target.kind === "channel" ? target.id : `v:${target.id}`;
}

/** A stored slot value back to a target, or null if it is not one of ours. */
export function parseWallSlot(value) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("v:")) {
    const id = raw.slice(2);
    return VIDEO_ID.test(id) ? { kind: "video", id } : null;
  }
  return CHANNEL_ID.test(raw) ? { kind: "channel", id: raw } : null;
}
