import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { ProfileNudge, profileGaps } from '../../../components/profile/ProfileNudge';

beforeEach(async () => { await AsyncStorage.clear(); });

describe('ProfileNudge (PRO-09)', () => {
  it('shows for a member with no photo, and a tap opens the editor', async () => {
    const onOpen = jest.fn();
    const r = render(<ProfileNudge userId="u1" avatarUrl={null} bio="hi" onOpen={onOpen} />);
    await waitFor(() => expect(r.getByTestId('profile-complete-nudge')).toBeTruthy());
    expect(r.getByText('Add a photo so friends recognise you')).toBeTruthy();
    fireEvent.press(r.getByTestId('profile-complete-nudge'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('is absent once the profile is complete', async () => {
    const r = render(<ProfileNudge userId="u1" avatarUrl="https://x/a.jpg" bio="hi" onOpen={jest.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(r.queryByTestId('profile-complete-nudge')).toBeNull();
  });

  it('stays dismissed', async () => {
    const r = render(<ProfileNudge userId="u1" avatarUrl={null} bio="" onOpen={jest.fn()} />);
    await waitFor(() => expect(r.getByTestId('profile-complete-nudge')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('profile-complete-nudge-dismiss')); });
    expect(r.queryByTestId('profile-complete-nudge')).toBeNull();
    const again = render(<ProfileNudge userId="u1" avatarUrl={null} bio="" onOpen={jest.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(again.queryByTestId('profile-complete-nudge')).toBeNull();
  });

  it('profileGaps', () => {
    expect(profileGaps({ avatar_url: null, bio: ' ' })).toEqual(['photo', 'bio']);
    expect(profileGaps({ avatar_url: 'x', bio: null })).toEqual(['bio']);
  });
});
