import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import { MessagesInbox } from '../../../components/messages/MessagesInbox';

const aDm = {
  id: 'dm1',
  participant_ids: ['u1', 'u2'],
  last_message_at: '2026-09-06T11:21:00Z',
  partner: { id: 'u2', display_name: 'Priya Shah', username: 'priya' },
  lastMessagePreview: 'save me a seat',
  unreadCount: 1,
};

const aCommunity = {
  id: 'c1',
  name: 'WLW London',
  member_count: 1240,
  channelCount: 4,
  preview: '#general · Tasha: I can do a cab-share from Soho',
  unreadCount: 2,
};

const renderInbox = (
  over: Partial<React.ComponentProps<typeof MessagesInbox>> = {},
) =>
  render(
    <MessagesInbox
      chats={[aDm]}
      communities={[aCommunity]}
      unreadCounts={{ dm1: 1 }}
      onOpenDm={jest.fn()}
      onOpenCommunity={jest.fn()}
      onStartChat={jest.fn()}
      formatTime={() => '11:21'}
      isPartnerOnline={() => false}
      {...over}
    />,
  );

describe('MessagesInbox — Direct and Community are two lists', () => {
  it('labels both sections the way the prototype does', () => {
    const view = renderInbox();
    expect(view.getByTestId('inbox-section-direct')).toBeTruthy();
    expect(view.getByTestId('inbox-section-community')).toBeTruthy();
    expect(view.getByText('DIRECT')).toBeTruthy();
    expect(view.getByText('COMMUNITY CHATS')).toBeTruthy();
  });

  it('still shows Community chats when there are no private messages', () => {
    // The old inbox stuffed communities in the DM list footer. An empty DM
    // list then drew a full-screen empty and made group chat look missing.
    const view = renderInbox({ chats: [] });
    expect(view.getByTestId('inbox-section-community')).toBeTruthy();
    expect(view.getByTestId('inbox-community-c1')).toBeTruthy();
    expect(view.getByText('WLW London')).toBeTruthy();
    expect(view.queryByText('No messages yet')).toBeNull();
    expect(view.getByTestId('inbox-direct-empty')).toBeTruthy();
  });

  it('paints a community row differently from a private one', () => {
    const view = renderInbox();
    expect(view.getByTestId('inbox-dm-dm1')).toBeTruthy();
    expect(view.getByTestId('inbox-community-c1')).toBeTruthy();
    expect(view.getByText('4 CHANNELS')).toBeTruthy();
    expect(view.getByText('#general · Tasha: I can do a cab-share from Soho')).toBeTruthy();
  });

  it('opens the right kind of chat from each section', () => {
    const onOpenDm = jest.fn();
    const onOpenCommunity = jest.fn();
    const view = renderInbox({ onOpenDm, onOpenCommunity });
    fireEvent.press(view.getByTestId('inbox-dm-dm1'));
    fireEvent.press(view.getByTestId('inbox-community-c1'));
    expect(onOpenDm).toHaveBeenCalledWith(expect.objectContaining({ id: 'dm1' }));
    expect(onOpenCommunity).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });
});
