import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { OfficialChatInbox } from '../../../components/messages/OfficialChatInbox';
import { useProfileStore } from '../../../store/profileStore';
import { comingSoonCopy } from '../../../lib/features';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

const mockFetchOfficialCommunity = jest.fn();
jest.mock('../../../lib/officialCommunity', () => ({
  fetchOfficialCommunity: (...args: unknown[]) => mockFetchOfficialCommunity(...args),
  ensureOfficialMembership: jest.fn(),
  fetchOwnedCommunities: jest.fn(async () => []),
}));

beforeEach(() => {
  mockFetchOfficialCommunity.mockReset();
  useProfileStore.setState({
    profile: { vetting_status: 'pending' } as never,
  });
});

describe('OfficialChatInbox', () => {
  it('does not pretend Official chat is open for a pending applicant', () => {
    const { getByTestId, getByText, queryByTestId } = render(<OfficialChatInbox />);
    const copy = comingSoonCopy('officialChat', 'pending');
    expect(getByTestId('official-chat-locked')).toBeTruthy();
    expect(getByText(copy.title)).toBeTruthy();
    expect(getByText(copy.body)).toBeTruthy();
    expect(queryByTestId('official-chat-row')).toBeNull();
    expect(mockFetchOfficialCommunity).not.toHaveBeenCalled();
  });

  it('still labels Direct and Community when private messages are locked', async () => {
    useProfileStore.setState({
      profile: { vetting_status: 'approved' } as never,
    });
    mockFetchOfficialCommunity.mockResolvedValue({
      id: 'off', name: 'Roxy Official', slug: 'roxy-official', description: 'Hi',
    });
    const { getByTestId, getByText } = render(<OfficialChatInbox />);
    const copy = comingSoonCopy('dms', 'member');
    expect(getByTestId('inbox-section-direct')).toBeTruthy();
    expect(getByTestId('inbox-section-community')).toBeTruthy();
    expect(getByTestId('inbox-direct-locked')).toBeTruthy();
    expect(getByText('DIRECT')).toBeTruthy();
    expect(getByText('COMMUNITY CHATS')).toBeTruthy();
    expect(getByText(copy.title)).toBeTruthy();
    await waitFor(() => expect(getByTestId('official-chat-row')).toBeTruthy());
  });
});
