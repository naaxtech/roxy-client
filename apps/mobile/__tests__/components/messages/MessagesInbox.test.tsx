import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render, fireEvent, within } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import { SectionList, Text } from 'react-native';
import { MessagesInbox } from '../../../components/messages/MessagesInbox';
import { THEMES } from '../../../lib/theme';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | string>;

const aDm = {
  id: 'dm1',
  participant_ids: ['u1', 'u2'],
  last_message_at: '2026-09-06T11:21:00Z',
  partner: { id: 'u2', display_name: 'Priya Shah', username: 'priya' },
  lastMessagePreview: 'save me a seat',
  unreadCount: 1,
};

const aReadDm = {
  ...aDm,
  id: 'dm2',
  partner: { id: 'u3', display_name: 'Sofía Marín', username: 'sofia' },
  lastMessagePreview: 'You: haha same',
  unreadCount: 0,
};

const aCommunity = {
  id: 'c1',
  name: 'WLW London',
  member_count: 1240,
  channelCount: 4,
  preview: '#general · Tasha: I can do a cab-share from Soho',
  unreadCount: 2,
  muted: false,
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

describe('MessagesInbox — people and Communities are two lists', () => {
  it('labels the Communities group in sentence case, no caps eyebrows', () => {
    const view = renderInbox();
    expect(view.getByTestId('inbox-section-direct')).toBeTruthy();
    expect(view.getByTestId('inbox-section-community')).toBeTruthy();
    expect(view.getByText('Communities')).toBeTruthy();
    expect(view.queryByText('DIRECT')).toBeNull();
    expect(view.queryByText('COMMUNITY CHATS')).toBeNull();
  });

  it('opens the people list with the screen’s Requests row', () => {
    const view = renderInbox({ directHeader: <Text testID="requests-row-stub">Requests</Text> });
    const section = within(view.getByTestId('inbox-section-direct'));
    expect(section.getByTestId('requests-row-stub')).toBeTruthy();
  });

  it('still shows Community chats when there are no private messages', () => {
    // The old inbox stuffed communities in the DM list footer. An empty DM
    // list then drew a full-screen empty and made group chat look missing.
    const view = renderInbox({ chats: [] });
    expect(view.getByTestId('inbox-section-community')).toBeTruthy();
    expect(view.getByTestId('inbox-community-c1')).toBeTruthy();
    expect(view.getByText('WLW London')).toBeTruthy();
    expect(view.getByTestId('inbox-direct-empty')).toBeTruthy();
    expect(
      view.getByText('No messages yet. When someone writes, it waits here as a request until you say yes.'),
    ).toBeTruthy();
  });

  it('draws skeleton rows while the first load runs, not a spinner', () => {
    const view = renderInbox({ chats: [], loading: true });
    expect(view.getByTestId('inbox-direct-loading').props.accessibilityRole).toBe('progressbar');
    expect(view.getByLabelText('Loading your messages')).toBeTruthy();
    expect(view.UNSAFE_queryAllByType(require('react-native').ActivityIndicator)).toHaveLength(0);
  });

  it('pull-to-refresh (Roxy refresh) spins only while her pull runs, never under the first-load skeleton', async () => {
    let done: (() => void) | undefined;
    const onRefresh = jest.fn(() => new Promise<void>((r) => { done = r; }));
    const view = renderInbox({ chats: [], loading: true, onRefresh });
    const control = () => view.UNSAFE_getByType(SectionList).props.refreshControl;
    expect(control().props.refreshing).toBe(false);
    await act(async () => { control().props.onRefresh(); });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(control().props.refreshing).toBe(true);
    await act(async () => { done?.(); });
    expect(control().props.refreshing).toBe(false);
  });

  it('gives a community a crest squircle with its initials and no caps channel pill', () => {
    const view = renderInbox();
    const row = view.getByTestId('inbox-community-c1');
    expect(within(row).getByText('WL')).toBeTruthy();
    expect(view.queryByText('4 CHANNELS')).toBeNull();
    expect(String(row.props.accessibilityLabel)).toMatch(/4 channels/);
    expect(view.getByText('#general · Tasha: I can do a cab-share from Soho')).toBeTruthy();
  });

  it('marks an unread row with a pink dot and the emphasized preview; read rows stay quiet', () => {
    const view = renderInbox({ chats: [aDm, aReadDm], unreadCounts: {} });
    const dot = view.getByTestId('inbox-unread-dm1');
    expect(flat(dot).backgroundColor).toBe(THEMES.light.pink);
    expect(view.queryByTestId('inbox-unread-dm2')).toBeNull();
    const unreadPreview = flat(view.getByText('save me a seat'));
    const readPreview = flat(view.getByText('You: haha same'));
    expect(unreadPreview.color).toBe(THEMES.light.ink);
    expect(readPreview.color).toBe(THEMES.light.ink2);
    expect(unreadPreview.fontFamily).not.toBe(readPreview.fontFamily);
    // The count is spoken, not painted.
    expect(String(view.getByTestId('inbox-dm-dm1').props.accessibilityLabel)).toMatch(/1 unread/);
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
