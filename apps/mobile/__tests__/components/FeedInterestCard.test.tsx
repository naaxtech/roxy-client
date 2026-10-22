/**
 * The negative signal, offered rather than buried.
 *
 * Instagram renders an inline dismissible card — "Are you interested in this
 * post?" · Not interested · Interested — instead of hiding the only negative
 * signal inside an overflow menu. Plan §11 adopts that and keeps report and
 * block under the `⋯`: "not for me" and "this frightened me" are different
 * sentences and must not share a control.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { FeedInterestCard } from '../../components/feed/FeedInterestCard';
import { RAIL_GUTTER } from '../../components/feed/feedChromeTokens';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockHaptic = jest.fn();
jest.mock('../../lib/haptics', () => ({ haptic: (...a: unknown[]) => mockHaptic(...a) }));

const noop = (): void => undefined;

function card(overrides: Partial<React.ComponentProps<typeof FeedInterestCard>> = {}) {
  return render(
    <FeedInterestCard
      onNotForMe={noop}
      onMoreOfThis={noop}
      onDismiss={noop}
      {...overrides}
    />,
  );
}

describe('FeedInterestCard', () => {
  // §3.3 selection (Wave 3): an answer is a choice and ticks once; the ✕ does not.
  it('an answer ticks once as a selection and still answers; dismissing plays nothing', () => {
    mockHaptic.mockReset();
    const onNotForMe = jest.fn();
    const onDismiss = jest.fn();
    const view = card({ onNotForMe, onDismiss });
    fireEvent.press(view.getByTestId('interest-close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(mockHaptic).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('interest-not-for-me'));
    expect(onNotForMe).toHaveBeenCalledTimes(1);
    expect(mockHaptic.mock.calls).toEqual([['selection']]);
  });

  it('asks the question and offers both answers', () => {
    const view = card();

    expect(view.getByTestId('interest-card-question').props.children)
      .toBe('Are you interested in this?');
    expect(view.getByTestId('interest-not-for-me').props.accessibilityLabel)
      .toBe('Not for me. Hide this post and show fewer like it');
    expect(view.getByTestId('interest-more-of-this').props.accessibilityLabel)
      .toBe('More of this. Keep this post in your feed');
  });

  it('gives every control a role, and the card itself a name', () => {
    const view = card();

    for (const id of ['interest-not-for-me', 'interest-more-of-this', 'interest-close']) {
      expect(view.getByTestId(id).props.accessibilityRole).toBe('button');
    }
    expect(view.getByTestId('interest-card').props.accessibilityLabel)
      .toBe('Are you interested in this?');
  });

  it('routes "not for me" to the hide path, never to the report path', () => {
    const onNotForMe = jest.fn();
    const onMoreOfThis = jest.fn();
    const view = card({ onNotForMe, onMoreOfThis });

    fireEvent.press(view.getByTestId('interest-not-for-me'));

    expect(onNotForMe).toHaveBeenCalledTimes(1);
    expect(onMoreOfThis).not.toHaveBeenCalled();
  });

  it('routes "more of this" to keeping the post', () => {
    const onNotForMe = jest.fn();
    const onMoreOfThis = jest.fn();
    const view = card({ onNotForMe, onMoreOfThis });

    fireEvent.press(view.getByTestId('interest-more-of-this'));

    expect(onMoreOfThis).toHaveBeenCalledTimes(1);
    expect(onNotForMe).not.toHaveBeenCalled();
  });

  it('can be dismissed without answering — declining to answer is an answer', () => {
    const onDismiss = jest.fn();
    const onNotForMe = jest.fn();
    const view = card({ onDismiss, onNotForMe });

    expect(view.getByTestId('interest-close').props.accessibilityLabel)
      .toBe('Dismiss this question');
    fireEvent.press(view.getByTestId('interest-close'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onNotForMe).not.toHaveBeenCalled();
  });

  it('never offers reporting from here', () => {
    const view = card();

    // The whole point of the split: a woman dismissing a post she finds dull
    // must not be walked through a form that treats her as an accuser, and a
    // woman who was frightened must not have to answer "interested?" first.
    expect(view.queryByText(/report/i)).toBeNull();
    expect(view.queryByText(/block/i)).toBeNull();
  });

  it('stops short of the right rail, so its close and "more of this" stay tappable', () => {
    // The card sits in the scrim band, which runs the full page width; the rail
    // column owns the right RAIL_GUTTER of every page. With an 18dp right
    // margin the card ran under the rail's ⋯ button (roxy.expo.app 2026-10-04).
    const flat = StyleSheet.flatten(card().getByTestId('interest-card').props.style) as
      { marginRight?: number; marginHorizontal?: number };

    expect(flat.marginRight ?? flat.marginHorizontal ?? 0).toBeGreaterThanOrEqual(RAIL_GUTTER);
  });
});
