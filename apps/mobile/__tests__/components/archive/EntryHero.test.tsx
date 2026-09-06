import React from 'react';
import { Share } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { EntryHero } from '../../../components/archive/EntryHero';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `roxy:/${path}` }));

/**
 * The design's entry masthead. The live page had no art at all — a bare score
 * ring on a flat background, which read as a settings row rather than a
 * catalogue entry.
 */
describe('EntryHero', () => {
  const props = {
    slug: 'pariah',
    title: 'Pariah',
    mediaType: 'film' as const,
    meta: '2011 · Dee Rees · 1h 26m',
    coverGradient: 'linear-gradient(160deg,#1E2A4E,#4A3A7A 55%,#D98A5E)',
  };

  it('paints the banner with the entry’s OWN stored gradient', () => {
    const v = render(<EntryHero {...props} testID="h" />);
    expect(v.getByTestId('h-banner').props.colors).toEqual(['#1E2A4E', '#4A3A7A', '#D98A5E']);
  });

  it('still paints art when an entry has no stored gradient', () => {
    // A member-submitted entry has none until a mod adds one, and it still
    // needs a cover.
    const v = render(<EntryHero {...props} coverGradient={null} testID="h" />);
    expect(v.getByTestId('h-banner').props.colors.length).toBeGreaterThanOrEqual(2);
  });

  it('names the type the way the filter does, not the way the enum does', () => {
    const v = render(<EntryHero {...props} testID="h" />);
    expect(v.getByText('MOVIES')).toBeTruthy();
  });

  it('gives a long title two lines rather than cropping it', () => {
    const v = render(
      <EntryHero {...props} title="The Rise and Fall of a Midwest Princess" testID="h" />
    );
    expect(
      v.getByText('The Rise and Fall of a Midwest Princess').props.numberOfLines
    ).toBe(2);
  });

  it('renders the poster', () => {
    const v = render(<EntryHero {...props} testID="h" />);
    expect(v.getByTestId('h-poster')).toBeTruthy();
  });

  it('shares the work, and carries the link so the share is openable', () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const { getByTestId } = render(
      <EntryHero slug="carol" title="Carol" mediaType="film" meta="2015" coverGradient={null} testID="hero" />,
    );
    fireEvent.press(getByTestId('hero-share'));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('/archive/carol') }),
    );
    spy.mockRestore();
  });

  it('labels the share on a View, because Pressable drops aria on web', () => {
    const { getByLabelText } = render(
      <EntryHero slug="carol" title="Carol" mediaType="film" meta="2015" coverGradient={null} testID="hero" />,
    );
    expect(getByLabelText('Share Carol')).toBeTruthy();
  });
});
