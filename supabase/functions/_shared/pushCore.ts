// The push pipeline's pure core: no network, no database.
//
// Everything the dispatcher decides about a single notification lives here —
// whether it is pushed at all, what words reach the lock screen, which Android
// channel it rings on, how bursts merge, and what to do with Expo's answer — so
// the decisions are unit-tested (pushCore.test.ts) and the dispatcher is only
// plumbing.
//
// Privacy rule (Nicole, 2026-10-04): lock-screen previews are OFF by default.
// With previews off a push carries only the sender's display name and a generic
// line — never message text, never a channel, community or event name. A lock
// screen is the most public surface a phone has, and for a woman who is not out
// to the people around her "Dyke March London has a new event" is an outing.

export type NotificationType =
  | 'message'
  | 'channel_message'
  | 'friend_request'
  | 'friend_accept'
  | 'community_event';

export type PrefKey = 'messages' | 'community_chats' | 'friends' | 'events';

/** Android notification channel ids; created by the app (lib/push.ts). */
export type ChannelId = 'messages' | 'community' | 'friends' | 'events' | 'quiet';

export type PushPrefs = {
  push_enabled: boolean;
  messages: boolean;
  friends: boolean;
  events: boolean;
  community_chats: boolean;
  show_previews: boolean;
  /** 'HH:MM' in her timezone, or null for no quiet hours. */
  quiet_start: string | null;
  quiet_end: string | null;
  timezone: string;
};

/** Defaults when she has never opened notification settings. Mirrors the SQL defaults. */
export const DEFAULT_PREFS: PushPrefs = {
  push_enabled: true,
  messages: true,
  friends: true,
  events: true,
  community_chats: true,
  show_previews: false,
  quiet_start: null,
  quiet_end: null,
  timezone: 'UTC',
};

export type QueuedNotification = {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  title: string | null;
  body: string | null;
  link_path: string | null;
  /** Display name of the actor, resolved by the dispatcher. */
  actor_name: string | null;
};

/** One Expo push message (https://docs.expo.dev/push-notifications/sending-notifications/). */
export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: { url: string; notification_id: string; type: string };
  channelId: ChannelId;
  sound: 'default' | null;
  priority: 'high' | 'normal';
  interruptionLevel: 'active' | 'passive';
  collapseId: string;
  threadId: string;
  ttl: number;
};

const CATEGORY: Record<NotificationType, { pref: PrefKey; channel: Exclude<ChannelId, 'quiet'> }> = {
  message: { pref: 'messages', channel: 'messages' },
  channel_message: { pref: 'community_chats', channel: 'community' },
  friend_request: { pref: 'friends', channel: 'friends' },
  friend_accept: { pref: 'friends', channel: 'friends' },
  community_event: { pref: 'events', channel: 'events' },
};

/** Which preference gates a type, and which channel it rings on. Unknown types are never pushed. */
export function categoryOf(type: string): { pref: PrefKey; channel: Exclude<ChannelId, 'quiet'> } | null {
  return (CATEGORY as Record<string, { pref: PrefKey; channel: Exclude<ChannelId, 'quiet'> }>)[type] ?? null;
}

/** The lock-screen words when previews are off. Sender name only where a sender exists. */
function privateCopy(n: QueuedNotification): { title: string; body: string } {
  const who = clip(n.actor_name, 60) || 'Someone';
  switch (n.type) {
    case 'message':
      return { title: who, body: 'New message' };
    case 'friend_request':
      return { title: who, body: 'Sent you a friend request' };
    case 'friend_accept':
      return { title: who, body: 'Accepted your friend request' };
    case 'channel_message':
      return { title: 'Roxy', body: 'New message in a community chat' };
    case 'community_event':
      return { title: 'Roxy', body: 'A community you joined posted a new event' };
    default:
      return { title: 'Roxy', body: 'You have a new notification' };
  }
}

/** The words when she has turned previews on. */
function fullCopy(n: QueuedNotification): { title: string; body: string } {
  if (n.type === 'message') {
    return { title: clip(n.actor_name, 60) || 'Roxy', body: clip(n.body, 180) || 'New message' };
  }
  return { title: clip(n.title, 80) || 'Roxy', body: clip(n.body, 180) || privateCopy(n).body };
}

function clip(s: string | null | undefined, max: number): string {
  const t = (s ?? '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * The deep link a tap opens. Only app-relative paths become `roxy://` links;
 * anything else (an absolute URL that slipped into link_path) opens the
 * notifications list instead of an arbitrary destination.
 */
function deepLink(path: string | null): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return 'roxy://notifications';
  const clean = path.replace(/^\/\(tabs\)/, '');
  return `roxy://${clean.replace(/^\/+/, '')}`;
}

/**
 * The Expo message for one notification on one device, or null when it must
 * not be pushed (master switch off, the type switched off, or an unknown type).
 */
export function buildMessage(
  n: QueuedNotification,
  prefs: PushPrefs,
  token: string,
  quiet: boolean,
): ExpoMessage | null {
  const cat = categoryOf(n.type);
  if (!cat) return null;
  if (!prefs.push_enabled || !prefs[cat.pref]) return null;

  const copy = prefs.show_previews ? fullCopy(n) : privateCopy(n);
  // One stack per sender per destination: five messages from Maya in the same
  // chat replace each other on the lock screen instead of piling up.
  const group = `${n.type}:${n.actor_id ?? 'roxy'}:${n.link_path ?? ''}`;

  return {
    to: token,
    title: copy.title,
    body: copy.body,
    data: { url: deepLink(n.link_path), notification_id: n.id, type: n.type },
    channelId: quiet ? 'quiet' : cat.channel,
    sound: quiet ? null : 'default',
    priority: quiet ? 'normal' : 'high',
    interruptionLevel: quiet ? 'passive' : 'active',
    collapseId: group.slice(0, 64),
    threadId: group,
    // A message older than a day is noise on a lock screen; the in-app list
    // still has it.
    ttl: 60 * 60 * 24,
  };
}

function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function localMinutes(now: Date, timezone: string): number {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timezone || 'UTC');
  } catch {
    parts = fmt('UTC');
  }
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return (h % 24) * 60 + m;
}

/** Is `now` inside her quiet hours? Start inclusive, end exclusive; windows may cross midnight. */
export function inQuietHours(prefs: PushPrefs, now: Date): boolean {
  if (!prefs.quiet_start || !prefs.quiet_end) return false;
  const start = minutesOf(prefs.quiet_start);
  const end = minutesOf(prefs.quiet_end);
  if (start === null || end === null || start === end) return false;
  const t = localMinutes(now, prefs.timezone);
  return start < end ? t >= start && t < end : t >= start || t < end;
}

export function isExpoPushToken(token: string): boolean {
  return token.length <= 200 && /^Expo(nent)?PushToken\[[^\]]{1,180}\]$/.test(token);
}

export type ExpoTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type TicketOutcome =
  | { kind: 'sent'; ticketId: string }
  | { kind: 'dead-token' }
  | { kind: 'retry' }
  | { kind: 'failed'; error: string };

/**
 * What one Expo ticket (or receipt) means for the outbox row.
 *
 *  - DeviceNotRegistered: the app was uninstalled or permission revoked. Stop
 *    sending to that token; nothing to retry.
 *  - MessageRateExceeded / InvalidCredentials / anything transient: retry with
 *    backoff. A credentials error is a configuration problem on our side; the
 *    message is retried so it lands once the credential is fixed rather than
 *    being dropped.
 *  - MessageTooBig and other permanent errors: give up on this message.
 */
export function classifyTicket(t: ExpoTicket | undefined): TicketOutcome {
  if (!t) return { kind: 'retry' };
  if (t.status === 'ok' && t.id) return { kind: 'sent', ticketId: t.id };
  const code = t.details?.error ?? '';
  if (code === 'DeviceNotRegistered') return { kind: 'dead-token' };
  if (code === 'MessageTooBig') return { kind: 'failed', error: code };
  return { kind: 'retry' };
}

/** Seconds to wait before attempt n+1 (n starts at 1). Capped at one hour. */
export function backoffSeconds(attempt: number): number {
  return Math.min(3600, 15 * 2 ** Math.max(0, attempt - 1));
}

/** Expo accepts at most 100 messages per request. */
export function chunk<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
