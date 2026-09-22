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
