/**
 * Times. English labels with the zone abbreviation, e.g. “Thu Nov 12, 21:04 CST”.
 *
 * - Client components show the viewer's own zone: call without `tz` (the browser's zone).
 * - Server code must pass `NETWORK_TZ` explicitly (Vercel runs in UTC), so emails and no-JS pages read CST.
 * - Asker-visible changes on REAL asks (other than “intro made”) land at the next 09:00 or 21:00 checkpoint
 *   in Mexico City, computed on read (ux-spec §1 “Conflicts resolved”). See lastCheckpoint/nextCheckpoint.
 * - Monthly caps count per calendar month in Mexico City (capMonth).
 */

/** The network's home zone. Mexico City has had no DST since 2022 (UTC−6 all year), but nothing here assumes it. */
export const NETWORK_TZ = 'America/Mexico_City';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** An offer waits 72 hours for a reply, then moves to the next person in line. */
export const OFFER_WINDOW_MS = 72 * HOUR_MS;
/** Asker checkpoints, local hours in NETWORK_TZ. */
export const CHECKPOINT_HOURS = [9, 21] as const;

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string; monthShort: string; zone: string };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string | undefined): Intl.DateTimeFormat {
  const key = tz ?? '';
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    });
    fmtCache.set(key, f);
  }
  return f;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Wall-clock parts of an instant in `tz` (undefined = the runtime's own zone). */
export function zonedParts(ms: number, tz?: string): Parts {
  const o: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  const monthShort = o.month ?? 'Jan';
  return {
    year: Number(o.year),
    month: MONTHS.indexOf(monthShort) + 1,
    day: Number(o.day),
    hour: Number(o.hour) % 24,
    minute: Number(o.minute),
    second: Number(o.second),
    weekday: o.weekday ?? '',
    monthShort,
    zone: o.timeZoneName ?? '',
  };
}

/** The UTC instant of a wall-clock time in `tz` (two-pass offset correction; exact for fixed-offset zones). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (ms: number) => {
    const p = zonedParts(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** “Thu Nov 12, 21:04 CST”. */
export function fmtWhen(ms: number, tz?: string): string {
  const p = zonedParts(ms, tz);
  return `${p.weekday} ${p.monthShort} ${p.day}, ${pad2(p.hour)}:${pad2(p.minute)} ${p.zone}`;
}

/** “Nov 12”. */
export function fmtDay(ms: number, tz?: string): string {
  const p = zonedParts(ms, tz);
  return `${p.monthShort} ${p.day}`;
}

/** “Thu Nov 12”. */
export function fmtWeekday(ms: number, tz?: string): string {
  const p = zonedParts(ms, tz);
  return `${p.weekday} ${p.monthShort} ${p.day}`;
}

/** “Thu”. */
export function fmtWeekdayShort(ms: number, tz?: string): string {
  return zonedParts(ms, tz).weekday;
}

/** “21:04”. */
export function fmtClock(ms: number, tz?: string): string {
  const p = zonedParts(ms, tz);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** The zone abbreviation the viewer sees, e.g. “CST”. */
export function zoneAbbr(ms: number, tz?: string): string {
  return zonedParts(ms, tz).zone;
}

/** Whole hours left until `untilMs` (never negative): the “71 h left” meta. */
export function hoursLeft(untilMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, Math.floor((untilMs - nowMs) / HOUR_MS));
}

/** Parses an ISO string or passes a number through. */
export function toMs(t: string | number | Date): number {
  return t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t);
}

/* ---------- asker checkpoints (09:00 and 21:00 in Mexico City) ---------- */

function checkpointsAround(ms: number): number[] {
  const p = zonedParts(ms, NETWORK_TZ);
  const out: number[] = [];
  // yesterday, today and tomorrow, local dates
  for (const dd of [-1, 0, 1]) {
    const base = Date.UTC(p.year, p.month - 1, p.day + dd);
    const d = new Date(base);
    for (const h of CHECKPOINT_HOURS) out.push(zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, 0, NETWORK_TZ));
  }
  return out.sort((a, b) => a - b);
}

/** The latest checkpoint at or before `now`. */
export function lastCheckpoint(now: Date | number): Date {
  const ms = toMs(now);
  const all = checkpointsAround(ms).filter((c) => c <= ms);
  return new Date(all[all.length - 1] as number);
}

/** The first checkpoint strictly after `now`. */
export function nextCheckpoint(now: Date | number): Date {
  const ms = toMs(now);
  return new Date(checkpointsAround(ms).find((c) => c > ms) as number);
}

/**
 * The instant an asker's REAL view reflects: the later of “the send finished” and the last checkpoint.
 * Member-driven changes (a pass, an expiry, a 2-line answer, the offer moving on) become visible only once
 * this instant passes them. “Intro made” is the one exception and shows at once.
 */
export function askerAsOf(sendFinishedAt: Date | number | null, now: Date | number): Date {
  const cp = lastCheckpoint(now).getTime();
  const sent = sendFinishedAt === null ? 0 : toMs(sendFinishedAt);
  return new Date(Math.max(cp, Math.min(sent, toMs(now))));
}

/* ---------- monthly caps ---------- */

/** First day of the cap month in Mexico City, as `YYYY-MM-01` (the `cap_usage.month` value). */
export function capMonth(at: Date | number = Date.now()): string {
  const p = zonedParts(toMs(at), NETWORK_TZ);
  return `${p.year}-${pad2(p.month)}-01`;
}

/** “November” for `2026-11-01`. */
export function monthName(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTHS_LONG[m - 1] ?? '';
}

/** The day the cap resets, e.g. “Dec 1” for `2026-11-01`. */
export function resetsOn(month: string): string {
  const m = Number(month.slice(5, 7));
  return `${MONTHS[m % 12]} 1`;
}

/** The UTC instant the cap month after `month` starts (local midnight in Mexico City). */
export function nextMonthStart(month: string): Date {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(zonedTimeToUtc(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, 0, 0, NETWORK_TZ));
}
