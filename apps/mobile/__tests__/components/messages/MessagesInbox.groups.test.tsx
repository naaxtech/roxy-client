/**
 * Private groups share the DIRECT list with 1:1 chats (they are private
 * conversations, not communities) but read differently: an emoji or stacked
 * initials avatar, the group's name, member count for screen readers, and a
 * muted thread dims with a quiet grey count.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import { MessagesInbox } from '../../../components/messages/MessagesInbox';

const aGroup = {
  id: 'g1',
  kind: 'group' as const,
  participant_ids: [],
  last_message_at: '2026-09-06T11:21:00Z',
  partner: null,
  lastMessagePreview: 'Ana: pizza at 8?',
  unreadCount: 4,
  title: 'Weekend crew',
  emoji: '🌈',
  memberCount: 5,
  memberNames: ['Ana', 'Bea', 'Cat'],
  muted: false,
};

const renderInbox = (chats: any[]) =>
  render(
    <MessagesInbox
      chats={chats}
      communities={[]}
      unreadCounts={{}}
      onOpenDm={jest.fn()}
      onOpenCommunity={jest.fn()}
      onStartChat={jest.fn()}
      formatTime={() => '11:21'}
      isPartnerOnline={() => false}
    />,
  );

describe('MessagesInbox — private groups', () => {
  it('draws a group row with its name, emoji and preview', () => {
    const view = renderInbox([aGroup]);
    expect(view.getByTestId('inbox-group-g1')).toBeTruthy();
    expect(view.getByText('Weekend crew')).toBeTruthy();
    expect(view.getByText('🌈')).toBeTruthy();
    expect(view.getByText('Ana: pizza at 8?')).toBeTruthy();
    expect(view.getByText('4')).toBeTruthy();
  });

  it('tells a screen reader it is a group and how many are in it', () => {
    const view = renderInbox([aGroup]);
    expect(view.getByLabelText('Weekend crew, group of 5, 4 unread')).toBeTruthy();
  });

  it('a group without an emoji shows its members\' initials', () => {
    const view = renderInbox([{ ...aGroup, emoji: null }]);
    expect(view.getByText('A')).toBeTruthy();
    expect(view.getByText('B')).toBeTruthy();
  });

  it('a muted thread says so', () => {
    const view = renderInbox([{ ...aGroup, muted: true }]);
    expect(view.getByTestId('inbox-muted-g1')).toBeTruthy();
    expect(view.getByLabelText(/muted/)).toBeTruthy();
  });

  it('opens the group like any chat', () => {
    const onOpenDm = jest.fn();
    const view = render(
      <MessagesInbox
        chats={[aGroup]}
        communities={[]}
        unreadCounts={{}}
        onOpenDm={onOpenDm}
        onOpenCommunity={jest.fn()}
        onStartChat={jest.fn()}
        formatTime={() => ''}
        isPartnerOnline={() => false}
      />,
    );
    fireEvent.press(view.getByTestId('inbox-group-g1'));
    expect(onOpenDm).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }));
  });
});
