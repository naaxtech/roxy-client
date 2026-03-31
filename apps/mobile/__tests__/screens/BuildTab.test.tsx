import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking, Share } from 'react-native';

// Mock supabase
jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        order: jest.fn(() => ({
          order: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue({ data: [], error: null }),
          })),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
      update: jest.fn(() => ({
        eq: jest.fn(() => ({
          catch: jest.fn(),
        })),
      })),
    })),
  },
}));

// Mock auth store
jest.mock('../../store/authStore', () => ({
  useAuthStore: jest.fn(() => ({ user: { id: 'user-1' } })),
}));

// Mock build store
const mockIncrementSupporter = jest.fn();

jest.mock('../../store/buildStore', () => ({
  useBuildStore: jest.fn(() => ({
    businesses: [],
    impactProjects: [
      {
        id: 'proj-1',
        creator_id: 'user-1',
        title: 'Trans Youth Mutual Aid',
        description: 'Supporting trans youth in need across the UK.',
        category: 'mutual_aid',
        goal_amount: 5000,
        raised_amount: 1200,
        supporter_count: 42,
        status: 'active',
        created_at: '2024-01-01T00:00:00Z',
        website_url: 'https://example.org',
      },
    ],
    loading: false,
    setBusinesses: jest.fn(),
    setImpactProjects: jest.fn(),
    setLoading: jest.fn(),
    incrementSupporter: mockIncrementSupporter,
  })),
}));

// Mock safe-area-context
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

// Mock FlashList — renders items directly (no out-of-scope vars in factory)
jest.mock('@shopify/flash-list', () => {
  const { View } = require('react-native');
  const { createElement } = require('react');
  return {
    FlashList: ({ data, renderItem, ListEmptyComponent }: any) => {
      if (!data || data.length === 0) {
        return ListEmptyComponent ? createElement(View, null, ListEmptyComponent) : null;
      }
      return createElement(
        View,
        null,
        ...data.map((item: any, index: number) => {
          const el = renderItem({ item, index });
          return createElement(View, { key: item.id ?? index }, el);
        })
      );
    },
  };
});

import BuildScreen from '../../app/(tabs)/build/index';

// Spy on Linking and Share
let linkingSpy: jest.SpyInstance;
let shareSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  linkingSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
});

afterEach(() => {
  linkingSpy.mockRestore();
  shareSpy.mockRestore();
});

describe('BuildScreen — ImpactDetailModal', () => {
  it('modal is not visible on mount', () => {
    const { queryByTestId } = render(<BuildScreen />);
    expect(queryByTestId('impact-detail-modal')).toBeNull();
  });

  it('pressing Support button on ImpactCard opens the detail modal', async () => {
    const { getByText, queryByTestId } = render(<BuildScreen />);

    // Switch to impact segment
    fireEvent.press(getByText('Impact'));

    // Press the Support button on the card — now opens modal
    fireEvent.press(getByText('Support'));

    await waitFor(() => {
      expect(queryByTestId('impact-detail-modal')).toBeTruthy();
    });
  });

  it('pressing the close button dismisses the modal', async () => {
    const { getByText, getByTestId, queryByTestId } = render(<BuildScreen />);

    // Open modal
    fireEvent.press(getByText('Impact'));
    fireEvent.press(getByText('Support'));

    await waitFor(() => {
      expect(queryByTestId('impact-detail-modal')).toBeTruthy();
    });

    // Press close button
    fireEvent.press(getByTestId('modal-close-btn'));

    await waitFor(() => {
      expect(queryByTestId('impact-detail-modal')).toBeNull();
    });
  });

  it('pressing "Visit website" calls Linking.openURL with the project website_url', async () => {
    const { getByText, queryByTestId } = render(<BuildScreen />);

    fireEvent.press(getByText('Impact'));
    fireEvent.press(getByText('Support'));

    await waitFor(() => {
      expect(queryByTestId('impact-detail-modal')).toBeTruthy();
    });

    fireEvent.press(getByText('Visit website →'));

    expect(linkingSpy).toHaveBeenCalledWith('https://example.org');
  });

  it('pressing the share button calls Share.share', async () => {
    const { getByText, getByTestId, queryByTestId } = render(<BuildScreen />);

    fireEvent.press(getByText('Impact'));
    fireEvent.press(getByText('Support'));

    await waitFor(() => {
      expect(queryByTestId('impact-detail-modal')).toBeTruthy();
    });

    fireEvent.press(getByTestId('modal-share-btn'));

    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Trans Youth Mutual Aid') })
    );
  });

  it('pressing the CTA in the modal calls handleSupport and shows Supported state', async () => {
    const { getByText, getByTestId, queryByTestId } = render(<BuildScreen />);

    fireEvent.press(getByText('Impact'));
    fireEvent.press(getByText('Support'));

    await waitFor(() => {
      expect(queryByTestId('impact-detail-modal')).toBeTruthy();
    });

    // Press the CTA inside the modal
    fireEvent.press(getByTestId('modal-support-cta'));

    expect(mockIncrementSupporter).toHaveBeenCalledWith('proj-1');

    // Modal stays open, CTA button itself now shows ✓ Supported
    await waitFor(() => {
      expect(queryByTestId('impact-detail-modal')).toBeTruthy();
      // The modal's CTA button text should have changed
      const ctaBtn = getByTestId('modal-support-cta');
      expect(ctaBtn).toHaveTextContent('✓ Supported');
    });
  });
});
