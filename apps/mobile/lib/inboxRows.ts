import { format, isToday, isYesterday } from 'date-fns';
import { memberName, threadTitle, type InboxThread } from './chat';

/**
 * One inbox row — a person (direct) or a private group.
 *
 * `participant_ids`, `partner` and `lastMessagePreview` keep the shape the
 * inbox list has always rendered; the group fields are additions.
 */
export type InboxRow = {
  id: string;
  kind: 'direct' | 'group';
  participant_ids: string[];
  last_message_at: string | null;
  partner: { id: string; display_name: string; username: string } | null;
  lastMessagePreview: string;
  unreadCount: number;
  title: string;
  emoji: string | null;
  memberCount: number;
  /** Up to three member names, for the stacked group avatar. */
  memberNames: string[];
  muted: boolean;
  /** Partner's last_seen_at (direct only). */
  lastSeenAt: string | null;
};

export function formatInboxTime(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd MMM');
}

/**
 * The preview line. An unsent message never shows its old words, media is
 * named not linked, and a group line says who spoke.
 */
export function previewLine(t: InboxThread, me: string): string {
  const m = t.last_message;
  if (!m) return 'Say hello 👋';
  if (m.deleted) return 'Message unsent';
  if (m.message_type === 'system') return m.content ?? '';
  if (m.message_type === 'roxy_suggestion') return '✨ Roxy suggestion';

  const body = m.message_type === 'image' ? 'GIF' : (m.content ?? '');
  if (m.sender_id === me) return `You: ${body}`;
  if (t.conversation_type === 'group') {
    const who = t.members.find((x) => x.id === m.sender_id);
    return `${who ? memberName(who) : 'Someone'}: ${body}`;
  }
  return body;
}

export function inboxRowFromThread(t: InboxThread, me: string, now: number = Date.now()): InboxRow {
  const first = t.members[0] ?? null;
  const isGroup = t.conversation_type === 'group';
  return {
    id: t.conversation_id,
    kind: isGroup ? 'group' : 'direct',
    participant_ids: isGroup ? [] : [me, ...(first ? [first.id] : [])],
    last_message_at: t.last_message_at ?? t.created_at,
    partner: !isGroup && first
      ? { id: first.id, display_name: memberName(first), username: first.username ?? '' }
      : null,
    lastMessagePreview: previewLine(t, me),
    unreadCount: t.unread,
    title: threadTitle(t),
    emoji: t.avatar_emoji,
    memberCount: t.member_count,
    memberNames: t.members.slice(0, 3).map(memberName),
    muted: !!t.muted_until && Date.parse(t.muted_until) > now,
    lastSeenAt: !isGroup ? first?.last_seen_at ?? null : null,
  };
}
