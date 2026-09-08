import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

// user_favorites reads as .select().eq().order().limit(); the follow-up
// events/games reads as .select().in(). One mock has to satisfy both shapes.
jest.mock('../../lib/supabase', () => {
  const favRows = [
    { id: 'f1', entity_type: 'event', entity_id: 'e1' },
    { id: 'f2', entity_type: 'game', entity_id: 'g1' },
  ];
  const inFn = jest.fn((_col: string, ids: string[]) =>
    Promise.resolve({
      data: ids.includes('e1')
        ? [{ id: 'e1', title: 'Pride Picnic' }]
        : [{ id: 'g1', name: 'Two Truths' }],
      error: null,
    })
  );
  const limit = jest.fn(() => Promise.resolve({ data: favRows, error: null }));
  const order = jest.fn(() => ({ limit }));
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq, in: inFn }));
  return { supabase: { from: jest.fn(() => ({ select })) } };
});

import { ProfileFavorites } from '../../components/profile/ProfileFavorites';

describe('ProfileFavorites', () => {
  // Regression: profile/edit.tsx lays its ScrollView content out with
  // alignItems:'center', which replaces the default 'stretch' and makes every
  // direct child hug its own content width. This component's content is a
  // HORIZONTAL ScrollView, which has no intrinsic width at all, so without an
  // explicit width the row collapsed and stretched on the edit screen while
  // rendering correctly on profile/index.tsx. Declaring the width here is what
  // makes the component safe to drop into any parent.
  it('declares a full width so a centering parent cannot collapse it', async () => {
    const { getByTestId } = render(<ProfileFavorites userId="u1" editable />);
    await waitFor(() => expect(getByTestId('profile-favorites')).toBeTruthy());
    expect(getByTestId('profile-favorites')).toHaveStyle({ width: '100%' });
  });

  it('renders favourite titles once hydrated', async () => {
    const { getByText } = render(<ProfileFavorites userId="u1" editable />);
    await waitFor(() => expect(getByText('Pride Picnic')).toBeTruthy());
  });
});
