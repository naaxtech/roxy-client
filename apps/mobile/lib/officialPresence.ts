/**
 * The official-profile "online now" line from Claude Design.
 *
 * A count with no names is a ghost town. Names with no window is a lie —
 * last_seen older than ten minutes is not online.
 */

export const ONLINE_WINDOW_MS = 10 * 60 * 1000;

export type PresenceMember = {
  display_name: string | null;
  last_seen_at: string | null;
};

export function officialPresenceLine(
  members: PresenceMember[],
  now: number,
): { count: number; label: string } | null {
  const online = members.filter((m) => {
    if (!m.last_seen_at) return false;
    const seen = Date.parse(m.last_seen_at);
    return Number.isFinite(seen) && now - seen <= ONLINE_WINDOW_MS;
  });
  if (online.length === 0) return null;

  const names = online
    .map((m) => (m.display_name ?? '').trim())
    .filter(Boolean);
  const shown = names.slice(0, 3);
  const leftover = online.length > 3;
  const who = leftover ? `${shown.join(', ')} and others` : shown.join(', ');
  return {
    count: online.length,
    label: who ? `${online.length} online now · ${who}` : `${online.length} online now`,
  };
}
