/**
 * Question of the day → composer. One tap on the For You card opens the
 * composer on her answer: the question is fixed on the card (not text she can
 * delete), the box holds only her words, and her answer is the card's
 * headline. Publishing takes her back to the feed she came from, with an
 * "Answer posted" snackbar. The question travels as a list index, never as text.
 * Before (2026-10-23, Nicole: "weird and awkward") the box was pre-filled with
 * "QUESTION OF THE DAY" and the question, her answer was the small grey line,
 * Back opened the post-type picker and Publish dropped her on her profile.
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
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockCanGoBack = { value: true };
const mockParams: { value: Record<string, string | undefined> } = { value: {} };
jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mockReplace, back: mockBack, push: mockPush, canGoBack: () => mockCanGoBack.value,
  }),
  useLocalSearchParams: () => mockParams.value,
}));

const mockSnack: { shown: { message: string; actionLabel?: string; onAction?: () => void }[] } = { shown: [] };
jest.mock('../../components/feedback/SnackbarHost', () => ({
  snackbar: {
    show: (o: { message: string; actionLabel?: string; onAction?: () => void }) => {
      mockSnack.shown.push(o);
      return 1;
    },
    dismiss: jest.fn(),
  },
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
  mockBack.mockReset();
  mockPush.mockReset();
  mockCanGoBack.value = true;
  mockSnack.shown.length = 0;
  mockAlert.mockReset();
  mockInsert.payloads.length = 0;
  mockMarked.length = 0;
  mockParams.value = {};
});

describe('composer opened from the question of the day', () => {
  it('opens on her answer: the question is fixed on the card, the box is hers', () => {
    mockParams.value = { prompt: '3' };
    const v = render(<CreatePostScreen />);

    expect(v.queryByTestId('create-type-standard')).toBeNull(); // not the type picker
    expect(v.getByText('Your answer')).toBeTruthy(); // the header says what she is doing
    expect(v.getByTestId('text-card-preview-kick')).toBeTruthy();
    expect(v.getByTestId('text-card-preview-question').props.children).toBe(DAILY_PROMPTS[3]);
    expect(v.getByTestId('text-card-preview-answer-placeholder')).toBeTruthy();

    const box = v.getByTestId('create-caption');
    expect(box.props.value).toBe(''); // no question or caps label to type around or delete
    expect(box.props.placeholder).toBe('Type your answer');
    expect(box.props.autoFocus).toBe(true);
  });

  it('her words become the headline of the card as she types', () => {
    mockParams.value = { prompt: '3' };
    const v = render(<CreatePostScreen />);
    fireEvent.changeText(v.getByTestId('create-caption'), 'Mine is a long walk');

    expect(v.getByTestId('text-card-preview-prompt').props.children).toBe('Mine is a long walk');
    expect(v.getByTestId('text-card-preview-question').props.children).toBe(DAILY_PROMPTS[3]);
    expect(v.queryByTestId('text-card-preview-answer-placeholder')).toBeNull();
  });

  it('Publish waits for her answer; nothing posts while it is empty', async () => {
    mockParams.value = { prompt: '3' };
    const v = render(<CreatePostScreen />);
    expect(v.getByTestId('create-publish').props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.changeText(v.getByTestId('create-caption'), '   ');
    fireEvent.press(v.getByTestId('create-publish'));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockInsert.payloads).toHaveLength(0);
    expect(mockMarked).toEqual([]);

    fireEvent.changeText(v.getByTestId('create-caption'), 'Carol');
    expect(v.getByTestId('create-publish').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('publishes question + answer as one card, marks today answered, returns her to the feed', async () => {
    mockParams.value = { prompt: '3' };
    const v = render(<CreatePostScreen />);
    fireEvent.changeText(v.getByTestId('create-caption'), '  Mine is a long walk ');
    fireEvent.press(v.getByTestId('create-publish'));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockReplace).not.toHaveBeenCalled(); // not dropped on her profile
    expect(mockInsert.payloads[0]).toMatchObject({
      post_type: 'standard',
      content: `${DAILY_PROMPT_KICK}\n${DAILY_PROMPTS[3]}\nMine is a long walk`,
    });
    expect(mockMarked).toEqual([`prompt-tester@${dailyPromptFor().dateKey}`]);

    expect(mockSnack.shown).toHaveLength(1);
    expect(mockSnack.shown[0]).toMatchObject({ message: 'Answer posted', actionLabel: 'View' });
    mockSnack.shown[0].onAction?.();
    expect(mockPush).toHaveBeenCalledWith('/you?tab=thoughts');
  });

  it('opened from a link with nothing behind it, publishing lands on the feed', async () => {
    mockParams.value = { prompt: '3' };
    mockCanGoBack.value = false;
    const v = render(<CreatePostScreen />);
    fireEvent.changeText(v.getByTestId('create-caption'), 'Carol');
    fireEvent.press(v.getByTestId('create-publish'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/feed'));
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('Back leaves the composer instead of opening the post-type picker', () => {
    mockParams.value = { prompt: '3' };
    const v = render(<CreatePostScreen />);
    fireEvent.press(v.getByText('Back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(v.queryByTestId('create-type-standard')).toBeNull();
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
