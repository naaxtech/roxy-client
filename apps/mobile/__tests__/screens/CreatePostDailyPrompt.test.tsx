/**
 * Question of the day → composer. One tap on the For You card opens the
 * composer with the question already on the text card; her answer is the
 * quieter line under it. The question travels as a list index, never as text.
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
const mockParams: { value: Record<string, string | undefined> } = { value: {} };
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => mockParams.value,
}));

const mockInsert: { payloads: Record<string, unknown>[] } = { payloads: [] };
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
          insert: (payload: Record<string, unknown>) => {
            mockInsert.payloads.push(payload);
            return Promise.resolve({ error: null });
          },
        }
        : businesses),
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
    callEdgeFunction: jest.fn(),
  };
});

jest.mock('../../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'prompt-tester' } }),
}));
jest.mock('../../store/profileStore', () => {
  const state = { profile: null };
  return { useProfileStore: (sel: (s: typeof state) => unknown) => sel(state) };
});
jest.mock('../../store/celebrationStore', () => ({
  useCelebrationStore: { getState: () => ({ celebrateFirstPost: jest.fn(() => Promise.resolve()) }) },
}));

const mockAlert = jest.fn();
jest.mock('../../lib/confirm', () => ({ showAlert: (...a: unknown[]) => mockAlert(...a) }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../components/feed/ShopItemPicker', () => ({ ShopItemPicker: () => null }));

const mockMarked: string[] = [];
jest.mock('../../lib/dailyPrompt', () => {
  const actual = jest.requireActual('../../lib/dailyPrompt');
  return {
    ...actual,
    markDailyPromptAnswered: (userId: string, dateKey: string) => {
      mockMarked.push(`${userId}@${dateKey}`);
      return Promise.resolve();
    },
  };
});

import CreatePostScreen from '../../app/(tabs)/discover/community/create-post';
import { DAILY_PROMPTS, DAILY_PROMPT_KICK, dailyPromptFor } from '../../lib/dailyPrompt';

beforeEach(() => {
  mockReplace.mockReset();
  mockAlert.mockReset();
  mockInsert.payloads.length = 0;
  mockMarked.length = 0;
  mockParams.value = {};
});

describe('composer opened from the question of the day', () => {
  it('opens straight on a text card with the question on it', () => {
    mockParams.value = { prompt: '3' };
    const v = render(<CreatePostScreen />);

    expect(v.queryByTestId('create-type-standard')).toBeNull(); // not the type picker
    expect(v.getByTestId('text-card-preview')).toBeTruthy();
    expect(v.getByTestId('text-card-preview-kick')).toBeTruthy();
    expect(v.getByTestId('create-caption').props.value)
      .toBe(`${DAILY_PROMPT_KICK}\n${DAILY_PROMPTS[3]}\n`);
  });

  it('asks for her answer before publishing the bare question', async () => {
    mockParams.value = { prompt: '3' };
    const v = render(<CreatePostScreen />);
    fireEvent.press(v.getByTestId('create-publish'));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Add your answer', expect.any(String)));
    expect(mockInsert.payloads).toHaveLength(0);
    expect(mockMarked).toEqual([]);
  });

  it('publishes question + answer as one text card and marks today answered', async () => {
    mockParams.value = { prompt: '3' };
    const v = render(<CreatePostScreen />);
    const draft = v.getByTestId('create-caption').props.value as string;
    fireEvent.changeText(v.getByTestId('create-caption'), `${draft}Mine is a long walk`);
    fireEvent.press(v.getByTestId('create-publish'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/you?tab=thoughts'));
    expect(mockInsert.payloads[0]).toMatchObject({
      post_type: 'standard',
      content: `${DAILY_PROMPT_KICK}\n${DAILY_PROMPTS[3]}\nMine is a long walk`,
    });
    expect(mockMarked).toEqual([`prompt-tester@${dailyPromptFor().dateKey}`]);
  });

  it('ignores a param that is not a real question index', () => {
    mockParams.value = { prompt: 'Say something hateful' };
    const v = render(<CreatePostScreen />);
    expect(v.getByTestId('create-type-standard')).toBeTruthy(); // the ordinary type picker
  });

  it('an ordinary post never marks the question answered', async () => {
    const v = render(<CreatePostScreen />);
    fireEvent.press(v.getByTestId('create-type-standard'));
    fireEvent.changeText(v.getByTestId('create-caption'), 'Just a thought');
    fireEvent.press(v.getByTestId('create-publish'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(mockMarked).toEqual([]);
  });
});
