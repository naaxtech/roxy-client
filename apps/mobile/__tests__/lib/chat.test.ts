/**
 * The chat data layer (lib/chat.ts) against migration 132's RPCs.
 *
 * What these pin down, because each one was a shipped bug or an audit finding:
 *  - every write goes through an RPC (CHAT-03: no client UPDATE/DELETE on
 *    conversations), and a refused write THROWS — it is never a silent no-op;
 *  - the server's refusal reasons reach her as words she can act on
 *    (rate limit, request cap, 15-minute edit window), never "error";
 *  - a message id is minted on the phone, so a retry is the SAME row
 *    (CHAT-06) — and a retry that hits "duplicate key" is a delivered message,
 *    not a failure.
 */
import {
  chatErrorMessage,
  newMessageId,
  startDirect,
  respondMessageRequest,
  createGroup,
  addGroupMembers,
  removeGroupMember,
  leaveGroup,
  renameGroup,
  setGroupRole,
  muteConversation,
  hideConversation,
  markConversationRead,
  fetchInbox,
  fetchMessagesBadge,
  insertMessage,
  editMessage,
  unsendMessage,
  setChatSettings,
  fetchChatSettings,
  EMPTY_BADGE,
  badgeTotal,
  isMessageRequest,
  threadTitle,
} from '../../lib/chat';

jest.mock('../../lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

const { supabase } = jest.requireMock('../../lib/supabase');

function rpcReturns(data: unknown, error: unknown = null) {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data, error });
}

beforeEach(() => jest.clearAllMocks());

describe('chatErrorMessage', () => {
  it.each([
    [{ code: 'PT429', message: 'rate_limited: slow down a moment' }, /slow down/i],
    [{ code: 'PT429', message: 'rate_limited: you have started a lot of new chats today, try again tomorrow' }, /new chats today/i],
    [{ code: '42501', message: 'request_cap: you can send 3 messages until she accepts' }, /3 messages/],
    [{ code: '42501', message: 'request_text_only: photos and GIFs unlock once she accepts' }, /photos and GIFs/i],
    [{ code: '42501', message: 'request_declined: this message request was not accepted' }, /not accepting/i],
    [{ code: '42501', message: 'media_not_allowed: that image cannot be sent here' }, /image can.t be sent/i],
    [{ code: '42501', message: 'edit_window: messages can be edited or unsent for 15 minutes' }, /15 minutes/],
    [{ code: '42501', message: 'approved members only' }, /approved/i],
    [{ code: 'P0002', message: 'that account is not available' }, /isn.t available/i],
    [{ code: '23514', message: 'new row violates check constraint "messages_content_len"' }, /4,000/],
  ])('turns %j into words she can act on', (err, expected) => {
    expect(chatErrorMessage(err)).toMatch(expected);
  });

  it('passes a group RPC refusal through, capitalised (they are written for people)', () => {
    expect(chatErrorMessage({ code: '42501', message: 'only the group owner or an admin can remove people' }))
      .toBe('Only the group owner or an admin can remove people.');
  });

  it('never shows a raw Postgres error for anything it does not recognise', () => {
    expect(chatErrorMessage({ code: 'XX000', message: 'internal: relation foo does not exist' }))
      .toBe('Something went wrong. Please try again.');
    expect(chatErrorMessage(null)).toBe('Something went wrong. Please try again.');
  });
});

describe('newMessageId', () => {
  it('is a v4 uuid, so the server accepts it as the row id', () => {
    expect(newMessageId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newMessageId()));
    expect(seen.size).toBe(500);
  });
});

describe('RPC wrappers', () => {
  it('startDirect calls start_direct and returns the conversation id', async () => {
    rpcReturns('conv-1');
    await expect(startDirect('her')).resolves.toBe('conv-1');
    expect(supabase.rpc).toHaveBeenCalledWith('start_direct', { p_user: 'her' });
  });

  it('a refused RPC throws with her words on it, never resolves quietly', async () => {
    rpcReturns(null, { code: 'PT429', message: 'rate_limited: you have started a lot of new chats today, try again tomorrow' });
    await expect(startDirect('her')).rejects.toThrow(/new chats today/i);
  });

  it.each([
    [() => respondMessageRequest('c', true), 'respond_message_request', { p_conv: 'c', p_accept: true }],
    [() => createGroup('Weekend crew', ['a', 'b'], '🌈'), 'create_group', { p_title: 'Weekend crew', p_member_ids: ['a', 'b'], p_emoji: '🌈' }],
    [() => addGroupMembers('c', ['a']), 'add_group_members', { p_conv: 'c', p_ids: ['a'] }],
    [() => removeGroupMember('c', 'a'), 'remove_group_member', { p_conv: 'c', p_user: 'a' }],
    [() => leaveGroup('c'), 'leave_group', { p_conv: 'c' }],
    [() => renameGroup('c', 'New', '✨'), 'rename_group', { p_conv: 'c', p_title: 'New', p_emoji: '✨' }],
    [() => setGroupRole('c', 'a', 'admin'), 'set_group_role', { p_conv: 'c', p_user: 'a', p_role: 'admin' }],
    [() => muteConversation('c', null), 'mute_conversation', { p_conv: 'c', p_until: null }],
    [() => hideConversation('c'), 'hide_conversation', { p_conv: 'c' }],
    [() => markConversationRead('c'), 'mark_conversation_read', { p_conversation_id: 'c' }],
    [() => setChatSettings({ readReceipts: false }), 'set_chat_settings', { p_read_receipts: false, p_group_add_permission: null }],
  ])('%#: calls %s with the right arguments', async (call, name, args) => {
    rpcReturns(null);
    await (call as () => Promise<unknown>)();
    expect(supabase.rpc).toHaveBeenCalledWith(name, args);
  });

  it('createGroup sends a blank name as null so the server can name it', async () => {
    rpcReturns('g-1');
    await createGroup('   ', ['a', 'b'], null);
    expect(supabase.rpc).toHaveBeenCalledWith('create_group', { p_title: null, p_member_ids: ['a', 'b'], p_emoji: null });
  });
});

describe('inbox + badge (CHAT-13: the server is the only owner of unread)', () => {
  it('fetchInbox returns inbox_summary rows', async () => {
    const row = { conversation_id: 'c', conversation_type: 'group', unread: 2, members: [] };
    rpcReturns([row]);
    await expect(fetchInbox()).resolves.toEqual([row]);
    expect(supabase.rpc).toHaveBeenCalledWith('inbox_summary');
  });

  it('fetchMessagesBadge fills in missing keys with zero', async () => {
    rpcReturns({ chats: 3, message_requests: 1 });
    await expect(fetchMessagesBadge()).resolves.toEqual({ chats: 3, message_requests: 1, friend_requests: 0, communities: 0 });
  });

  it('badgeTotal adds chats, both kinds of request and community unread', () => {
    expect(badgeTotal({ chats: 3, message_requests: 1, friend_requests: 2, communities: 4 })).toBe(10);
    expect(badgeTotal(EMPTY_BADGE)).toBe(0);
  });

  it('isMessageRequest is true only for a thread waiting on HER answer', () => {
    expect(isMessageRequest({ my_status: 'request' } as never)).toBe(true);
    expect(isMessageRequest({ my_status: 'active' } as never)).toBe(false);
  });

  it('threadTitle names a group by its title, else by its first members', () => {
    expect(threadTitle({ conversation_type: 'group', title: 'Crew', members: [] } as never)).toBe('Crew');
    expect(threadTitle({
      conversation_type: 'group', title: null,
      members: [{ display_name: 'Ana' }, { display_name: 'Bea' }, { display_name: 'Cat' }],
      member_count: 4,
    } as never)).toBe('Ana, Bea, Cat');
    expect(threadTitle({ conversation_type: 'direct', title: null, members: [{ display_name: 'Ana', username: 'ana' }] } as never)).toBe('Ana');
  });
});

describe('messages', () => {
  function mockFrom(result: { data: unknown; error: unknown }, lookup?: { data: unknown; error: unknown }) {
    const single = jest.fn().mockResolvedValue(result);
    const maybeSingle = jest.fn().mockResolvedValue(lookup ?? { data: null, error: null });
    const chain = {
      insert: jest.fn(() => ({ select: jest.fn(() => ({ single })) })),
      update: jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => ({ single })) })) })),
      select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) })),
    };
    (supabase.from as jest.Mock).mockReturnValue(chain);
    return chain;
  }

  it('insertMessage writes the client id, so a retry is the same row', async () => {
    const chain = mockFrom({ data: { id: 'm-1' }, error: null });
    await expect(insertMessage({ id: 'm-1', conversationId: 'c', senderId: 'me', content: 'hi', type: 'text' }))
      .resolves.toEqual({ data: { id: 'm-1' }, error: null });
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'm-1', conversation_id: 'c', sender_id: 'me', content: 'hi', message_type: 'text', reply_to_id: null,
    }));
  });

  it('a duplicate-key retry whose row is already hers counts as delivered (CHAT-06)', async () => {
    mockFrom(
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "messages_pkey"' } },
      { data: { id: 'm-1' }, error: null },
    );
    await expect(insertMessage({ id: 'm-1', conversationId: 'c', senderId: 'me', content: 'hi', type: 'text' }))
      .resolves.toEqual({ data: { id: 'm-1' }, error: null });
  });

  it('a duplicate key that is NOT her row stays a failure', async () => {
    const dup = { code: '23505', message: 'duplicate key' };
    mockFrom({ data: null, error: dup }, { data: null, error: null });
    await expect(insertMessage({ id: 'm-1', conversationId: 'c', senderId: 'me', content: 'hi', type: 'text' }))
      .resolves.toEqual({ data: null, error: dup });
  });

  it('editMessage updates content only and throws her words on a refusal', async () => {
    const chain = mockFrom({ data: null, error: { code: '42501', message: 'edit_window: messages can be edited or unsent for 15 minutes' } });
    await expect(editMessage('m-1', 'fixed')).rejects.toThrow(/15 minutes/);
    expect(chain.update).toHaveBeenCalledWith({ content: 'fixed' });
  });

  it('unsendMessage sets deleted_at (the server stamps the time and keeps a copy for moderators)', async () => {
    const chain = mockFrom({ data: { id: 'm-1' }, error: null });
    await unsendMessage('m-1');
    expect(chain.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
  });
});

describe('chat settings', () => {
  it('falls back to the defaults when she has never saved any', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn(() => ({ maybeSingle })) });
    await expect(fetchChatSettings()).resolves.toEqual({ read_receipts: true, group_add_permission: 'friends' });
  });
});
