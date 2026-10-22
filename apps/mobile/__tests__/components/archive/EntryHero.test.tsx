import React from 'react';
import { Share, StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { EntryHero } from '../../../components/archive/EntryHero';
import { identityFor } from '../../../lib/theme';
import { COVER_WIDTH } from '../../../components/archive/archiveTokens';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `roxy:/${path}` }));

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

const hidden = { includeHiddenElements: true } as const;

/**
 * The entry masthead, v2 (design direction › Archive): the cover at 2:3 — the
 * uploaded one or the designed type cover — with the title, type and year
 * under it. v0 led with a 196 dp gradient banner; gradients now live on the
 * wordmark only.
 */
describe('EntryHero', () => {
  const props = {
    entryId: 'pariah-id',
    slug: 'pariah',
    title: 'Pariah',
    mediaType: 'film' as const,
    meta: '2011 · Dee Rees · 1h 26m',
    coverUrl: null,
    coverGradient: 'linear-gradient(160deg,#1E2A4E,#4A3A7A 55%,#D98A5E)',
  };

  it('shows the designed type cover in the entry’s identity field instead of the stored gradient', () => {
    const v = render(<EntryHero {...props} testID="h" />);
    expect(flat(v.getByTestId('h-poster-type', hidden)).backgroundColor).toBe(identityFor('pariah-id'));
    expect(v.UNSAFE_queryAllByType('LinearGradient' as never)).toHaveLength(0);
  });

  it('shows the uploaded cover when there is one, at the hero size', () => {
    const v = render(<EntryHero {...props} coverUrl="https://example.test/p.jpg" testID="h" />);
    expect(v.getByTestId('h-poster-image', hidden)).toBeTruthy();
    expect(flat(v.getByTestId('h-poster', hidden)).width).toBe(COVER_WIDTH.hero);
  });

  it('names the type the way the filter does, in sentence case in the meta line', () => {
    const v = render(<EntryHero {...props} testID="h" />);
    expect(v.getByText('Movies · 2011 · Dee Rees · 1h 26m')).toBeTruthy();
    expect(v.queryByText('MOVIES')).toBeNull();
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
    expect(v.getByTestId('h-poster', hidden)).toBeTruthy();
  });

  it('offers Add a cover under a missing cover, and only then', () => {
    const onAddCover = jest.fn();
    const v = render(<EntryHero {...props} onAddCover={onAddCover} testID="h" />);
    fireEvent.press(v.getByText('Add a cover'));
    expect(onAddCover).toHaveBeenCalledTimes(1);
    v.unmount();

    const withCover = render(
      <EntryHero {...props} coverUrl="https://example.test/p.jpg" onAddCover={onAddCover} testID="h" />,
    );
    expect(withCover.queryByText('Add a cover')).toBeNull();
  });

  it('shares the work, and carries the link so the share is openable', () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const { getByTestId } = render(
      <EntryHero {...props} slug="carol" title="Carol" meta="2015" coverGradient={null} testID="hero" />,
    );
    fireEvent.press(getByTestId('hero-share'));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('/archive/carol') }),
    );
    spy.mockRestore();
  });

  it('labels the share on a View, because Pressable drops aria on web', () => {
    const { getByLabelText } = render(
      <EntryHero {...props} slug="carol" title="Carol" meta="2015" coverGradient={null} testID="hero" />,
    );
    expect(getByLabelText('Share Carol')).toBeTruthy();
  });
});
