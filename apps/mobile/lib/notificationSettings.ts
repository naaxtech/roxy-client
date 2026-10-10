import { supabase } from './supabase';

/**
 * Her push preferences (table `notification_settings`, migration 129).
 *
 * Defaults (Nicole, 2026-10-04): every type ON, lock-screen previews OFF. They
 * mirror the SQL column defaults and `DEFAULT_PREFS` in
 * supabase/functions/_shared/pushCore.ts — the dispatcher applies the same
 * defaults to a user with no row, so what this screen shows is what she gets.
 */
export type NotificationSettings = {
  push_enabled: boolean;
  messages: boolean;
  friends: boolean;
  events: boolean;
  community_chats: boolean;
  /** Someone sent her post a ✿, commented, replied or followed her (migration 133). */
  activity: boolean;
  show_previews: boolean;
  /** 'HH:MM' local time, or null. */
  quiet_start: string | null;
  quiet_end: string | null;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  push_enabled: true,
  messages: true,
  friends: true,
  events: true,
  community_chats: true,
  activity: true,
  show_previews: false,
  quiet_start: null,
  quiet_end: null,
};

export function isValidQuietTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

const hhmm = (t: unknown): string | null =>
  typeof t === 'string' && t.length >= 5 ? t.slice(0, 5) : null;

/** Her settings, or the defaults if she has never saved. Throws on a failed read. */
export async function loadNotificationSettings(userId: string): Promise<NotificationSettings> {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('push_enabled, messages, friends, events, community_chats, activity, show_previews, quiet_start, quiet_end')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_NOTIFICATION_SETTINGS };
  const row = data as Record<string, unknown>;
  return {
    push_enabled: row.push_enabled !== false,
    messages: row.messages !== false,
    friends: row.friends !== false,
    events: row.events !== false,
    community_chats: row.community_chats !== false,
    activity: row.activity !== false,
    show_previews: row.show_previews === true,
    quiet_start: hhmm(row.quiet_start),
    quiet_end: hhmm(row.quiet_end),
  };
}

/** The device's IANA timezone, so quiet hours mean her night, not UTC's. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Save all of her settings. Throws on failure so the caller can roll the switch back. */
export async function saveNotificationSettings(
  userId: string,
  s: NotificationSettings,
  timezone: string = deviceTimezone(),
): Promise<void> {
  const start = s.quiet_start;
  const end = s.quiet_end;
  if ((start === null) !== (end === null)) {
    throw new Error('Quiet hours need both a start and an end.');
  }
  if ((start && !isValidQuietTime(start)) || (end && !isValidQuietTime(end))) {
    throw new Error('Quiet hours must be times like 22:00.');
  }
  const { error } = await supabase.from('notification_settings').upsert(
    { user_id: userId, ...s, timezone, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );
  if (error) throw error;
}
