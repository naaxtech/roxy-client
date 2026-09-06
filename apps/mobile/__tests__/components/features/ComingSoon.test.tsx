import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  usePathname: () => '/discover',
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

import { ComingSoon } from '../../../components/features/ComingSoon';
import { FeatureGate } from '../../../components/features/FeatureGate';
import { useProfileStore } from '../../../store/profileStore';
import { comingSoonCopy } from '../../../lib/features';

beforeEach(() => {
  mockReplace.mockClear();
  useProfileStore.setState({ profile: { access_tier: 'public' } as never });
});

describe('ComingSoon', () => {
  it('names the gated feature and offers Archive as the way back', () => {
    const { getByTestId, getByText } = render(<ComingSoon feature="discover" />);
    expect(getByTestId('coming-soon')).toBeTruthy();
    expect(getByText(comingSoonCopy('discover').title)).toBeTruthy();
    fireEvent.press(getByTestId('coming-soon-archive'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/feed');
  });
});

describe('FeatureGate', () => {
  it('shows Coming soon for a public member', () => {
    const { getByTestId, queryByText } = render(
      <FeatureGate feature="discover">
        <Text>secret</Text>
      </FeatureGate>,
    );
    expect(getByTestId('coming-soon')).toBeTruthy();
    expect(queryByText('secret')).toBeNull();
  });

  it('renders children for a beta member', () => {
    useProfileStore.setState({ profile: { access_tier: 'beta' } as never });
    const { getByText, queryByTestId } = render(
      <FeatureGate feature="discover">
        <Text>secret</Text>
      </FeatureGate>,
    );
    expect(getByText('secret')).toBeTruthy();
    expect(queryByTestId('coming-soon')).toBeNull();
  });
});
