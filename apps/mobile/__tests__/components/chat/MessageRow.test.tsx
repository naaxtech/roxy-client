/**
 * One message in the thread, drawn from the rules in lib/chatThread.
 *
 * Pinned here: the reply quote never shows an unsent message's words, an
 * unsent message keeps its place but loses its text, "Edited" is shown, a
 * group shows who said it, system lines ("Ana added Bea") are centred and
 * not interactive, and swipe-to-reply has an accessibility action so it is
 * reachable without the gesture.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('../../../lib/haptics', () => ({ haptic: jest.fn() }));

import { MessageRow, swipeReplyDecision } from '../../../components/chat/MessageRow';

const msg = (over: Record<string, unknown> = {}) => ({
  id: 'm1', conversation_id: 'c', sender_id: 'ana', content: 'hey you', media_url: null,
  message_type: 'text', is_read: false, created_at: '2026-05-01T12:00:00Z',
  isFirstInGroup: true, isLastInGroup: true, showTimestamp: false, showName: false, isSystem: false,
  ...over,
}) as any;

const base = {
  currentUserId: 'me',
  isGroup: false,
  nameOf: (id: string | null) => (id === 'me' ? 'You' : id === 'ana' ? 'Ana' : 'Someone'),
  reactions: [],
  showReadState: true,
  onLongPress: jest.fn(),
  onReply: jest.fn(),
  onQuotePress: jest.fn(),
  onToggleReaction: jest.fn(),
  onRetry: jest.fn(),
  onUseSuggestion: jest.fn(),
};

describe('MessageRow', () => {
  beforeEach(() => jest.clearAllMocks());

  it('draws her text', () => {
    const { getByText } = render(<MessageRow {...base} message={msg()} />);
    expect(getByText('hey you')).toBeTruthy();
  });

  it('an unsent message keeps its slot but not its words', () => {
    const { getByText, queryByText } = render(
      <MessageRow {...base} message={msg({ content: null, deleted_at: '2026-05-01T12:01:00Z' })} />,
    );
    expect(getByText('Message unsent')).toBeTruthy();
    expect(queryByText('hey you')).toBeNull();
  });

  it('marks an edited message', () => {
    const { getByText } = render(<MessageRow {...base} message={msg({ edited_at: '2026-05-01T12:02:00Z' })} />);
    expect(getByText('Edited')).toBeTruthy();
  });

  it('quotes the message it replies to, and tapping the quote jumps to it', () => {
    const original = msg({ id: 'm0', sender_id: 'me', content: 'want to grab coffee?' });
    const { getByText, getByTestId } = render(
      <MessageRow {...base} message={msg({ reply_to_id: 'm0' })} replyTo={original} />,
    );
    expect(getByText('You')).toBeTruthy();
    expect(getByText('want to grab coffee?')).toBeTruthy();
    fireEvent.press(getByTestId('reply-quote-m1'));
    expect(base.onQuotePress).toHaveBeenCalledWith('m0');
  });

  it('a quote of an unsent message never shows its old words', () => {
    const original = msg({ id: 'm0', content: null, deleted_at: '2026-05-01T12:00:30Z' });
    const { getByText } = render(
      <MessageRow {...base} message={msg({ reply_to_id: 'm0' })} replyTo={original} />,
    );
    expect(getByText('Message unsent')).toBeTruthy();
  });

  it('a reply to something not loaded yet still says it is a reply', () => {
    const { getByText } = render(<MessageRow {...base} message={msg({ reply_to_id: 'm0' })} />);
    expect(getByText('Earlier message')).toBeTruthy();
  });

  it('groups name the sender on the first bubble of her run', () => {
    const { getByText } = render(
      <MessageRow {...base} isGroup message={msg({ showName: true })} />,
    );
    expect(getByText('Ana')).toBeTruthy();
  });

  it('system lines are centred text with no actions', () => {
    const { getByText, queryByTestId } = render(
      <MessageRow {...base} message={msg({ message_type: 'system', sender_id: null, content: 'Ana added Bea', isSystem: true })} />,
    );
    expect(getByText('Ana added Bea')).toBeTruthy();
    expect(queryByTestId('message-m1')).toBeNull();
  });

  it('long-press opens the menu for that message', () => {
    const m = msg();
    const { getByTestId } = render(<MessageRow {...base} message={m} />);
    fireEvent(getByTestId('message-m1'), 'longPress');
    expect(base.onLongPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  it('reply is reachable as an accessibility action (no gesture needed)', () => {
    const { getByTestId } = render(<MessageRow {...base} message={msg()} />);
    fireEvent(getByTestId('message-m1'), 'accessibilityAction', { nativeEvent: { actionName: 'reply' } });
    expect(base.onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  it('only http(s) GIFs render as images; anything else is not fetched', () => {
    const gif = render(<MessageRow {...base} message={msg({ message_type: 'image', content: null, media_url: 'https://media.giphy.com/media/a/giphy.gif' })} />);
    expect(gif.getByTestId('message-gif-m1')).toBeTruthy();
    const other = render(<MessageRow {...base} message={msg({ id: 'm2', message_type: 'image', content: null, media_url: 'chat-media/c/x.jpg' })} />);
    expect(other.queryByTestId('message-gif-m2')).toBeNull();
    expect(other.getByText('Photo')).toBeTruthy();
  });

  it('read state shows only when receipts are on for both (showReadState)', () => {
    const own = msg({ sender_id: 'me', is_read: true });
    const on = render(<MessageRow {...base} message={own} />);
    expect(on.getByLabelText('Read')).toBeTruthy();
    const off = render(<MessageRow {...base} showReadState={false} message={{ ...own, id: 'm3' }} />);
    expect(off.queryByLabelText('Read')).toBeNull();
  });
});

describe('swipeReplyDecision', () => {
  it('a clear horizontal pull past the threshold replies', () => {
    expect(swipeReplyDecision(70, 4)).toBe('reply');
  });
  it('a short or mostly vertical move does not', () => {
    expect(swipeReplyDecision(30, 2)).toBe('none');
    expect(swipeReplyDecision(70, 80)).toBe('none');
    expect(swipeReplyDecision(-90, 0)).toBe('none');
  });
});
