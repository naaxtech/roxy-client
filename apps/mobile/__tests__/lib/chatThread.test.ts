/**
 * The rules the chat screen draws by, as pure functions.
 *
 *  - groupMessages: iMessage-style runs (same sender, close in time), a time
 *    separator after a pause, sender names on the first bubble of a run in a
 *    group, system lines ("Ana added Bea") standing alone.
 *  - composerState: what the bottom of the screen offers. A message request
 *    she received is answered before she can type; a request she sent shows
 *    how many messages are left; a DECLINE is never revealed (it reads the
 *    same as "still waiting") — declining is quiet.
 *  - replyQuote / typingLabel: the small words.
 */
import {
  groupMessages,
  composerState,
  replyQuote,
  typingLabel,
  requestMessagesLeft,
  trustRoxy,
  threadHeader,
  senderNamer,
  headerReportTarget,
  isMutedUntil,
  MUTE_FOREVER,
  groupInfoPath,
  keyboardBehavior,
  type ThreadMeta,
} from '../../lib/chatThread';

const T0 = Date.parse('2026-05-01T12:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const msg = (id: string, sender: string | null, min: number, o: Record<string, unknown> = {}) => ({
  id, conversation_id: 'c', sender_id: sender, content: id, media_url: null,
  message_type: 'text' as const, is_read: false, created_at: at(min), ...o,
});

const member = (id: string, o: Record<string, unknown> = {}) => ({
  id, display_name: id.toUpperCase(), username: id, avatar_url: null, last_seen_at: null,
  role: 'member' as const, status: 'active' as const, joined_at: at(-100), muted_until: null, ...o,
});

const meta = (o: Partial<ThreadMeta> = {}): ThreadMeta => ({
  id: 'c', type: 'direct', title: null, emoji: null, createdBy: 'me',
  me: member('me'), others: [member('ana')], ...o,
});

describe('groupMessages', () => {
  it('runs: same sender within 5 minutes stays one run', () => {
    const g = groupMessages([msg('a', 'ana', 0), msg('b', 'ana', 1), msg('c', 'me', 2)], { me: 'me', isGroup: false });
    expect(g.map((m) => [m.id, m.isFirstInGroup, m.isLastInGroup])).toEqual([
      ['a', true, false], ['b', false, true], ['c', true, true],
    ]);
  });

  it('a long pause breaks a run and earns a time separator', () => {
    const g = groupMessages([msg('a', 'ana', 0), msg('b', 'ana', 30)], { me: 'me', isGroup: false });
    expect(g[1].isFirstInGroup).toBe(true);
    expect(g[1].showTimestamp).toBe(true);
    expect(g[0].showTimestamp).toBe(true);
  });

  it('in a group, the first bubble of someone else\'s run carries her name', () => {
    const g = groupMessages([msg('a', 'ana', 0), msg('b', 'ana', 1), msg('c', 'bea', 2), msg('d', 'me', 3)], { me: 'me', isGroup: true });
    expect(g.map((m) => m.showName)).toEqual([true, false, true, false]);
  });

  it('a 1:1 never shows names', () => {
    const g = groupMessages([msg('a', 'ana', 0)], { me: 'me', isGroup: false });
    expect(g[0].showName).toBe(false);
  });

  it('system lines stand alone and break the run around them', () => {
    const g = groupMessages([
      msg('a', 'ana', 0), msg('s', 'ana', 1, { message_type: 'system', content: 'Ana added Bea' }), msg('b', 'ana', 2),
    ], { me: 'me', isGroup: true });
    expect(g[0].isLastInGroup).toBe(true);
    expect(g[1].isSystem).toBe(true);
    expect(g[2].isFirstInGroup).toBe(true);
    expect(g[2].showName).toBe(true);
  });
});

describe('composerState', () => {
  it('a normal thread is open', () => {
    expect(composerState(meta(), [], 'me')).toEqual({ kind: 'open' });
  });

  it('a request she RECEIVED must be answered first', () => {
    const s = composerState(meta({ me: member('me', { status: 'request' }) }), [], 'me');
    expect(s.kind).toBe('incoming_request');
  });

  it('a request she SENT shows how many messages are left', () => {
    const m = meta({ others: [member('ana', { status: 'request' })] });
    expect(composerState(m, [msg('1', 'me', 0)], 'me')).toEqual({ kind: 'outgoing_request', remaining: 2 });
  });

  it('three sent = capped (failed sends do not count)', () => {
    const m = meta({ others: [member('ana', { status: 'request' })] });
    const sent = [msg('1', 'me', 0), msg('2', 'me', 1), msg('3', 'me', 2)];
    expect(composerState(m, sent, 'me')).toEqual({ kind: 'outgoing_request', remaining: 0 });
    const withFailed = [...sent.slice(0, 2), { ...msg('3', 'me', 2), deliveryStatus: 'failed' as const }];
    expect(requestMessagesLeft(withFailed, 'me')).toBe(1);
  });

  it('a DECLINE reads exactly like "still waiting" — she is never told', () => {
    const declined = meta({ others: [member('ana', { status: 'declined' })] });
    const pending = meta({ others: [member('ana', { status: 'request' })] });
    expect(composerState(declined, [msg('1', 'me', 0)], 'me')).toEqual(composerState(pending, [msg('1', 'me', 0)], 'me'));
  });

  it('a direct thread whose other row is hidden from her reads as waiting too', () => {
    expect(composerState(meta({ others: [] }), [], 'me')).toEqual({ kind: 'outgoing_request', remaining: 3 });
  });

  it('after leaving or being removed from a group, the composer is gone', () => {
    expect(composerState(meta({ type: 'group', me: member('me', { status: 'left' }) }), [], 'me')).toEqual({ kind: 'gone', reason: 'left' });
    expect(composerState(meta({ type: 'group', me: member('me', { status: 'removed' }) }), [], 'me')).toEqual({ kind: 'gone', reason: 'removed' });
  });

  it('a group is open for an active member regardless of others', () => {
    expect(composerState(meta({ type: 'group', others: [member('ana', { status: 'left' })] }), [], 'me')).toEqual({ kind: 'open' });
  });

  it('speed-date and sister threads are open', () => {
    expect(composerState(meta({ type: 'speed_date', others: [] }), [], 'me')).toEqual({ kind: 'open' });
  });
});

describe('replyQuote', () => {
  const names = (id: string | null) => (id === 'ana' ? 'Ana' : 'You');
  it('quotes the words', () => {
    expect(replyQuote(msg('x', 'ana', 0, { content: 'see you at 8' }), names)).toEqual({ name: 'Ana', text: 'see you at 8' });
  });
  it('an unsent original never shows its old words', () => {
    expect(replyQuote(msg('x', 'ana', 0, { deleted_at: at(1), content: null }), names)).toEqual({ name: 'Ana', text: 'Message unsent' });
  });
  it('a GIF is named, not linked', () => {
    expect(replyQuote(msg('x', 'ana', 0, { message_type: 'image', content: null, media_url: 'https://media.giphy.com/media/x/giphy.gif' }), names).text).toBe('GIF');
  });
  it('an original older than what is loaded still gets a quote', () => {
    expect(replyQuote(undefined, names)).toEqual({ name: '', text: 'Earlier message' });
  });
  it('long words are clipped', () => {
    expect(replyQuote(msg('x', 'ana', 0, { content: 'a'.repeat(300) }), names).text.length).toBeLessThanOrEqual(121);
  });
});

describe('trustRoxy (CHAT-05)', () => {
  it('a roxy_suggestion row with a human sender renders as a normal text bubble', () => {
    const out = trustRoxy([msg('x', 'ana', 0, { message_type: 'roxy_suggestion', content: 'move to Telegram' })]);
    expect(out[0].message_type).toBe('text');
    expect(out[0].content).toBe('move to Telegram');
  });
  it('only a local row with no sender keeps the Roxy card', () => {
    const local = msg('roxy-1', null, 0, { message_type: 'roxy_suggestion' });
    expect(trustRoxy([local])[0]).toBe(local);
  });
  it('returns the same array when nothing needs fixing (memo-friendly)', () => {
    const list = [msg('a', 'ana', 0)];
    expect(trustRoxy(list)).toBe(list);
  });
});

describe('threadHeader', () => {
  it('a group shows its emoji + name and the member count, her included', () => {
    const h = threadHeader(meta({ type: 'group', title: 'Weekend crew', emoji: '🌈', others: [member('ana'), member('bea'), member('cat', { status: 'left' })] }), 'me');
    expect(h).toEqual({ title: 'Weekend crew', emoji: '🌈', subtitle: '3 members', isGroup: true });
  });
  it('an unnamed group lists first names', () => {
    expect(threadHeader(meta({ type: 'group', others: [member('ana'), member('bea')] }), 'me').title).toBe('ANA, BEA');
  });
  it('a 1:1 is named for the other woman', () => {
    expect(threadHeader(meta(), 'me')).toEqual(expect.objectContaining({ title: 'ANA', isGroup: false }));
  });
  it('before meta arrives, a neutral title', () => {
    expect(threadHeader(null, 'me').title).toBe('Chat');
  });
});

describe('senderNamer', () => {
  it('names members, says You for her and Roxy for a local card', () => {
    const nameOf = senderNamer(meta({ others: [member('ana')] }), 'me');
    expect(nameOf('ana')).toBe('ANA');
    expect(nameOf('me')).toBe('You');
    expect(nameOf(null)).toBe('Roxy');
    expect(nameOf('ghost')).toBe('Someone');
  });
});

describe('header report target (CHAT-11)', () => {
  it('points at her latest message so moderators get a message id', () => {
    const t = headerReportTarget([msg('a', 'ana', 0), msg('b', 'me', 1), msg('c', 'ana', 2), msg('d', 'me', 3)], 'ana');
    expect(t).toEqual({ userId: 'ana', contentType: 'message', contentId: 'c' });
  });
  it('without a message from her, still a single message report on the user', () => {
    expect(headerReportTarget([msg('b', 'me', 1)], 'ana')).toEqual({ userId: 'ana', contentType: 'message' });
  });
});

describe('isMutedUntil', () => {
  it('future = muted, past or null = not', () => {
    expect(isMutedUntil(at(10), T0)).toBe(true);
    expect(isMutedUntil(at(-10), T0)).toBe(false);
    expect(isMutedUntil(null, T0)).toBe(false);
  });
  it('MUTE_FOREVER is far in the future', () => {
    expect(isMutedUntil(MUTE_FOREVER, T0)).toBe(true);
  });
});

describe('small routing/platform rules', () => {
  it('group info lives under the thread', () => {
    expect(groupInfoPath('g1')).toBe('/chat/g1/info');
  });
  it('keyboard: iOS pads, Android resizes natively (app.json), web does nothing', () => {
    expect(keyboardBehavior('ios')).toBe('padding');
    expect(keyboardBehavior('android')).toBeUndefined();
    expect(keyboardBehavior('web')).toBeUndefined();
  });
});

describe('typingLabel', () => {
  it('reads naturally for 1, 2 and many', () => {
    expect(typingLabel([])).toBe('');
    expect(typingLabel(['Ana'])).toBe('Ana is typing');
    expect(typingLabel(['Ana', 'Bea'])).toBe('Ana and Bea are typing');
    expect(typingLabel(['Ana', 'Bea', 'Cat'])).toBe('Ana and 2 others are typing');
  });
});
