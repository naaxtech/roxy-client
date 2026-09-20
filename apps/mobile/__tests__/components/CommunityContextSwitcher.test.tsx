import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { CommunityContextSwitcher } from '../../components/CommunityContextSwitcher';
import { useCommunityFilterStore } from '../../store/communityFilterStore';
import { STAGE, STAGE_BG } from '../../components/feed/stageColors';
import { contrastRatio, THEMES } from '../../lib/theme';
import { useThemeStore } from '../../store/themeStore';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

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

  describe('onStage', () => {
    it('defaults to the active theme when the prop is omitted', () => {
      // themeStore defaults to 'dark', and STAGE is THEMES.dark — so the two
      // token sets are coincidentally identical unless the active theme is
      // forced to 'light' here, which is the only way this test can tell
      // "reads the active theme" apart from "happens to match STAGE today".
      // Unmounted before the store resets so the reset itself updates no
      // live subscriber.
      useThemeStore.setState({ theme: 'light' });
      const { getByTestId, getByText, unmount } = render(
        <CommunityContextSwitcher communities={communities} />
      );
      const btnStyle = flat(getByTestId('community-switcher-btn'));
      expect(btnStyle.backgroundColor).toBe(THEMES.light.surface);
      expect(btnStyle.backgroundColor).not.toBe(STAGE.surface);
      expect(flat(getByText('All ▾')).color).toBe(THEMES.light.primary);
      expect(flat(getByText('All ▾')).color).not.toBe(STAGE.primaryInk);
      unmount();
      useThemeStore.setState({ theme: 'dark' });
    });

    it('sources the trigger fill, border and label from STAGE when onStage is set', () => {
      const { getByTestId, getByText } = render(
        <CommunityContextSwitcher communities={communities} onStage />
      );
      const btnStyle = flat(getByTestId('community-switcher-btn'));
      expect(btnStyle.backgroundColor).toBe(STAGE.surface);
      expect(btnStyle.borderColor).toBe(STAGE.primaryInk);
      expect(flat(getByText('All ▾')).color).toBe(STAGE.primaryInk);
    });

    /**
     * The regression this guards against is the one `stageColors.ts` itself
     * documents: an ink pulled from `useThemeColors()` reads fine against its
     * own theme's ground and fails against the feed's permanently-dark stage.
     * This composites the ACTUAL colours the trigger is painted with — not a
     * belief about them — so a future edit to either token fails here first.
     */
    it('clears WCAG 2.2 AA for the trigger label and the 3:1 floor for its border, against the stage it actually sits on', () => {
      expect(contrastRatio(STAGE.primaryInk, STAGE.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(STAGE.primaryInk, STAGE_BG)).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('CommunityContextSwitcher trigger — the house floor', () => {
  // The component was orphaned before the 3.0 parity pass and came back into
  // the Feed header without being brought to the house standard. It sits in a
  // row beside StreakChip and the Now toggle, both of which are 48.
  it('is at least MIN_TOUCH_TARGET tall', () => {
    const { getByTestId } = render(<CommunityContextSwitcher communities={[]} />);
    const style = StyleSheet.flatten(getByTestId('community-switcher-btn').props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it('announces itself as a button and says what it does', () => {
    // Its visible label is a truncated community name plus "▾". A screen reader
    // reading "All ▾" is told a value and never told it is a control.
    const { getByTestId } = render(<CommunityContextSwitcher communities={[]} />);
    const btn = getByTestId('community-switcher-btn');

    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityLabel).toMatch(/communit/i);
  });

  it('names the community currently filtering the view', () => {
    useCommunityFilterStore.setState({ selectedCommunityId: 'c2' });
    const { getByTestId } = render(
      <CommunityContextSwitcher communities={[{ id: 'c2', name: 'WLW Hikers' }]} />
    );

    // The visible label truncates at 12 characters; the spoken one must not —
    // "WLW Hikers" and "WLW Hiking Club" truncate to the same thing.
    expect(getByTestId('community-switcher-btn').props.accessibilityLabel)
      .toContain('WLW Hikers');
  });
});
