import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CommunityContextSwitcher } from '../../components/CommunityContextSwitcher';
import { useCommunityFilterStore } from '../../store/communityFilterStore';

const communities = [
  { id: 'c1', name: 'Queer Book Club' },
  { id: 'c2', name: 'WLW Gamers' },
  { id: 'c3', name: 'Lesbian Hikers Madrid' },
];

beforeEach(() => {
  useCommunityFilterStore.setState({ selectedCommunityId: null });
});

describe('CommunityContextSwitcher', () => {
  it('shows "All ▾" when no community selected', () => {
    const { getByText } = render(<CommunityContextSwitcher communities={communities} />);
    expect(getByText('All ▾')).toBeTruthy();
  });

  it('shows truncated community name when one is selected', () => {
    useCommunityFilterStore.setState({ selectedCommunityId: 'c3' });
    const { getByText } = render(<CommunityContextSwitcher communities={communities} />);
    // "Lesbian Hikers Madrid" (21 chars) → slice(0, 10) + "… ▾" = "Lesbian Hi… ▾"
    expect(getByText('Lesbian Hi… ▾')).toBeTruthy();
  });

  it('opens the picker sheet on button press', () => {
    const { getByTestId, getByText } = render(<CommunityContextSwitcher communities={communities} />);
    fireEvent.press(getByTestId('community-switcher-btn'));
    expect(getByText('View a Community')).toBeTruthy();
    expect(getByText('All Communities')).toBeTruthy();
    expect(getByText('Queer Book Club')).toBeTruthy();
  });

  it('selects a community and closes the sheet', () => {
    const { getByTestId, queryByText } = render(
      <CommunityContextSwitcher communities={communities} />
    );
    fireEvent.press(getByTestId('community-switcher-btn'));
    fireEvent.press(getByTestId('community-option-c2'));
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBe('c2');
    expect(queryByText('View a Community')).toBeNull();
  });

  it('selecting All Communities resets to null', () => {
    useCommunityFilterStore.setState({ selectedCommunityId: 'c1' });
    const { getByTestId } = render(<CommunityContextSwitcher communities={communities} />);
    fireEvent.press(getByTestId('community-switcher-btn'));
    fireEvent.press(getByTestId('community-option-all'));
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBeNull();
  });

  it('filters the list by search text', () => {
    const { getByTestId, getByText, queryByText } = render(
      <CommunityContextSwitcher communities={communities} />
    );
    fireEvent.press(getByTestId('community-switcher-btn'));
    fireEvent.changeText(getByTestId('community-search-input'), 'gamer');
    expect(getByText('WLW Gamers')).toBeTruthy();
    expect(queryByText('Queer Book Club')).toBeNull();
  });

  it('shows empty state when search has no matches', () => {
    const { getByTestId, getByText } = render(<CommunityContextSwitcher communities={communities} />);
    fireEvent.press(getByTestId('community-switcher-btn'));
    fireEvent.changeText(getByTestId('community-search-input'), 'zzznomatch');
    expect(getByText('No communities match')).toBeTruthy();
  });
});
