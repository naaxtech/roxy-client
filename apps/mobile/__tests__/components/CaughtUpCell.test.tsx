import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { CaughtUpCell, CAUGHT_UP_ID, isCaughtUpItem } from '../../components/feed/CaughtUpCell';
import { FAB_LANE } from '../../components/feed/feedChromeTokens';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

/**
 * The feed's last page (direction v2 › Feed): "You're caught up. Your
 * communities are talking in Messages." with the way there, clear of Roxy's lane.
 */
describe('CaughtUpCell', () => {
  it('tells her she is caught up and opens Messages from a 48 dp button', () => {
    const onOpenMessages = jest.fn();
    const v = render(<CaughtUpCell width={390} height={700} onOpenMessages={onOpenMessages} />);
    expect(v.getByText("You're caught up.")).toBeTruthy();
    expect(v.getByText('Your communities are talking in Messages.')).toBeTruthy();
    const button = v.getByTestId('feed-caught-up-messages');
    expect(button.props.accessibilityLabel).toBe('Open Messages');
    expect(Number(StyleSheet.flatten(button.props.style).minHeight)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    fireEvent.press(button);
    expect(onOpenMessages).toHaveBeenCalledTimes(1);
  });

  it('fills the page it is given and keeps its words above the Roxy AI lane', () => {
    const v = render(<CaughtUpCell width={390} height={700} onOpenMessages={jest.fn()} />);
    const page = StyleSheet.flatten(v.getByTestId('feed-caught-up').props.style);
    expect(page.width).toBe(390);
    expect(page.height).toBe(700);
    const body = v.getByText("You're caught up.").parent?.parent;
    expect(StyleSheet.flatten(body?.props.style).paddingBottom).toBe(FAB_LANE);
  });

  it('is told apart from a post by its id', () => {
    expect(isCaughtUpItem({ id: CAUGHT_UP_ID })).toBe(true);
    expect(isCaughtUpItem({ id: 'p1' })).toBe(false);
  });
});
