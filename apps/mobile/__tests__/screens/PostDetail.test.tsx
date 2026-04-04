// apps/mobile/__tests__/screens/PostDetail.test.tsx
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// Mock expo-router
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ postId: 'post-123' }),
  useRouter: () => ({ back: jest.fn() }),
}));

// Mock supabase with chained builder
jest.mock('../../lib/supabase', () => {
  const mockPost = {
    id: 'post-123',
    content: 'Hello community!',
    created_at: '2026-04-02T10:00:00Z',
    comment_count: 2,
    profiles: { display_name: 'Alice', avatar_url: null },
  };
  const mockComments = [
    {
      id: 'c-1', post_id: 'post-123', author_id: 'u-1',
      content: 'Great post!', created_at: '2026-04-02T10:05:00Z',
      profiles: { display_name: 'Bob', avatar_url: null },
    },
    {
      id: 'c-2', post_id: 'post-123', author_id: 'u-2',
      content: 'Totally agree 💜', created_at: '2026-04-02T10:10:00Z',
      profiles: { display_name: 'Carol', avatar_url: null },
    },
  ];

  const makePostChain = () => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: mockPost, error: null }),
  });

  const makeCommentsChain = () => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: mockComments, error: null }),
  });

  return {
    supabase: {
      from: jest.fn((table: string) => {
        if (table === 'posts') return makePostChain();
        if (table === 'comments') return makeCommentsChain();
        return makePostChain();
      }),
    },
  };
});

// Mock authStore
jest.mock('../../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'u-self', display_name: 'Me' } }),
}));

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }: any) => <View {...props}>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

import PostDetailScreen from '../../app/(tabs)/discover/community/post/[postId]';

describe('PostDetailScreen', () => {
  it('renders post content after loading', async () => {
    const { getByText } = render(<PostDetailScreen />);
    await waitFor(() => {
      expect(getByText('Hello community!')).toBeTruthy();
    });
  });

  it('renders existing comments', async () => {
    const { getByText } = render(<PostDetailScreen />);
    await waitFor(() => {
      expect(getByText(/Great post!/)).toBeTruthy();
      expect(getByText(/Totally agree 💜/)).toBeTruthy();
    });
  });

  it('renders comment count label', async () => {
    const { getByText } = render(<PostDetailScreen />);
    await waitFor(() => {
      expect(getByText('2 comments')).toBeTruthy();
    });
  });

  it('renders composer input', async () => {
    const { getByPlaceholderText } = render(<PostDetailScreen />);
    await waitFor(() => {
      expect(getByPlaceholderText('Add a comment…')).toBeTruthy();
    });
  });
});
