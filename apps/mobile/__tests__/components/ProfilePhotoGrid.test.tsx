import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true })),
  MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('../../lib/uploads', () => ({
  uploadImageAsset: jest.fn(),
  assetExtension: jest.fn(() => 'jpg'),
}));

jest.mock('../../lib/supabase', () => {
  // profile_photos reads as .select().eq().order() — order itself is awaited,
  // so it must be thenable rather than returning a further builder.
  const order = jest.fn(() => Promise.resolve({ data: [], error: null }));
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq }));
  return { supabase: { from: jest.fn(() => ({ select })) } };
});

import { ProfilePhotoGrid } from '../../components/profile/ProfilePhotoGrid';

describe('ProfilePhotoGrid', () => {
  // Same regression as ProfileFavorites: under profile/edit.tsx's
  // alignItems:'center' content container this grid hugged its content instead
  // of filling the row, so its fixed-width wrapping slots could not compute
  // how many fit per row.
  it('declares a full width so a centering parent cannot collapse the grid', async () => {
    const { getByTestId } = render(<ProfilePhotoGrid userId="u1" editable />);
    await waitFor(() => expect(getByTestId('profile-photo-grid')).toBeTruthy());
    expect(getByTestId('profile-photo-grid')).toHaveStyle({ width: '100%' });
  });
});
