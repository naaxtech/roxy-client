/**
 * useThreadMeta: who is in this thread and in what state, from the mockTables
 * migration 132 made the source of truth (conversation_members), joined to
 * profiles. It reloads when membership or the group's name changes, so a
 * removal, a rename or an accepted request shows without leaving the screen.
 */
import { renderHook, waitFor, act } from '@testing-library/react-native';

const mockHandlers: Record<string, () => void> = {};
const mockChannel = {
  on: jest.fn((_e: string, f: { table: string }, cb: () => void) => { mockHandlers[f.table] = cb; return mockChannel; }),
  subscribe: jest.fn(() => mockChannel),
};
const mockTables: Record<string, any> = {};
function mockQuery(table: string) {
  const q: any = {
    select: () => q,
    eq: () => q,
    in: () => q,
    maybeSingle: () => Promise.resolve({ data: mockTables[table], error: null }),
    then: (res: (v: unknown) => void) => res({ data: mockTables[table], error: null }),
  };
  return q;
}
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((t: string) => mockQuery(t)),
    removeChannel: jest.fn(),
  },
}));
jest.mock('../../lib/realtimeChannel', () => ({ freshChannel: jest.fn(() => mockChannel) }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { useThreadMeta } from '../../hooks/useThreadMeta';

beforeEach(() => {
  jest.clearAllMocks();
  mockTables.conversations = { id: 'g', conversation_type: 'group', title: 'Weekend crew', avatar_emoji: '🌈', created_by: 'me', participant_ids: [] };
  mockTables.conversation_members = [
    { user_id: 'me', role: 'owner', status: 'active', joined_at: '2026-01-01T00:00:00Z', last_read_at: '2026-01-02T00:00:00Z', muted_until: null },
    { user_id: 'ana', role: 'member', status: 'active', joined_at: '2026-01-01T00:00:01Z', last_read_at: null, muted_until: null },
    { user_id: 'bea', role: 'admin', status: 'left', joined_at: '2026-01-01T00:00:02Z', last_read_at: null, muted_until: null },
  ];
  mockTables.profiles = [
    { id: 'me', display_name: 'Me', username: 'me', avatar_url: null, last_seen_at: null },
    { id: 'ana', display_name: 'Ana', username: 'ana', avatar_url: null, last_seen_at: null },
    { id: 'bea', display_name: 'Bea', username: 'bea', avatar_url: null, last_seen_at: null },
  ];
});

describe('useThreadMeta', () => {
  it('splits her own row from the others and joins names', async () => {
    const { result } = renderHook(() => useThreadMeta('g', 'me'));
    await waitFor(() => expect(result.current.meta).not.toBeNull());
    const meta = result.current.meta!;
    expect(meta.type).toBe('group');
    expect(meta.title).toBe('Weekend crew');
    expect(meta.me).toEqual(expect.objectContaining({ id: 'me', role: 'owner', last_read_at: '2026-01-02T00:00:00Z' }));
    expect(meta.others.map((o) => [o.display_name, o.status])).toEqual([['Ana', 'active'], ['Bea', 'left']]);
  });

  it('a thread she cannot read (blocked / gone) is unavailable, not an endless spinner', async () => {
    mockTables.conversations = null;
    const { result } = renderHook(() => useThreadMeta('g', 'me'));
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.meta).toBeNull();
  });

  it('reloads when membership or the group itself changes', async () => {
    const { result } = renderHook(() => useThreadMeta('g', 'me'));
    await waitFor(() => expect(result.current.meta).not.toBeNull());
    mockTables.conversations = { ...mockTables.conversations, title: 'Renamed' };
    await act(async () => { mockHandlers.conversations(); });
    await waitFor(() => expect(result.current.meta?.title).toBe('Renamed'));
    mockTables.conversation_members[0] = { ...mockTables.conversation_members[0], status: 'removed' };
    await act(async () => { mockHandlers.conversation_members(); });
    await waitFor(() => expect(result.current.meta?.me?.status).toBe('removed'));
  });
});
