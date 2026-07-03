// slots.js
// ---------------------------------------------------------------------------
// The "brain" of the scheduler. Given a list of times you're already busy and
// your preferences (which days, what afternoon window, how long a block), this
// figures out the NEXT free slot where a Focus Reading block could go.
//
// IMPORTANT: This file knows nothing about Chrome or Google. It's pure logic:
// data in, answer out. That's deliberate — it makes it easy to test with fake
// data (see test/slots.test.js) and impossible for it to accidentally touch
// your real calendar.
// ---------------------------------------------------------------------------

// Turn a value that might be a Date, an ISO string, or a number of milliseconds
// into a plain millisecond timestamp. We compare everything in milliseconds
// because that side-steps all timezone confusion (a moment in time is a moment
// in time, no matter how it's written).
function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return new Date(value).getTime(); // handles ISO strings like the calendar sends
}

// Parse "14:00" into { hours: 14, minutes: 0 }.
function parseHHMM(text) {
  const [h, m] = text.split(":").map((n) => parseInt(n, 10));
  return { hours: h, minutes: m };
}

// Build a Date for a specific day-at-a-specific-clock-time, in the user's
// LOCAL timezone. We take an existing Date (which fixes the year/month/day in
// local time) and stamp the hours/minutes onto it. This is the only part that
// is timezone-aware, and it correctly uses the machine's local time — which is
// what "2pm" means to the person using it.
function atLocalTime(dayDate, hhmm) {
  const d = new Date(dayDate);
  d.setHours(hhmm.hours, hhmm.minutes, 0, 0);
  return d;
}

// A stable "which calendar day is this" key in LOCAL time, like "2026-6-29".
// Used to compare a candidate day against days that already have a block. We
// build it from local year/month/day so it lines up with how the user sees
// their calendar.
export function localDateKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// The cloud Worker does not run in the user's browser timezone, so it needs an
// explicit timezone-aware version of the same scheduling logic.
export function zonedDateKey(value, timeZone) {
  const p = zonedParts(new Date(toMs(value)), timeZone);
  return calendarDateKey(p);
}

/**
 * Find the next free slot.
 *
 * @param {Array<{start, end}>} busy  Intervals you're already booked. start/end
 *        may be Date, ISO string, or ms. This is what the Worker receives from
 *        Lark free/busy, already shaped to {start, end}.
 * @param {Object} prefs
 * @param {number[]} prefs.days        Allowed weekdays. 0=Sunday … 6=Saturday.
 * @param {string}   prefs.windowStart "HH:MM" earliest the block may start.
 * @param {string}   prefs.windowEnd   "HH:MM" latest the block may END by.
 * @param {number}   prefs.blockMinutes  Length of the block in minutes.
 * @param {number}   [prefs.minLeadMinutes=0] Minimum notice before a block may
 *        start, counted from now.
 * @param {number}   prefs.lookaheadDays How many days ahead to search.
 * @param {Date|number|string} now     The current moment. Passed in (not read
 *        from the clock inside) so tests are deterministic.
 * @returns {{start: Date, end: Date} | null}  The slot, or null if none found.
 * @param {Set<string>} [blockedDayKeys]  Day keys ("YYYY-M-D") that already have
 *        a reading block and must be skipped entirely, so we never book two
 *        reading blocks on the same day.
 */
export function findNextFreeSlot(busy, prefs, now, blockedDayKeys = new Set()) {
  const nowMs = toMs(now);
  const earliestStartMs = nowMs + (prefs.minLeadMinutes || 0) * 60 * 1000;
  const blockMs = prefs.blockMinutes * 60 * 1000;
  const startPref = parseHHMM(prefs.windowStart);
  const endPref = parseHHMM(prefs.windowEnd);

  // Normalise busy intervals to ms once, up front.
  const busyMs = busy
    .map((b) => ({ start: toMs(b.start), end: toMs(b.end) }))
    .sort((a, b) => a.start - b.start);

  // Walk forward day by day, starting from today.
  const startDay = new Date(nowMs);
  startDay.setHours(0, 0, 0, 0);

  for (let dayOffset = 0; dayOffset <= prefs.lookaheadDays; dayOffset++) {
    // The calendar day we're examining.
    const day = new Date(startDay);
    day.setDate(startDay.getDate() + dayOffset);

    // Skip days the user didn't allow (e.g. weekends by default).
    if (!prefs.days.includes(day.getDay())) continue;

    // Skip days that already hold a reading block (one block per day, max).
    if (blockedDayKeys.has(localDateKey(day))) continue;

    // The bookable window for this specific day, as ms timestamps.
    const windowStartMs = atLocalTime(day, startPref).getTime();
    const windowEndMs = atLocalTime(day, endPref).getTime();

    // A "cursor" that walks across the day's free time. It can't start before
    // the window opens or before the minimum notice period has passed.
    let cursor = Math.max(windowStartMs, earliestStartMs);

    // If we've already missed this whole day's window, move on.
    if (cursor + blockMs > windowEndMs) continue;

    // Only the busy intervals that overlap today's window matter here.
    const todaysBusy = busyMs.filter(
      (b) => b.end > windowStartMs && b.start < windowEndMs
    );

    // Walk the cursor past each busy interval, looking for a gap big enough.
    let placed = null;
    for (const b of todaysBusy) {
      // Is there room between where we are and the next thing on the calendar?
      if (b.start - cursor >= blockMs) {
        placed = cursor;
        break;
      }
      // No room — jump the cursor to the end of this busy interval (but never
      // backwards, in case intervals overlap each other).
      cursor = Math.max(cursor, b.end);
      // If jumping forward pushed us out of the window, this day is done.
      if (cursor + blockMs > windowEndMs) {
        cursor = windowEndMs; // mark as "no room left today"
        break;
      }
    }

    // If we didn't slot it between busy blocks, maybe it fits after the last
    // one (or the day was totally free): check the tail of the window.
    if (placed === null && cursor + blockMs <= windowEndMs) {
      placed = cursor;
    }

    if (placed !== null) {
      return { start: new Date(placed), end: new Date(placed + blockMs) };
    }
  }

  // Searched the whole lookahead window and found nothing.
  return null;
}

export function findNextFreeSlotInTimeZone(
  busy,
  prefs,
  now,
  blockedDayKeys = new Set(),
  timeZone = "UTC"
) {
  const nowMs = toMs(now);
  const earliestStartMs = nowMs + (prefs.minLeadMinutes || 0) * 60 * 1000;
  const blockMs = prefs.blockMinutes * 60 * 1000;
  const startPref = parseHHMM(prefs.windowStart);
  const endPref = parseHHMM(prefs.windowEnd);
  const startDate = zonedParts(new Date(nowMs), timeZone);

  const busyMs = busy
    .map((b) => ({ start: toMs(b.start), end: toMs(b.end) }))
    .sort((a, b) => a.start - b.start);

  for (let dayOffset = 0; dayOffset <= prefs.lookaheadDays; dayOffset++) {
    const day = addCalendarDays(startDate, dayOffset);
    if (!prefs.days.includes(weekdayForCalendarDate(day))) continue;
    if (blockedDayKeys.has(calendarDateKey(day))) continue;

    const windowStartMs = zonedTimeToUtc(day, startPref, timeZone).getTime();
    const windowEndMs = zonedTimeToUtc(day, endPref, timeZone).getTime();
    let cursor = Math.max(windowStartMs, earliestStartMs);

    if (cursor + blockMs > windowEndMs) continue;

    const todaysBusy = busyMs.filter(
      (b) => b.end > windowStartMs && b.start < windowEndMs
    );

    let placed = null;
    for (const b of todaysBusy) {
      if (b.start - cursor >= blockMs) {
        placed = cursor;
        break;
      }
      cursor = Math.max(cursor, b.end);
      if (cursor + blockMs > windowEndMs) {
        cursor = windowEndMs;
        break;
      }
    }

    if (placed === null && cursor + blockMs <= windowEndMs) {
      placed = cursor;
    }

    if (placed !== null) {
      return { start: new Date(placed), end: new Date(placed + blockMs) };
    }
  }

  return null;
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  };
}

function addCalendarDays(date, days) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12, 0, 0, 0));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function calendarDateKey(date) {
  return `${date.year}-${date.month}-${date.day}`;
}

function weekdayForCalendarDate(date) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function zonedTimeToUtc(date, hhmm, timeZone) {
  const targetUtc = Date.UTC(date.year, date.month - 1, date.day, hhmm.hours, hhmm.minutes, 0, 0);
  const firstOffset = timeZoneOffsetMs(new Date(targetUtc), timeZone);
  let instant = new Date(targetUtc - firstOffset);
  const secondOffset = timeZoneOffsetMs(instant, timeZone);
  if (secondOffset !== firstOffset) {
    instant = new Date(targetUtc - secondOffset);
  }
  return instant;
}

function timeZoneOffsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
  return asUtc - date.getTime();
}
