import {
  PENDING_PREFIX, absorbEcho, dropPending, isPending, pendingMessage, settlePending,
} from '../../../components/channels/pendingMessages';
import type { ChannelMessage } from '../../../lib/channels';

const saved = (id: string, body: string, sender = 'me'): ChannelMessage => ({
  id, channel_id: 'c1', sender_id: sender, body,
  created_at: '2026-10-23T10:00:00Z', edited_at: null, deleted_at: null, author: null,
});

describe('optimistic channel messages', () => {
  it('a provisional row is marked pending and carries what she wrote', () => {
    const p = pendingMessage('c1', 'me', 'hello', null, new Date('2026-10-23T10:00:00Z'));
    expect(p.id.startsWith(PENDING_PREFIX)).toBe(true);
    expect(isPending(p)).toBe(true);
    expect(isPending(saved('m1', 'x'))).toBe(false);
    expect(p).toMatchObject({ channel_id: 'c1', sender_id: 'me', body: 'hello', deleted_at: null });
  });

  it('two sends in the same millisecond get different ids', () => {
    const at = new Date('2026-10-23T10:00:00Z');
    expect(pendingMessage('c1', 'me', 'a', null, at).id).not.toBe(pendingMessage('c1', 'me', 'a', null, at).id);
  });

  it('settling swaps the provisional row for the saved one in place', () => {
    const p = pendingMessage('c1', 'me', 'hello', null);
    const list = [saved('m0', 'before', 'her'), p, saved('m2', 'after', 'her')];
    expect(settlePending(list, p.id, saved('m1', 'hello')).map((m) => m.id)).toEqual(['m0', 'm1', 'm2']);
  });

  it('settling after the realtime echo leaves one copy, never two', () => {
    const p = pendingMessage('c1', 'me', 'hello', null);
    const list = [p, saved('m1', 'hello')];
    expect(settlePending(list, p.id, saved('m1', 'hello')).map((m) => m.id)).toEqual(['m1']);
  });

  it('a refused send takes only its own provisional row back out', () => {
    const p = pendingMessage('c1', 'me', 'hello', null);
    const q = pendingMessage('c1', 'me', 'again', null);
    expect(dropPending([p, q], p.id)).toEqual([q]);
  });

  it('the realtime echo of her own pending message replaces it in place', () => {
    const p = pendingMessage('c1', 'me', 'hello', null);
    const list = [saved('m0', 'x', 'her'), p];
    expect(absorbEcho(list, saved('m1', 'hello')).map((m) => m.id)).toEqual(['m0', 'm1']);
    // Somebody else's identical words are not hers.
    expect(absorbEcho(list, saved('m9', 'hello', 'her'))).toBe(list);
  });
});
