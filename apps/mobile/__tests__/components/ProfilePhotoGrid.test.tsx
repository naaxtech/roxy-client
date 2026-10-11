import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true })),
  MediaTypeOptions: { Images: 'Images' },
}));
jest.mock('../../lib/uploads', () => ({
  uploadImageAsset: jest.fn(),
  assetExtension: jest.fn(() => 'jpg'),
}));

const mockRows: { id: string; photo_url: string; sort_order: number }[] = [];
const mockDelete = jest.fn();
const mockConfirm = jest.fn();
const mockAlert = jest.fn();
jest.mock('../../lib/confirm', () => ({
  confirmAction: (...a: unknown[]) => mockConfirm(...a),
  showAlert: (...a: unknown[]) => mockAlert(...a),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/supabase', () => {
  // profile_photos reads as .select().eq().order() — order itself is awaited,
  // so it must be thenable rather than returning a further builder.
  const order = jest.fn(() => Promise.resolve({ data: mockRows, error: null }));
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq }));
  const del = () => ({ eq: (...a: unknown[]) => mockDelete(...a) });
  return {
    supabase: {
      from: jest.fn(() => ({ select, delete: del })),
      storage: { from: () => ({ remove: () => Promise.resolve({ error: null }) }) },
    },
  };
});

import { ProfilePhotoGrid } from '../../components/profile/ProfilePhotoGrid';

beforeEach(() => {
  mockRows.length = 0;
  mockDelete.mockReset().mockResolvedValue({ error: null, count: 1 });
  mockConfirm.mockReset().mockResolvedValue(true);
  mockAlert.mockReset();
});

describe('removing a photo (PRO-11)', () => {
  it('asks first, and does nothing when she cancels', async () => {
    mockRows.push({ id: 'p1', photo_url: 'https://x/p1.jpg', sort_order: 0 });
    mockConfirm.mockResolvedValue(false);
    const r = render(<ProfilePhotoGrid userId="u1" editable />);
    await waitFor(() => expect(r.getByTestId('profile-photo-remove-p1')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('profile-photo-remove-p1')); });
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('says so when the delete fails, instead of pretending', async () => {
    mockRows.push({ id: 'p1', photo_url: 'https://x/p1.jpg', sort_order: 0 });
    mockDelete.mockResolvedValue({ error: { message: 'nope' } });
    const r = render(<ProfilePhotoGrid userId="u1" editable />);
    await waitFor(() => expect(r.getByTestId('profile-photo-remove-p1')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('profile-photo-remove-p1')); });
    expect(mockDelete).toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/not removed/i));
  });
});

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
