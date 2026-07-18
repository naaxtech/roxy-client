import { supabase } from './supabase';

export type RoxyNotification = {
  id: string;
  type: 'friend_request' | 'friend_accept' | 'community_event';
  title: string;
  body: string | null;
  link_path: string | null;
  created_at: string;
  read_at: string | null;
};

/**
 * Latest 50 notifications for the user. Returns [] on any failure so screens
 * render an empty state on projects where migration 057 isn't applied yet.
 */
export async function fetchNotifications(userId: string): Promise<RoxyNotification[]> {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, title, body, link_path, created_at, read_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error || !data) return [];
    return data as RoxyNotification[];
  } catch {
    return [];
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  } catch {
    // non-fatal — the row stays unread and can be retried on next open
  }
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  try {
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
  } catch {
    // non-fatal
  }
}

export function countUnread(list: RoxyNotification[]): number {
  return list.filter((n) => n.read_at === null).length;
}

/**
 * Unread count only — a head request transfers a single integer instead of
 * full rows, which is all the Grow bell badge needs. Returns 0 on failure.
 */
export async function fetchUnreadNotificationCount(userId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error || count === null) return 0;
    return count;
  } catch {
    return 0;
  }
}
