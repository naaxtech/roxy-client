import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { EventPoster, posterTitleStep, POSTER_MIN_HEIGHT } from '../../../components/events/EventPoster';
import { GoingSeal, burstPath, SEAL_POINTS } from '../../../components/events/GoingSeal';
import { IDENTITY, RADII, identityFor, inkOn } from '../../../lib/theme';
import { TYPE } from '../../../lib/typography';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

/** Design direction v2 › signature moment 3 (board v2-03): the invite is a poster. */
describe('EventPoster', () => {
  const base = {
    title: 'Full moon swim',
    identityKey: 'community-1',
    communityName: 'Clovelly Dawn Dippers',
    startsAt: '2026-12-05T20:30:00',
  };

  it('is one identity field from the community, radius 20, with every word inked by inkOn', () => {
    const v = render(<EventPoster {...base} testID="p" />);
    const poster = flat(v.getByTestId('p'));
    expect(poster.backgroundColor).toBe(identityFor('community-1'));
    expect(IDENTITY).toContain(poster.backgroundColor);
    expect(poster.borderRadius).toBe(RADII.md);
    expect(Number(poster.minHeight)).toBeGreaterThanOrEqual(POSTER_MIN_HEIGHT);
    const ink = inkOn(String(poster.backgroundColor));
    expect(flat(v.getByText('Full moon swim')).color).toBe(ink);
    expect(flat(v.getByText('Clovelly Dawn Dippers')).color).toBe(ink);
  });

  it('sets a short title at moment and steps a long one down', () => {
    expect(posterTitleStep('Full moon swim')).toBe(TYPE.moment);
    expect(posterTitleStep('Book Club: Fingersmith')).toBe(TYPE.display);
    expect(posterTitleStep('A very long community gathering title that keeps on going')).toBe(TYPE.headline);
    const v = render(<EventPoster {...base} testID="p" />);
    expect(flat(v.getByTestId('p-title')).fontSize).toBe(TYPE.moment.fontSize);
  });

  it('shows the date, never the place', () => {
    const v = render(<EventPoster {...base} testID="p" />);
    expect(v.getByText('Sat 5 Dec · 8:30 pm')).toBeTruthy();
  });

  it('opens the community from its name', () => {
    const onOpen = jest.fn();
    const v = render(<EventPoster {...base} onOpenCommunity={onOpen} testID="p" />);
    fireEvent.press(v.getByTestId('p-community'));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('GoingSeal', () => {
  it('is a 16-point burst: 32 straight-edged vertices, no curves (never a flower)', () => {
    const d = burstPath(104);
    expect(SEAL_POINTS).toBe(16);
    expect((d.match(/[ML]/g) ?? []).length).toBe(32);
    expect(d).not.toMatch(/[CQAS]/);
    expect(d.trim().endsWith('Z')).toBe(true);
  });

  it('says You’re going for screen readers', () => {
    const v = render(<GoingSeal testID="seal" />);
    expect(v.getByTestId('seal').props.accessibilityLabel).toBe("You're going");
  });
});
