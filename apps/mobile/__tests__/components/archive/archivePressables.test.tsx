import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import { VoteCard } from '../../../components/archive/VoteCard';
import { ContentNoteChip } from '../../../components/archive/ContentNoteChip';
import { ComposerCheckbox } from '../../../components/archive/ComposerField';
import { PressableScale } from '../../../components/ui/PressableScale';
import { RADII } from '../../../lib/theme';

/**
 * Motion-spec lane B: "VoteCard, ContentNoteChip and archive pressables onto
 * PressableScale". They were raw RN Pressables: a finger on a star, a content
 * note or the spoiler checkbox showed nothing until the action ran. Each now
 * presses with the shared feedback, its state layer rounded like what she sees.
 */
const flat = (n: { props: { style?: unknown } }) => StyleSheet.flatten(n.props.style as never) as Record<string, unknown>;

describe('archive pressables on PressableScale', () => {
  it('each VoteCard star presses with the shared feedback and still rates', () => {
    const onRate = jest.fn();
    const v = render(<VoteCard myStars={null} onRate={onRate} testID="v" />);
    const presses = v.UNSAFE_getAllByType(PressableScale);
    expect(presses.length).toBeGreaterThanOrEqual(5);
    fireEvent.press(v.getByTestId('v-star-4'));
    expect(onRate).toHaveBeenCalledWith(4);
    for (const p of presses.slice(0, 5)) expect(flat(p).borderRadius).toBe(RADII.pill);
  });

  it('a content note presses as the pill it is, and long-press still works', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const v = render(
      <ContentNoteChip label="On-page grief" agreeCount={12} agreed={false} index={0}
        onPress={onPress} onLongPress={onLongPress} testID="chip" />,
    );
    const [p] = v.UNSAFE_getAllByType(PressableScale);
    expect(p).toBeTruthy();
    expect(flat(p).borderRadius).toBe(RADII.pill);
    fireEvent.press(v.getByTestId('chip'));
    expect(onPress).toHaveBeenCalled();
    fireEvent(v.getByTestId('chip'), 'longPress');
    expect(onLongPress).toHaveBeenCalled();
  });

  it('the spoiler checkbox row presses with a layer only (a big row should not shrink)', () => {
    const onToggle = jest.fn();
    const v = render(<ComposerCheckbox label="No spoilers" checked={false} onToggle={onToggle} testID="ack" />);
    const [p] = v.UNSAFE_getAllByType(PressableScale);
    expect(p.props.feedback).toBe('layer');
    fireEvent.press(v.getByTestId('ack'));
    expect(onToggle).toHaveBeenCalled();
  });
});
