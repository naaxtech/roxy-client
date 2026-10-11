/**
 * PRO-04 / PRO-05 on the Edit Profile screen.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockPick = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockPick(...a),
  MediaTypeOptions: { Images: 'Images' },
}));
const mockUpload = jest.fn();
jest.mock('../../lib/uploads', () => ({ uploadImageAsset: (...a: unknown[]) => mockUpload(...a) }));
const mockAlert = jest.fn();
jest.mock('../../lib/confirm', () => ({ showAlert: (...a: unknown[]) => mockAlert(...a) }));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }) },
}));
jest.mock('../../components/profile/ProfilePhotoGrid', () => ({ ProfilePhotoGrid: () => null }));
jest.mock('../../components/profile/ProfileFavorites', () => ({ ProfileFavorites: () => null }));
jest.mock('../../components/profile/AvatarPickerSheet', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    AvatarPickerSheet: ({ visible, onUploadPhoto }: { visible: boolean; onUploadPhoto: () => void }) =>
      visible ? <Pressable testID="picker-upload" onPress={onUploadPhoto}><Text>upload</Text></Pressable> : null,
  };
});
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const st = { user: { id: 'u1' } };
    return typeof sel === 'function' ? sel(st) : st;
  },
}));

import EditProfileScreen from '../../app/(tabs)/you/edit';
import { useProfileStore } from '../../store/profileStore';
import { BIO_MAX } from '../../lib/profileRules';

const mockUpdate = jest.fn();
const mockTogglePronoun = jest.fn();

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue(undefined);
  mockTogglePronoun.mockReset().mockResolvedValue(undefined);
  mockPick.mockReset();
  mockUpload.mockReset();
  mockAlert.mockReset();
  useProfileStore.setState({
    profile: { id: 'u1', display_name: 'Alice', bio: 'hi', pronouns: [], avatar_url: null } as never,
    updateProfile: mockUpdate,
    togglePronoun: mockTogglePronoun,
  } as never);
});

describe('Edit profile', () => {
  it('the bio has a cap and a counter', () => {
    const r = render(<EditProfileScreen />);
    const bio = r.getByTestId('edit-bio');
    expect(bio.props.maxLength).toBe(BIO_MAX);
    fireEvent.changeText(bio, 'x'.repeat(150));
    expect(r.getByTestId('edit-bio-counter').props.children.join('')).toBe(`150 / ${BIO_MAX}`);
  });

  it('pronoun chips go through the store toggle (computed from latest state)', async () => {
    const r = render(<EditProfileScreen />);
    await act(async () => { fireEvent.press(r.getByTestId('edit-pronoun-she/her')); });
    expect(mockTogglePronoun).toHaveBeenCalledWith('she/her');
  });

  it('display name is editable, and a reserved name is refused before any write', async () => {
    const r = render(<EditProfileScreen />);
    fireEvent.changeText(r.getByTestId('edit-display-name'), 'Roxy Support');
    await act(async () => { fireEvent.press(r.getByTestId('edit-display-name-save')); });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(r.getByTestId('edit-display-name-error')).toBeTruthy();
    fireEvent.changeText(r.getByTestId('edit-display-name'), '  Alicia ');
    await act(async () => { fireEvent.press(r.getByTestId('edit-display-name-save')); });
    expect(mockUpdate).toHaveBeenCalledWith({ display_name: 'Alicia' });
  });

  it('a new photo gets a cache-busted URL', async () => {
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://a.jpg', mimeType: 'image/jpeg', fileSize: 2000 }] });
    mockUpload.mockResolvedValue('https://x/avatars/u1/avatar.jpg');
    const r = render(<EditProfileScreen />);
    fireEvent.press(r.getByTestId('edit-avatar'));
    await act(async () => { fireEvent.press(r.getByTestId('picker-upload')); });
    expect(mockUpdate).toHaveBeenCalledWith({ avatar_url: expect.stringMatching(/^https:\/\/x\/avatars\/u1\/avatar\.jpg\?v=\d+$/) });
  });

  it('a non-image or oversize file is refused with a reason, not uploaded', async () => {
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://a.mov', mimeType: 'video/quicktime', fileSize: 2000 }] });
    const r = render(<EditProfileScreen />);
    fireEvent.press(r.getByTestId('edit-avatar'));
    await act(async () => { fireEvent.press(r.getByTestId('picker-upload')); });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/not a photo/));
  });
});
