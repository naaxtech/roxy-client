import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const mockOrder = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () => ({
              limit: () => mockOrder(),
            }),
          }),
        }),
      }),
    }),
  },
}));

import { ProfilePostsGrid } from '../../../components/profile/ProfilePostsGrid';

describe('ProfilePostsGrid', () => {
  beforeEach(() => {
    mockOrder.mockReset();
    mockOrder.mockResolvedValue({ data: [], error: null });
  });

  it('shows an empty wall when she has not published yet', async () => {
    const { getByTestId, getByText } = render(<ProfilePostsGrid userId="u1" />);
    await waitFor(() => expect(getByTestId('profile-posts-grid')).toBeTruthy());
    expect(getByText(/No posts yet/i)).toBeTruthy();
  });

  it('renders a text card tile from a standard post', async () => {
    mockOrder.mockResolvedValue({
      data: [{
        id: 'p1',
        content: 'we made it.',
        post_type: 'standard',
        media_urls: [],
        video_thumbnail_url: null,
      }],
      error: null,
    });
    const { findByTestId } = render(<ProfilePostsGrid userId="u1" />);
    expect(await findByTestId('profile-post-p1')).toBeTruthy();
  });
});
