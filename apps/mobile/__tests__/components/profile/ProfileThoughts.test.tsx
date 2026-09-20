import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ProfileThoughts } from '../../../components/profile/ProfileThoughts';

/**
 * The events have to fire on the REAL paths.
 *
 * `thoughtsAnalytics.test.ts` proves the event shapes. It says nothing about
 * whether anything calls them — and an analytics module nobody invokes is the
 * exact shape of "a write nothing reads" that this codebase keeps finding. So
 * this drives the component and watches.
 */

const mockRepliesOpened = jest.fn();
const mockReplySent = jest.fn();
const mockReacted = jest.fn();

jest.mock('../../../lib/analytics', () => ({
  Analytics: {
    thoughtRepliesOpened: (...a: unknown[]) => mockRepliesOpened(...a),
    thoughtReplySent: (...a: unknown[]) => mockReplySent(...a),
    postReacted: (...a: unknown[]) => mockReacted(...a),
  },
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-linking', () => ({ createURL: (p: string) => `roxy:/${p}` }));
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn(), hashUserId: (s: string) => s }));
jest.mock('../../../store/authStore', () => ({ useAuthStore: () => 'me' }));
jest.mock('../../../store/feedStore', () => ({
  useFeedStore: (sel: (s: unknown) => unknown) => sel({
    likedPostIds: new Set<string>(),
    toggleLike: jest.fn(),
  }),
}));

const mockReact = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../lib/postReactions', () => ({
  ...jest.requireActual('../../../lib/postReactions'),
  reactToPost: (...a: unknown[]) => mockReact(...a),
}));

// The panel is exercised by its own spec; here it must simply not fetch.
jest.mock('../../../components/profile/InlineReplies', () => ({
  InlineReplies: () => null,
  countAll: () => 0,
}));

const row = {
  id: 'p1',
  content: 'we made it.',
  post_type: 'standard',
  created_at: '2026-09-07T10:00:00Z',
  reaction_counts: null,
  comment_count: 0,
  like_count: 0,
  profiles: { id: 'her', display_name: 'Maya', username: 'maya', avatar_url: null },
};

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {};
      ['select', 'eq', 'is', 'order'].forEach((m) => { chain[m] = () => chain; });
      chain.limit = () => Promise.resolve({
        data: [{
          id: 'p1', content: 'we made it.', post_type: 'standard',
          created_at: '2026-09-07T10:00:00Z', reaction_counts: null,
          comment_count: 0, like_count: 0,
          profiles: { id: 'her', display_name: 'Maya', username: 'maya', avatar_url: null },
        }],
        error: null,
      });
      return chain;
    },
  },
}));

beforeEach(() => {
  mockRepliesOpened.mockClear();
  mockReplySent.mockClear();
  mockReacted.mockClear();
  mockReact.mockClear();
});

void row;

describe('ProfileThoughts instrumentation', () => {
  it('counts a thread being OPENED, and not its close', async () => {
    // Counting the close too would double every session and make the
    // open-to-sent rate — the one number this funnel exists for — meaningless.
    const v = render(<ProfileThoughts userId="u1" testID="t" />);
    await waitFor(() => expect(v.getByText('we made it.')).toBeTruthy());

    fireEvent.press(v.getByTestId('t-p1-reply'));
    expect(mockRepliesOpened).toHaveBeenCalledTimes(1);
    expect(mockRepliesOpened).toHaveBeenCalledWith('profile');

    fireEvent.press(v.getByTestId('t-p1-reply'));
    expect(mockRepliesOpened).toHaveBeenCalledTimes(1);
  });

  it('counts a reaction, with the emoji she picked', async () => {
    const v = render(<ProfileThoughts userId="u1" testID="t" />);
    await waitFor(() => expect(v.getByText('we made it.')).toBeTruthy());

    fireEvent.press(v.getByTestId('t-p1-reactions-add'));
    await act(async () => {
      fireEvent.press(v.getByTestId('t-p1-reactions-pick-😂'));
    });
    expect(mockReacted).toHaveBeenCalledWith('😂', 'profile');
    expect(mockReact).toHaveBeenCalledWith('p1', '😂');
  });
});
