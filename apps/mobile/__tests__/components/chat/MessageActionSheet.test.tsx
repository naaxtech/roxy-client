/**
 * Long-press a message → one sheet: react, reply, copy, edit, unsend, report.
 *
 * What it offers depends on whose message it is and how old (edit/unsend
 * only on her own, within 15 minutes; edit only on text; report only on
 * someone else's). Copy goes through expo-clipboard. Every action closes the
 * sheet so nothing is left floating over the thread.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../lib/haptics', () => ({ haptic: jest.fn() }));

import { MessageActionSheet } from '../../../components/chat/MessageActionSheet';

const NOW = Date.parse('2026-05-01T12:00:00Z');
const base = {
  id: 'm1', conversation_id: 'c', sender_id: 'me', content: 'hello there', media_url: null,
  message_type: 'text' as const, is_read: false, created_at: new Date(NOW - 60_000).toISOString(),
};

const handlers = () => ({
  onClose: jest.fn(),
  onReact: jest.fn(),
  onMoreReactions: jest.fn(),
  onReply: jest.fn(),
  onCopy: jest.fn(),
  onEdit: jest.fn(),
  onUnsend: jest.fn(),
  onReport: jest.fn(),
});

const renderSheet = (message: any, h = handlers(), me = 'me') =>
  ({ h, view: render(<MessageActionSheet message={message} currentUserId={me} now={NOW} {...h} />) });

describe('MessageActionSheet', () => {
  it('her own fresh text: react, reply, copy, edit, unsend — no report', () => {
    const { view } = renderSheet(base);
    for (const id of ['msg-action-reply', 'msg-action-copy', 'msg-action-edit', 'msg-action-unsend']) {
      expect(view.getByTestId(id)).toBeTruthy();
    }
    expect(view.queryByTestId('msg-action-report')).toBeNull();
    expect(view.getByTestId('msg-react-❤️')).toBeTruthy();
  });

  it('her own message past 15 minutes: no edit, no unsend', () => {
    const { view } = renderSheet({ ...base, created_at: new Date(NOW - 16 * 60_000).toISOString() });
    expect(view.queryByTestId('msg-action-edit')).toBeNull();
    expect(view.queryByTestId('msg-action-unsend')).toBeNull();
  });

  it('her own GIF: unsend yes, edit no, copy no', () => {
    const { view } = renderSheet({ ...base, message_type: 'image', content: null, media_url: 'https://media.giphy.com/media/x/giphy.gif' });
    expect(view.getByTestId('msg-action-unsend')).toBeTruthy();
    expect(view.queryByTestId('msg-action-edit')).toBeNull();
    expect(view.queryByTestId('msg-action-copy')).toBeNull();
  });

  it("someone else's message: report, never edit/unsend", () => {
    const { view } = renderSheet({ ...base, sender_id: 'ana' });
    expect(view.getByTestId('msg-action-report')).toBeTruthy();
    expect(view.queryByTestId('msg-action-edit')).toBeNull();
    expect(view.queryByTestId('msg-action-unsend')).toBeNull();
  });

  it('a message still sending offers nothing that needs a server id', () => {
    const { view } = renderSheet({ ...base, deliveryStatus: 'sending' });
    expect(view.queryByTestId('msg-action-reply')).toBeNull();
    expect(view.queryByTestId('msg-action-edit')).toBeNull();
    expect(view.queryByTestId('msg-react-❤️')).toBeNull();
    expect(view.getByTestId('msg-action-copy')).toBeTruthy();
  });

  it('each action fires with the message and closes the sheet', () => {
    const { h, view } = renderSheet({ ...base, sender_id: 'ana' });
    fireEvent.press(view.getByTestId('msg-react-❤️'));
    expect(h.onReact).toHaveBeenCalledWith('m1', '❤️');
    fireEvent.press(view.getByTestId('msg-action-reply'));
    expect(h.onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    fireEvent.press(view.getByTestId('msg-action-copy'));
    expect(h.onCopy).toHaveBeenCalledWith('hello there');
    fireEvent.press(view.getByTestId('msg-action-report'));
    expect(h.onReport).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    expect(h.onClose).toHaveBeenCalledTimes(4);
  });

  it('reacting from the sheet is a committed reaction: one light tap (§3.3)', () => {
    const { haptic } = jest.requireMock('../../../lib/haptics') as { haptic: jest.Mock };
    haptic.mockClear();
    const { view } = renderSheet({ ...base, sender_id: 'ana' });
    fireEvent.press(view.getByTestId('msg-react-❤️'));
    expect(haptic.mock.calls).toEqual([['tap']]);
  });

  it('shows a preview of the message it acts on', () => {
    const { view } = renderSheet(base);
    expect(view.getByText('hello there')).toBeTruthy();
  });

  it('nothing to show when no message is selected', () => {
    const { view } = renderSheet(null);
    expect(view.queryByTestId('message-action-sheet')).toBeNull();
  });
});
