import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QuestionOfTheDayCard } from '../../../components/grow/QuestionOfTheDayCard';

const mockQuestion = {
  id: 'q1',
  question: 'What made you smile today?',
  answer_count: 5,
};

jest.mock('../../../hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    primary: '#C4476A', secondary: '#8B5CF6', accent: '#F472B6',
    background: '#1a0a2e', surface: '#2d1b4e', surfaceLight: '#3d2b5e',
    textPrimary: '#FFFFFF', textSecondary: '#C4B5D4', textMuted: '#8B7AA8',
    success: '#10B981', warning: '#F59E0B', error: '#EF4444',
    roxy: '#E879A6', devPanel: '#FF1493',
  }),
}));

jest.mock('../../../components/grow/AnswerSheet', () => ({
  AnswerSheet: () => null,
}));

// Build a supabase mock that returns mockQuestion for questions_of_the_day
// and empty/null for everything else
const makeChain = (returnValue: any) => {
  const chain: any = {};
  const methods = ['select', 'in', 'eq', 'is', 'order', 'limit', 'maybeSingle'];
  methods.forEach((m) => {
    chain[m] = jest.fn(() => {
      if (m === 'maybeSingle') return Promise.resolve({ data: returnValue, error: null });
      return chain;
    });
  });
  return chain;
};

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'questions_of_the_day') {
        return makeChain(mockQuestion);
      }
      // answers queries — return null/empty
      return makeChain(null);
    }),
  },
}));

describe('QuestionOfTheDayCard', () => {
  it('renders question text when question is available', async () => {
    const { getByText } = render(
      <QuestionOfTheDayCard communityIds={['c1']} userId="u1" />
    );
    await waitFor(() => {
      expect(getByText(/"What made you smile today\?"/)).toBeTruthy();
    });
  });

  it('shows Add yours button when user has not answered', async () => {
    const { getByText } = render(
      <QuestionOfTheDayCard communityIds={['c1']} userId="u1" />
    );
    await waitFor(() => {
      expect(getByText('+ Add yours')).toBeTruthy();
    });
  });

  it('renders nothing when communityIds is empty and no staff question', async () => {
    // Override mock to return null for all queries
    const { supabase } = jest.requireMock('../../../lib/supabase');
    supabase.from.mockImplementation(() => makeChain(null));

    const { queryByText } = render(
      <QuestionOfTheDayCard communityIds={[]} userId="u1" />
    );
    await waitFor(() => {
      expect(queryByText('● QUESTION OF THE DAY')).toBeNull();
    });
  });
});
