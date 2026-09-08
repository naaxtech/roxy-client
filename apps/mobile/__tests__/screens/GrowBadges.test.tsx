import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// Inline mock factories only — see CLAUDE.md §12.2 (jest.mock hoisting).
// `order` is the terminal call of the badge query, so it is the one that
// resolves; the queue lets a test hand back different rows per fetch.
jest.mock('../../lib/supabase', () => {
  const queue: { data: unknown; error: unknown }[] = [];
  const order = jest.fn(() =>
    Promise.resolve(queue.length > 1 ? queue.shift() : (queue[0] ?? { data: [], error: null }))
  );
  return {
    __queue: queue,
    __order: order,
    supabase: {
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order,
      })),
      rpc: jest.fn(() => Promise.resolve({ data: 0, error: null })),
    },
  };
});

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

jest.mock('../../store/authStore', () => ({
  useAuthStore: jest.fn(() => ({ user: { id: 'member-badges-screen' } })),
}));

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ back: jest.fn(), push: jest.fn() })),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@shopify/flash-list', () => {
  const { View } = require('react-native');
  const { createElement } = require('react');
  return {
    FlashList: ({ data, renderItem }: { data: unknown[]; renderItem: (arg: { item: unknown; index: number }) => React.ReactNode }) =>
      createElement(
        View,
        null,
        ...(data ?? []).map((item, index) =>
          createElement(View, { key: index }, renderItem({ item, index }))
        )
      ),
  };
});

import BadgesScreen from '../../app/badges';

const { supabase, __queue: queue } = jest.requireMock('../../lib/supabase');
const { logError } = jest.requireMock('../../lib/errorLogger');

function badgeRow(name: string, earned: boolean) {
  return {
    user_id: 'member-badges-screen',
    badge_id: `badge-${name}`,
    current_value: earned ? 1 : 0,
    earned_at: earned ? '2026-08-07T00:00:00Z' : null,
    badges: {
      id: `badge-${name}`,
      name,
      description: `${name} description`,
      emoji: '🏅',
      category: 'milestone',
      points_value: 10,
      requirement_type: 'messages',
      requirement_threshold: 1,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  queue.length = 0;
  supabase.rpc.mockResolvedValue({ data: 0, error: null });
});

describe('BadgesScreen — server-side badge sync', () => {
  it('asks the server to award any badge the member has already earned', async () => {
    queue.push({ data: [], error: null });

    render(<BadgesScreen />);

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('sync_my_badges');
    });
  });

  it('shows a badge earned by the sync without waiting for the next visit', async () => {
    // First fetch: nothing yet. Sync awards one. Second fetch must pick it up.
    queue.push({ data: [], error: null });
    queue.push({ data: [badgeRow('Conversation Starter', true)], error: null });
    supabase.rpc.mockResolvedValue({ data: 1, error: null });

    const { getByText } = render(<BadgesScreen />);

    await waitFor(() => {
      expect(getByText('Conversation Starter')).toBeTruthy();
    });
  });

  it('still renders the badges she already has when the sync fails', async () => {
    queue.push({ data: [badgeRow('Community Builder', true)], error: null });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    const { getByText } = render(<BadgesScreen />);

    await waitFor(() => {
      expect(getByText('Community Builder')).toBeTruthy();
    });
    expect(logError).toHaveBeenCalledWith(expect.any(Error), 'badges.sync');
  });

  it('says so in the Roxy voice when the sync fails, without hiding anything', async () => {
    queue.push({ data: [badgeRow('Community Builder', true)], error: null });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    const { getByTestId, getByText } = render(<BadgesScreen />);

    await waitFor(() => {
      expect(getByTestId('badge-sync-note')).toBeTruthy();
    });
    const note = getByTestId('badge-sync-note').props.children as string;
    expect(note).toContain('Roxy');
    expect(note).not.toMatch(/\b(the AI|assistant|chatbot)\b/i);
    // The failure never costs her the badges she already had.
    expect(getByText('Community Builder')).toBeTruthy();
  });

  it('does not show the sync note when the sync succeeds', async () => {
    queue.push({ data: [badgeRow('Community Builder', true)], error: null });

    const { queryByTestId, getByText } = render(<BadgesScreen />);

    await waitFor(() => {
      expect(getByText('Community Builder')).toBeTruthy();
    });
    expect(queryByTestId('badge-sync-note')).toBeNull();
  });

  it('tells a member with no rows yet what actually earns a badge', async () => {
    queue.push({ data: [], error: null });

    const { getByTestId } = render(<BadgesScreen />);

    await waitFor(() => {
      expect(getByTestId('badges-empty')).toBeTruthy();
    });
  });

  it('surfaces the fetch error state when the badge query fails', async () => {
    queue.push({ data: null, error: { message: 'boom' } });

    const { getByText } = render(<BadgesScreen />);

    await waitFor(() => {
      expect(getByText('Failed to load badges')).toBeTruthy();
    });
  });
});
