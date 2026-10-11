/**
 * The composer hands a successful publish to the first-post celebration —
 * and only a successful one. The celebration itself decides "first" (see
 * lib/firstPost.ts); this suite proves the composer asks at the right moment,
 * with her id and the kind of post, and never on a failed write.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-image-picker', () => ({ MediaTypeOptions: { Images: 'Images', Videos: 'Videos' } }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), push: jest.fn() }),
}));

const mockInsert: { error: { message: string } | null; payloads: unknown[] } = { error: null, payloads: [] };
jest.mock('../../lib/supabase', () => {
  const businesses: Record<string, unknown> = {};
  businesses.select = () => businesses;
  businesses.eq = () => businesses;
  businesses.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  return {
    supabase: {
      from: (table: string) => (table === 'posts'
        ? {
          insert: (payload: unknown) => {
            mockInsert.payloads.push(payload);
            return Promise.resolve({ error: mockInsert.error });
          },
        }
        : businesses),
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
    callEdgeFunction: jest.fn(),
  };
});

jest.mock('../../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'composer-tester' } }),
}));
jest.mock('../../store/profileStore', () => {
  const state = { profile: null };
  return { useProfileStore: (sel: (s: typeof state) => unknown) => sel(state) };
});

const mockCelebrateFirstPost = jest.fn(() => Promise.resolve());
jest.mock('../../store/celebrationStore', () => ({
  useCelebrationStore: {
    getState: () => ({ celebrateFirstPost: mockCelebrateFirstPost }),
  },
}));

const mockAlert = jest.fn();
jest.mock('../../lib/confirm', () => ({ showAlert: (...a: unknown[]) => mockAlert(...a) }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../components/feed/ShopItemPicker', () => ({ ShopItemPicker: () => null }));

import CreatePostScreen from '../../app/(tabs)/discover/community/create-post';

beforeEach(() => {
  mockReplace.mockReset();
  mockCelebrateFirstPost.mockClear();
  mockAlert.mockReset();
  mockInsert.error = null;
  mockInsert.payloads.length = 0;
});

async function publishTextCard() {
  const v = render(<CreatePostScreen />);
  fireEvent.press(v.getByTestId('create-type-standard'));
  fireEvent.changeText(v.getByTestId('create-caption'), 'Hello, Roxy');
  fireEvent.press(v.getByTestId('create-publish'));
  await waitFor(() => expect(mockInsert.payloads).toHaveLength(1));
  return v;
}

describe('composer → first-post celebration', () => {
  it('asks whether to celebrate after a successful publish, with her id and the post type', async () => {
    await publishTextCard();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/you?tab=thoughts'));
    expect(mockCelebrateFirstPost).toHaveBeenCalledTimes(1);
    expect(mockCelebrateFirstPost).toHaveBeenCalledWith('composer-tester', 'standard');
  });

  it('never celebrates a failed publish', async () => {
    mockInsert.error = { message: 'nope' };
    await publishTextCard();

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Post failed', expect.any(String)));
    expect(mockCelebrateFirstPost).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
