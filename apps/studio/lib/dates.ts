/**
 * Dates in the invite surfaces are formatted in UTC, deliberately.
 *
 * A code's expiry is written by one admin and read by another, often in a
 * different timezone, and the same instant rendered in two local zones is two
 * different dates. Worse, a client component that formats in local time renders
 * one string on the server and another in the browser, which is a hydration
 * mismatch. One zone everywhere removes both problems, and the pickers below
 * write the same zone they display, so what an admin chooses is what she sees.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** "14 Aug 2026" — always UTC, so server and browser agree. */
export function formatUtcDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "14 Aug 2026, 09:12 UTC" — for anything where the hour matters. */
export function formatUtcDateTime(iso: string): string {
  return `${new Date(iso).toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  })} UTC`;
}

/**
 * A `<input type="date">` value to the last second of that day.
 * Returns null for an unparseable value so callers can reject it rather than
 * sending `Invalid Date` to Postgres.
 */
export function endOfUtcDayIso(yyyyMmDd: string): string | null {
  const parsed = new Date(`${yyyyMmDd}T23:59:59.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** N days out, rounded up to the end of that day so a "7 day" code lasts 7 whole days. */
export function endOfUtcDayInDays(days: number): string {
  const target = new Date(Date.now() + days * DAY_MS);
  target.setUTCHours(23, 59, 59, 0);
  return target.toISOString();
}

/** Today as `yyyy-mm-dd` in UTC — the `min` for an expiry picker. */
export function todayUtcInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}
