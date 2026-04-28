import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { HappeningTonightCard } from '../../../components/grow/HappeningTonightCard';

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        in: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({ limit: jest.fn().mockResolvedValue({ data: [], error: null }) })),
            limit: jest.fn().mockResolvedValue({ data: [], error: null }),
          })),
          gte: jest.fn(() => ({
            lte: jest.fn(() => ({
              eq: jest.fn(() => ({
                order: jest.fn(() => ({ limit: jest.fn().mockResolvedValue({ data: [], error: null }) })),
              })),
            })),
          })),
        })),
      })),
    })),
  },
}));

jest.mock('../../../hooks/useThemeColors', () => ({
  useThemeColors: () => ({
    primary: '#C4476A', secondary: '#8B5CF6', accent: '#F472B6',
    background: '#1a0a2e', surface: '#2d1b4e', surfaceLight: '#3d2b5e',
    textPrimary: '#FFFFFF', textSecondary: '#C4B5D4', textMuted: '#8B7AA8',
    success: '#10B981', warning: '#F59E0B', error: '#EF4444',
    roxy: '#E879A6', devPanel: '#FF1493',
  }),
}));

describe('HappeningTonightCard', () => {
  it('renders nothing when items array is empty', async () => {
    const { queryByText } = render(<HappeningTonightCard communityIds={['c1']} />);
    await waitFor(() => {
      expect(queryByText('HAPPENING TONIGHT')).toBeNull();
    });
  });

  it('renders nothing when communityIds is empty', async () => {
    const { queryByText } = render(<HappeningTonightCard communityIds={[]} />);
    await waitFor(() => {
      expect(queryByText('HAPPENING TONIGHT')).toBeNull();
    });
  });
});
