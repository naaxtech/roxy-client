/**
 * CHAT-09 in the browser: a private community's Join files a request, and
 * the button must say "Requested" — never "Joined ✓" over a closed door.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../../lib/confirm', () => ({ showAlert: jest.fn() }));
jest.mock('@shopify/flash-list', () => {
  const { View } = require('react-native');
  const { createElement } = require('react');
  return {
    FlashList: ({ data, renderItem }: { data: unknown[]; renderItem: (a: { item: unknown; index: number }) => React.ReactNode }) =>
      createElement(View, null, ...data.map((item, index) => createElement(View, { key: index }, renderItem({ item, index })))),
  };
});
jest.mock('../../../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'me' } }),
}));

const mockState: any = {};
jest.mock('../../../store/communityStore', () => ({
  useCommunityStore: (sel?: (s: unknown) => unknown) => (sel ? sel(mockState) : mockState),
}));

import { CommunitiesBrowser } from '../../../components/community/CommunitiesBrowser';
const { showAlert } = jest.requireMock('../../../lib/confirm');

const c = (id: string, name: string, is_private: boolean) => ({
  id, name, slug: id, description: null, cover_image_url: null, category: 'interest', is_private,
  member_count: 3, created_by: 'u0', created_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockState, {
    allCommunities: [c('pub', 'Hikers', false), c('priv', 'Quiet Room', true)],
    joinedIds: new Set<string>(),
    requestedIds: new Set<string>(['priv']),
    joinCommunity: jest.fn().mockResolvedValue('requested'),
    leaveCommunity: jest.fn().mockResolvedValue(undefined),
  });
});

it('a private community she has asked to join reads "Requested", not "Joined"', () => {
  const view = render(<CommunitiesBrowser />);
  expect(view.getByLabelText('Request sent to join Quiet Room')).toBeTruthy();
  expect(view.getByText('Requested')).toBeTruthy();
  expect(view.getByText('Join')).toBeTruthy(); // the public one
});

it('a private community offers "Ask to join" and says what happens next', async () => {
  mockState.requestedIds = new Set();
  const view = render(<CommunitiesBrowser />);
  fireEvent.press(view.getByLabelText('Ask to join Quiet Room'));
  await waitFor(() => expect(mockState.joinCommunity).toHaveBeenCalledWith('priv', 'me'));
  expect(showAlert).toHaveBeenCalledWith('Request sent', expect.stringMatching(/moderator/i));
});

it('tapping "Requested" again does not file a second request', () => {
  const view = render(<CommunitiesBrowser />);
  fireEvent.press(view.getByLabelText('Request sent to join Quiet Room'));
  expect(mockState.joinCommunity).not.toHaveBeenCalled();
});
