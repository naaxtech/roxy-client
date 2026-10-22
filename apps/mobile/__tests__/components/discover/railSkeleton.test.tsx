import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import {
  CardSkeleton, CommunityRow, EventPoster, MemberCard, TileCard,
} from '../../../components/discover/DiscoverCards';
import { Rail } from '../../../components/discover/Rail';
import { FadeIn, Skeleton } from '../../../components/feedback/Skeleton';
import { TYPE } from '../../../lib/typography';

/**
 * Jank audit #4 / budgets F8-F9: Discover's rails loaded as 140 x 180 grey
 * boxes (and 48 dp rows), then each rail landed at its real size — a 146 dp
 * poster is 195 tall, a community row is 72 — and everything under it jumped
 * (tab-cycle CLS 0.19, shift sources rail-events, rail-top10, rail-live).
 * A skeleton stands in for one card at that card's final geometry.
 */
/** Skeleton blocks are hidden from assistive tech (the group is the progressbar). */
const HIDDEN = { includeHiddenElements: true } as const;
const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | string | undefined>;

const W = 146;

type Node = { props: { style?: unknown; numberOfLines?: number } };
/** Same line boxes: every style key but the ink, and the same line budget. */
function sameText(ghost: Node, real: Node) {
  const strip = (n: Node) => {
    const { color: _c, ...rest } = flat(n);
    return rest;
  };
  expect(strip(ghost)).toEqual(strip(real));
  expect(ghost.props.numberOfLines).toBe(real.props.numberOfLines);
}

describe('MemberCard — a long name (live discover-audit, Wave 2)', () => {
  it('wraps onto a second line, reserved on every card, instead of clipping', () => {
    const v = render(
      <MemberCard rank={4} name="Aimee Naught Straight" subtitle="88 points" seed="u4" width={W} onPress={jest.fn()} />,
    );
    const name = v.getByText('Aimee Naught Straight');
    expect(name.props.numberOfLines).toBe(2);
    expect(flat(name).minHeight).toBe(2 * TYPE.label.lineHeight);
  });
});

describe('CardSkeleton — the card it stands for, without the content', () => {
  it('poster: the event poster\'s own box', () => {
    const poster = render(
      <EventPoster seed="s" title="t" when="Sat 25 Oct" host="h" detail="d" width={W} onPress={jest.fn()} testID="p" />,
    );
    const skel = render(<CardSkeleton kind="poster" width={W} testID="k" />);
    const real = flat(poster.getByTestId('p'));
    const fake = flat(skel.getByTestId('k', HIDDEN));
    expect(fake.width).toBe(real.width);
    expect(fake.height).toBe(real.height);
    expect(fake.borderRadius).toBe(real.borderRadius);
  });

  it('member: her photo box, then the rank line and the meta line as the card sets them', () => {
    const card = render(
      <MemberCard rank={1} name="Ada" subtitle="120 points" seed="u1" width={W} onPress={jest.fn()} testID="m" />,
    );
    const skel = render(<CardSkeleton kind="member" width={W} testID="k" />);
    const face = flat(card.getByTestId('m-initials'));
    const media = flat(skel.getByTestId('k-media', HIDDEN));
    expect([media.width, media.height]).toEqual([face.width, face.height]);
    expect(flat(skel.getByTestId('k', HIDDEN)).gap).toBe(flat(card.getByTestId('m')).gap);
    // Same text styles and line budgets, ink made invisible: identical line boxes.
    sameText(skel.getByTestId('k-rank', HIDDEN), card.getByTestId('m-rank'));
    sameText(skel.getByTestId('k-name', HIDDEN), card.getByText('Ada'));
    sameText(skel.getByTestId('k-meta', HIDDEN), card.getByText('120 points'));
    const rowOf = (n: { parent: unknown } & Node) => {
      let p = n.parent as (Node & { parent: unknown }) | null;
      while (p && flat(p).flexDirection !== 'row') p = p.parent as (Node & { parent: unknown }) | null;
      return flat(p!);
    };
    expect(rowOf(skel.getByTestId('k-rank', HIDDEN))).toEqual(rowOf(card.getByTestId('m-rank')));
  });

  it('tile: the 4:3 tile, two title lines and a meta line', () => {
    const card = render(<TileCard seed="s" title="Shop" meta="Lisbon" width={W} onPress={jest.fn()} testID="t" />);
    const skel = render(<CardSkeleton kind="tile" width={W} testID="k" />);
    const media = flat(skel.getByTestId('k-media', HIDDEN));
    expect(media.width).toBe(W);
    expect(media.height).toBe(Math.round(W * 3 / 4));
    expect(flat(skel.getByTestId('k', HIDDEN)).gap).toBe(flat(card.getByTestId('t')).gap);
    sameText(skel.getByTestId('k-name', HIDDEN), card.getByText('Shop'));
    sameText(skel.getByTestId('k-meta', HIDDEN), card.getByText('Lisbon'));
  });

  it('row: the row\'s own minimum height and padding', () => {
    const row = render(
      <CommunityRow id="c" name="Climbers" meta="20 members" join="joined" onPress={jest.fn()} testID="r" />,
    );
    const skel = render(<CardSkeleton kind="row" testID="k" />);
    const real = flat(row.getByTestId('r'));
    const fake = flat(skel.getByTestId('k', HIDDEN));
    expect(fake.minHeight).toBe(real.minHeight);
    expect(fake.paddingHorizontal).toBe(real.paddingHorizontal);
    expect(fake.paddingVertical).toBe(real.paddingVertical);
  });
});

describe('Rail loading at its final layout', () => {
  it('is one busy progressbar of pulsing blocks (C0 Skeleton), not grey boxes', () => {
    const v = render(
      <Rail title="Coming up" status="loading" count={0} emptyBody="x" onRetry={jest.fn()} testID="r"
        skeleton={{ kind: 'member', width: W }}>{null}</Rail>,
    );
    const group = v.getByTestId('r-loading');
    expect(group.props.accessibilityRole).toBe('progressbar');
    expect(group.props.accessibilityState).toEqual({ busy: true });
    expect(v.UNSAFE_getAllByType(Skeleton).length).toBeGreaterThanOrEqual(3 * 3);
  });

  it('fades content in when it replaces the skeleton, and shows remembered content at once', () => {
    const props = { title: 'T', count: 1, emptyBody: 'x', onRetry: jest.fn(), testID: 'r', skeleton: { kind: 'poster' as const, width: W } };
    const v = render(<Rail {...props} status="loading">{null}</Rail>);
    v.rerender(<Rail {...props} status="ready"><EventPoster seed="s" title="t" when="w" host="h" detail="d" width={W} onPress={jest.fn()} /></Rail>);
    expect(v.UNSAFE_getByType(FadeIn).props.instant).toBe(false);

    const warm = render(<Rail {...props} status="ready"><EventPoster seed="s" title="t" when="w" host="h" detail="d" width={W} onPress={jest.fn()} /></Rail>);
    expect(warm.UNSAFE_getByType(FadeIn).props.instant).toBe(true);
  });

  const rail = (props: Partial<React.ComponentProps<typeof Rail>>) => render(
    <Rail title="Coming up" status="loading" count={0} emptyBody="x" onRetry={jest.fn()} testID="r" {...props}>
      {null}
    </Rail>,
  );

  it('draws the skeleton it is given, at the width the cards will have', () => {
    const v = rail({ skeleton: { kind: 'poster', width: W } });
    const cards = v.getAllByTestId(/^r-skeleton-\d+$/, HIDDEN);
    expect(cards.length).toBeGreaterThanOrEqual(3);
    for (const c of cards) {
      expect(flat(c).width).toBe(W);
      expect(flat(c).height).toBe(Math.round(W * 4 / 3));
    }
  });

  it('draws as many rows as the section will show', () => {
    const v = rail({ layout: 'list', skeleton: { kind: 'row', count: 5 } });
    expect(v.getAllByTestId(/^r-skeleton-\d+$/, HIDDEN)).toHaveLength(5);
  });

  it('lays the skeletons out in the container the cards will use', () => {
    const v = render(
      <>
        <Rail title="T" status="loading" count={0} emptyBody="x" onRetry={jest.fn()} testID="l"
          layout="grid" skeleton={{ kind: 'tile', width: W }}>{null}</Rail>
        <Rail title="T" status="ready" count={1} emptyBody="x" onRetry={jest.fn()} testID="g" layout="grid">
          <TileCard seed="s" title="Shop" meta="Lisbon" width={W} onPress={jest.fn()} />
        </Rail>
      </>,
    );
    expect(flat(v.getByTestId('l-loading'))).toEqual(flat(v.getByTestId('g-cards')));
  });
});
