// Trading-session clock for the dashboard greeting ("London open in 42m").
// Pure: no DOM, no app state — the countdown is computed against the real
// clock in each venue's own time zone, so Intl (not a hard-coded offset)
// handles DST, and weekend occurrences roll forward to Monday.

export const SESSION_OPENS = [
  { name: "Asia", zone: "Asia/Tokyo", hour: 9, minute: 0 },
  { name: "London", zone: "Europe/London", hour: 8, minute: 0 },
  { name: "New York", zone: "America/New_York", hour: 9, minute: 30 }
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Minutes-since-midnight and weekday index as they read RIGHT NOW in `zone`.
export function zoneNow(zone, now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short"
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    weekday: Math.max(WEEKDAYS.indexOf(get("weekday")), 0)
  };
}

export function getNextSessionOpen(now = new Date(), sessions = SESSION_OPENS) {
  let best = null;
  sessions.forEach((session) => {
    const local = zoneNow(session.zone, now);
    const target = session.hour * 60 + session.minute;
    let diff = target - local.minutes;
    let day = local.weekday;
    if (diff <= 0) {
      diff += 1440;
      day = (day + 1) % 7;
    }
    // A "London open in 42m" on a Saturday would be a lie.
    while (day === 0 || day === 6) {
      diff += 1440;
      day = (day + 1) % 7;
    }
    if (!best || diff < best.minutes) {
      best = { name: session.name, minutes: diff };
    }
  });
  return best;
}

export function formatCountdown(minutes) {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

// The Session Horizon band's venues: cash-equity hours, each in its own zone
// so Intl carries the DST. `open`/`close` are minutes-since-midnight local to
// the venue. ponytail: Tokyo's lunch break and half-day holidays are ignored —
// add a `breaks` list here if the band ever needs them.
export const SESSION_WINDOWS = [
  { key: "sydney", city: "Sydney", venue: "ASX", zone: "Australia/Sydney", open: 600, close: 960 },
  { key: "tokyo", city: "Tokyo", venue: "TSE", zone: "Asia/Tokyo", open: 540, close: 900 },
  { key: "london", city: "London", venue: "LSE", zone: "Europe/London", open: 480, close: 990 },
  { key: "newyork", city: "New York", venue: "NYSE", zone: "America/New_York", open: 570, close: 960 }
];

const PRE_MARKET_MINUTES = 120;

// Minutes until the venue's next weekday open, given where its local clock
// stands right now. Same weekend roll as getNextSessionOpen.
function minutesToNextOpen(local, openMinutes) {
  let diff = openMinutes - local.minutes;
  let day = local.weekday;
  if (diff <= 0) {
    diff += 1440;
    day = (day + 1) % 7;
  }
  while (day === 0 || day === 6) {
    diff += 1440;
    day = (day + 1) % 7;
  }
  return diff;
}

/** One reading per venue for the dashboard's session band: state, the countdown
 *  that goes with it, how far through the session it is, the venue's own clock,
 *  and where the session lands on the VIEWER's 24h rail (viewer-local minutes;
 *  the rail renderer wraps segments that cross midnight). */
export function getSessionStates(now = new Date(), windows = SESSION_WINDOWS) {
  const viewer = { minutes: now.getHours() * 60 + now.getMinutes() };
  return windows.map((window) => {
    const local = zoneNow(window.zone, now);
    const isWeekday = local.weekday >= 1 && local.weekday <= 5;
    const inSession = isWeekday && local.minutes >= window.open && local.minutes < window.close;
    const inPre = isWeekday && !inSession && window.open - local.minutes > 0 && window.open - local.minutes <= PRE_MARKET_MINUTES;

    let state = "closed";
    let countdown = minutesToNextOpen(local, window.open);
    let label = "opens in";
    if (inSession) {
      state = "open";
      countdown = window.close - local.minutes;
      label = "closes in";
    } else if (inPre) {
      state = "pre";
      label = "opens in";
    }

    const hour = String(Math.floor(local.minutes / 60)).padStart(2, "0");
    const minute = String(local.minutes % 60).padStart(2, "0");
    // The viewer-local minute this venue's open falls on: shift "now" by the
    // gap between the venue's clock and the viewer's.
    const railStart = ((viewer.minutes + (window.open - local.minutes)) % 1440 + 1440) % 1440;
    return {
      key: window.key,
      city: window.city,
      venue: window.venue,
      state,
      label,
      countdownMinutes: countdown,
      elapsedFrac: inSession ? (local.minutes - window.open) / (window.close - window.open) : 0,
      localClock: `${hour}:${minute}`,
      railStartMinutes: railStart,
      railLengthMinutes: window.close - window.open
    };
  });
}
