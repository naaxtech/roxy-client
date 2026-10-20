import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const mockOrder = jest.fn();
const mockRange = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () => ({
              order: () => ({
                limit: () => mockOrder(),
                range: (...a: unknown[]) => mockRange(...a),
              }),
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
    mockRange.mockReset();
  });

  // PRO-08: the wall stopped at 60 rows with no way to see older posts.
  it('offers older posts when the first page is full, and appends them', async () => {
    const photo = (i: number) => ({ id: `p${i}`, content: null, post_type: 'photo', media_urls: [`https://x/${i}.jpg`], video_thumbnail_url: null });
    mockOrder.mockResolvedValue({ data: Array.from({ length: 60 }, (_, i) => photo(i)), error: null });
    mockRange.mockResolvedValue({ data: [photo(60), photo(61)], error: null });
    const r = render(<ProfilePostsGrid userId="u1" />);
    await waitFor(() => expect(r.getByTestId('profile-posts-more')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('profile-posts-more')); });
    expect(mockRange).toHaveBeenCalledWith(60, 119);
    expect(r.getByTestId('profile-post-p61')).toBeTruthy();
    expect(r.queryByTestId('profile-posts-more')).toBeNull();
  });

  it('shows an empty wall when she has not published yet', async () => {
    const { getByTestId, getByText } = render(<ProfilePostsGrid userId="u1" />);
    await waitFor(() => expect(getByTestId('profile-posts-grid')).toBeTruthy());
    expect(getByText(/No photos or videos yet/i)).toBeTruthy();
  });

  it('leaves a text post to the Thoughts tab rather than cropping it into a square', async () => {
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
    // A square is the wrong container for a sentence: it crops the one thing
    // the post is made of, and a wall of cropped paragraphs read as broken
    // image tiles. `isThought` is the single definition both tabs share, so a
    // post cannot appear in both or fall out of both.
    const { findByTestId, queryByTestId } = render(<ProfilePostsGrid userId="u1" />);
    await findByTestId('profile-posts-grid');
    expect(queryByTestId('profile-post-p1')).toBeNull();
  });
});
