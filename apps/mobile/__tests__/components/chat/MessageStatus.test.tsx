import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { MessageStatus } from '../../../components/chat/MessageStatus';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';

/**
 * Item 2 of the community-chat brief: a message that failed must LOOK failed
 * and offer a retry, not sit there looking sent.
 */
describe('MessageStatus', () => {
  it('shows a single tick for a delivered, unread message', () => {
    const { getByText, queryByText } = render(
      <MessageStatus status="sent" isRead={false} onRetry={jest.fn()} />,
    );
    expect(getByText('✓')).toBeTruthy();
    expect(queryByText('✓✓')).toBeNull();
  });

  it('shows a double tick once the other person has read it', () => {
    const { getByText } = render(<MessageStatus status="sent" isRead onRetry={jest.fn()} />);
    expect(getByText('✓✓')).toBeTruthy();
  });

  it('announces an in-flight message as busy, not as delivered', () => {
    const { getByLabelText, queryByText } = render(
      <MessageStatus status="sending" isRead={false} onRetry={jest.fn()} />,
    );
    const node = getByLabelText('Sending');
    // accessibilityState alone is inert on react-native-web 0.19 — aria-busy
    // is what actually reaches assistive tech in the web build.
    expect(node.props['aria-busy']).toBe(true);
    expect(node.props.accessibilityState).toEqual({ busy: true });
    expect(queryByText('✓')).toBeNull();
    expect(queryByText('✓✓')).toBeNull();
  });

  it('says the message was not sent when it failed', () => {
    const { getByText, queryByText } = render(
      <MessageStatus status="failed" isRead={false} onRetry={jest.fn()} />,
    );
    expect(getByText('Not sent')).toBeTruthy();
    // Never a tick over a write that did not land.
    expect(queryByText('✓')).toBeNull();
    expect(queryByText('✓✓')).toBeNull();
  });

  it('offers a labelled retry button only on a failed message', () => {
    const { queryByLabelText, rerender, getByLabelText } = render(
      <MessageStatus status="sent" isRead={false} onRetry={jest.fn()} />,
    );
    expect(queryByLabelText('Retry sending message')).toBeNull();

    rerender(<MessageStatus status="failed" isRead={false} onRetry={jest.fn()} />);
    const retry = getByLabelText('Retry sending message');
    expect(retry.props.accessibilityRole).toBe('button');
  });

  it('calls onRetry when the retry button is pressed', () => {
    const onRetry = jest.fn();
    const { getByLabelText } = render(
      <MessageStatus status="failed" isRead={false} onRetry={onRetry} />,
    );
    fireEvent.press(getByLabelText('Retry sending message'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('gives the retry button a measured touch target of at least MIN_TOUCH_TARGET', () => {
    const { getByLabelText } = render(
      <MessageStatus status="failed" isRead={false} onRetry={jest.fn()} />,
    );
    const style = StyleSheet.flatten(getByLabelText('Retry sending message').props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});
