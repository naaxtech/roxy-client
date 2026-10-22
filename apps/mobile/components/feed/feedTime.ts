/**
 * A post's age, short (board v2-04: "Inês R. · 2 h"). English until the
 * string catalogue lands (M174); numbers are whole and never negative.
 */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function shortAge(iso: string | null | undefined, now: number = Date.now()): string {
  const at = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(at)) return '';
  const ago = Math.max(0, now - at);
  if (ago < MIN) return 'now';
  if (ago < HOUR) return `${Math.floor(ago / MIN)} min`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)} h`;
  if (ago < WEEK) return `${Math.floor(ago / DAY)} d`;
  if (ago < 5 * WEEK) return `${Math.floor(ago / WEEK)} w`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
