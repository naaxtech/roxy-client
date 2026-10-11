/**
 * What an inbox row SAYS, from an inbox_summary() thread.
 *
 * The preview line is where the privacy and safety rules show up in the UI:
 * an unsent message never shows its old words, a GIF is "GIF" not a URL, a
 * group line names who spoke, and a message request never puts a stranger's
 * text in the main list (it lives under Requests, CHAT-02).
 */
import { inboxRowFromThread, previewLine, formatInboxTime } from '../../lib/inboxRows';
import type { InboxThread } from '../../lib/chat';

const base = (o: Partial<InboxThread> = {}): InboxThread => ({
  conversation_id: 'c1',
  conversation_type: 'direct',
  title: null,
  avatar_emoji: null,
  my_status: 'active',
  my_role: 'member',
  muted_until: null,
  hidden_at: null,
  last_message_at: '2026-01-01T10:00:00Z',
  created_at: '2026-01-01T09:00:00Z',
  created_by: null,
  last_message: null,
  unread: 0,
  member_count: 2,
  members: [{ id: 'ana', display_name: 'Ana', username: 'ana', avatar_url: null, last_seen_at: null, status: 'active', role: 'member' }],
  ...o,
});

const lm = (o: Record<string, unknown>) => ({
  id: 'm', sender_id: 'ana', message_type: 'text', content: 'hi', deleted: false,
  created_at: '2026-01-01T10:00:00Z', is_read: false, ...o,
});

describe('previewLine', () => {
  it('no message yet', () => {
    expect(previewLine(base(), 'me')).toBe('Say hello 👋');
  });
  it('her own message is prefixed You:', () => {
    expect(previewLine(base({ last_message: lm({ sender_id: 'me', content: 'on my way' }) }), 'me')).toBe('You: on my way');
  });
  it('a DM from the other woman has no prefix', () => {
    expect(previewLine(base({ last_message: lm({ content: 'see you' }) }), 'me')).toBe('see you');
  });
  it('a group line names who spoke', () => {
    const t = base({ conversation_type: 'group', last_message: lm({ content: 'pizza?' }) });
    expect(previewLine(t, 'me')).toBe('Ana: pizza?');
  });
  it('an unsent message never shows its old words', () => {
    expect(previewLine(base({ last_message: lm({ deleted: true, content: null }) }), 'me')).toBe('Message unsent');
  });
  it('a GIF / image is described, never shown as a URL', () => {
    expect(previewLine(base({ last_message: lm({ message_type: 'image', content: null }) }), 'me')).toBe('GIF');
  });
  it('a system line is shown as-is', () => {
    expect(previewLine(base({ conversation_type: 'group', last_message: lm({ message_type: 'system', content: 'Ana added Bea' }) }), 'me'))
      .toBe('Ana added Bea');
  });
  it('a Roxy card reads as a suggestion', () => {
    expect(previewLine(base({ last_message: lm({ message_type: 'roxy_suggestion', sender_id: null }) }), 'me'))
      .toBe('✨ Roxy suggestion');
  });
});

describe('inboxRowFromThread', () => {
  it('a DM row carries the partner, unread and online state', () => {
    const row = inboxRowFromThread(base({ unread: 3 }), 'me');
    expect(row).toEqual(expect.objectContaining({
      id: 'c1', kind: 'direct', unreadCount: 3,
      partner: { id: 'ana', display_name: 'Ana', username: 'ana' },
      participant_ids: ['me', 'ana'],
    }));
  });

  it('a group row is named by its title, else by its members, and carries the emoji', () => {
    const named = inboxRowFromThread(base({ conversation_type: 'group', title: 'Weekend crew', avatar_emoji: '🌈', member_count: 5 }), 'me');
    expect(named.kind).toBe('group');
    expect(named.title).toBe('Weekend crew');
    expect(named.emoji).toBe('🌈');
    expect(named.memberCount).toBe(5);
    expect(named.partner).toBeNull();
  });

  it('a muted thread is marked so the row can dim', () => {
    const row = inboxRowFromThread(base({ muted_until: '2999-01-01T00:00:00Z' }), 'me', Date.parse('2026-01-01T00:00:00Z'));
    expect(row.muted).toBe(true);
  });

  it('an expired mute is not a mute', () => {
    const row = inboxRowFromThread(base({ muted_until: '2025-01-01T00:00:00Z' }), 'me', Date.parse('2026-01-01T00:00:00Z'));
    expect(row.muted).toBe(false);
  });
});

describe('formatInboxTime', () => {
  it('empty for no timestamp', () => {
    expect(formatInboxTime(null)).toBe('');
  });
});
