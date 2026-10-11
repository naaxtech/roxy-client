import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import BlockedScreen from '../../app/(tabs)/you/blocked';
import { useSafetyStore } from '../../store/safetyStore';

/**
 * The screen that gives a block an undo, and does not claim one it did not get.
 */

const mockUnblock = jest.fn();
const mockLoad = jest.fn();
const mockConfirm = jest.fn();
const mockAlert = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));

const mockLoadMuted = jest.fn();
jest.mock('../../lib/mutedProfiles', () => ({
  fetchMutedProfiles: (...a: unknown[]) => mockLoadMuted(...a),
}));

jest.mock('../../lib/confirm', () => ({
  confirmAction: (...a: unknown[]) => mockConfirm(...a),
  showAlert: (...a: unknown[]) => mockAlert(...a),
}));

const her = { id: 'u9', display_name: 'Sam', username: 'sam', avatar_url: null };

function seed(over: Partial<ReturnType<typeof useSafetyStore.getState>> = {}) {
  useSafetyStore.setState({
    blockedProfiles: [her],
    blockedUserIds: ['u9'],
    loadingBlocks: false,
    blockLoadError: false,
    loadBlockedProfiles: mockLoad,
    unblockUser: mockUnblock,
    ...over,
  } as never);
}

beforeEach(() => {
  mockUnblock.mockReset().mockResolvedValue(true);
  mockLoad.mockReset().mockResolvedValue(undefined);
  mockConfirm.mockReset().mockResolvedValue(true);
  mockAlert.mockReset();
  mockLoadMuted.mockReset().mockResolvedValue([]);
  seed();
});

describe('the blocked list', () => {
  it('lists who she has blocked', () => {
    const { getByTestId, getByText } = render(<BlockedScreen />);
    expect(getByTestId('blocked-row-u9')).toBeTruthy();
    expect(getByText('Sam')).toBeTruthy();
  });

  // Mute exists since 127 and is offered on profiles, posts and comments, so
  // this screen is "Blocked & muted" with both lists and both ways back (PRO-06).
  it('is titled Blocked & muted and lists who she muted, with Unmute', async () => {
    const mockUnmute = jest.fn().mockResolvedValue(true);
    seed({ mutedUserIds: ['u7'], unmuteUser: mockUnmute } as never);
    mockLoadMuted.mockResolvedValue([{ id: 'u7', display_name: 'Jo', username: 'jo', avatar_url: null }]);
    const r = render(<BlockedScreen />);
    expect(r.getByText('Blocked & muted')).toBeTruthy();
    await waitFor(() => expect(r.getByTestId('muted-row-u7')).toBeTruthy());
    await act(async () => { fireEvent.press(r.getByTestId('muted-unmute-u7')); });
    expect(mockUnmute).toHaveBeenCalledWith('u7');
  });

  it('says plainly when she has muted nobody', async () => {
    seed({ mutedUserIds: [] } as never);
    const r = render(<BlockedScreen />);
    await waitFor(() => expect(r.getByTestId('muted-empty')).toBeTruthy());
  });

  it('asks before undoing a block, and unblocks when she says yes', async () => {
    const { getByTestId } = render(<BlockedScreen />);
    fireEvent.press(getByTestId('blocked-unblock-u9'));

    await waitFor(() => expect(mockUnblock).toHaveBeenCalledWith('u9'));
    expect(mockConfirm).toHaveBeenCalled();
  });

  it('does not unblock when she backs out', async () => {
    mockConfirm.mockResolvedValue(false);
    const { getByTestId } = render(<BlockedScreen />);
    fireEvent.press(getByTestId('blocked-unblock-u9'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockUnblock).not.toHaveBeenCalled();
  });

  it('says she is still blocked when the write changed nothing', async () => {
    // The store returns false for a 200 that matched zero rows. The screen must
    // say so rather than let the row disappear and imply an undo happened.
    mockUnblock.mockResolvedValue(false);
    const { getByTestId } = render(<BlockedScreen />);
    fireEvent.press(getByTestId('blocked-unblock-u9'));

    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Still blocked', expect.any(String)));
  });

  it('offers a retry when the list could not load, instead of looking empty', () => {
    seed({ blockedProfiles: [], blockLoadError: true });
    const { getByTestId, queryByTestId } = render(<BlockedScreen />);
    expect(getByTestId('blocked-error')).toBeTruthy();
    expect(queryByTestId('blocked-empty')).toBeNull();
  });

  it('has a real empty state that says how blocking is done', () => {
    seed({ blockedProfiles: [], blockedUserIds: [] });
    const { getByTestId } = render(<BlockedScreen />);
    expect(getByTestId('blocked-empty')).toHaveTextContent(/long-press any post/i);
  });
});
