/**
 * The rail's reaction button and its picker (direction v2 › Reactions,
 * board v2-04): tap = ❤️ (or take hers back), long-press 300 ms = the six-emoji
 * picker, slide and let go to pick, let go on the button to tap one instead,
 * let go elsewhere to cancel.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import type { PostReaction } from '../../../lib/postReactions';
import { ReactionButton } from '../../../components/reactions/ReactionButton';
import { ReactionPicker } from '../../../components/reactions/ReactionPicker';
import { useReactionPicker } from '../../../components/reactions/useReactionPicker';
import {
  PICKER, PICKER_WIDTH, pickerFrame, pickerHit,
} from '../../../components/reactions/reactionGeometry';
import { STAGE } from '../../../components/feed/stageColors';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockHaptic = jest.fn();
const mockTap = jest.fn();
jest.mock('../../../lib/haptics', () => ({
  haptic: (...a: unknown[]) => mockHaptic(...a),
  tapLight: (...a: unknown[]) => mockTap(...a),
}));

/** The button sits at x 322, y 400 in the host (a 390 dp page, rail at end 20). */
const ANCHOR = { x: 322, y: 400, width: 48, height: 48 };

function Harness({
  reaction, onReact, total = 1205,
}: { reaction: PostReaction | null; onReact: (e: PostReaction | null) => void; total?: number }) {
  const picker = useReactionPicker({ reaction, onReact, reducedMotion: true });
  return (
    <View>
      <View testID="column" onLayout={picker.layoutOf('column')}>
        <View testID="rail" onLayout={picker.layoutOf('rail')}>
          <ReactionButton picker={picker} reaction={reaction} total={total} noun="video" reducedMotion />
        </View>
      </View>
      <ReactionPicker picker={picker} reaction={reaction} reducedMotion />
    </View>
  );
}

function layout(view: ReturnType<typeof render>) {
  const at = (x: number, y: number, width = 48, height = 48) => ({
    nativeEvent: { layout: { x, y, width, height } },
  });
  fireEvent(view.getByTestId('column'), 'layout', at(322, 100, 48, 400));
  fireEvent(view.getByTestId('rail'), 'layout', at(0, 0, 48, 400));
  fireEvent(view.getByTestId('rail-react'), 'layout', at(0, 300));
}

/** A touch at a point in host coordinates, starting on the button's centre. */
function touch(x: number, y: number) {
  return { nativeEvent: { pageX: x, pageY: y, locationX: x - ANCHOR.x, locationY: y - ANCHOR.y, touches: [] } };
}
const CENTRE = { x: ANCHOR.x + 24, y: ANCHOR.y + 24 };

function cellCentre(index: number) {
  const frame = pickerFrame(ANCHOR);
  return { x: frame.x + PICKER.pad + PICKER.cell * index + PICKER.cell / 2, y: frame.y + PICKER.height / 2 };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockHaptic.mockReset();
  mockTap.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('picker geometry', () => {
  it('opens on the start side of the button, centred on it', () => {
    expect(pickerFrame(ANCHOR)).toEqual({
      x: ANCHOR.x - PICKER.gap - PICKER_WIDTH, y: 392, width: PICKER_WIDTH, height: 64,
    });
  });

  it('finds the emoji under the finger, heart furthest from the button', () => {
    expect(pickerHit(ANCHOR, cellCentre(0))).toBe('❤️');
    expect(pickerHit(ANCHOR, cellCentre(5))).toBe('💜');
    // Lifted a little above the pill still counts; far above does not.
    expect(pickerHit(ANCHOR, { x: cellCentre(2).x, y: 392 - 40 })).toBe('😮');
    expect(pickerHit(ANCHOR, { x: cellCentre(2).x, y: 392 - 80 })).toBeNull();
    // Back over the button: nothing.
    expect(pickerHit(ANCHOR, CENTRE)).toBeNull();
  });

  it('never runs off the start edge of a narrow phone', () => {
    expect(pickerFrame({ x: 292, y: 0, width: 48, height: 48 }).x).toBeGreaterThanOrEqual(PICKER.edge);
  });
});

describe('ReactionButton at rest', () => {
  it('shows the add-reaction glyph and the total until she reacts', () => {
    const view = render(<Harness reaction={null} onReact={jest.fn()} />);

    const button = view.getByTestId('rail-react');
    expect(button.props.accessibilityLabel).toBe('React to video, 1,205 reactions');
    expect(button.props.accessibilityState.selected).toBe(false);
    expect(view.queryByTestId('rail-react-disc')).toBeNull();
    expect(view.getByTestId('rail-react-count').props.children).toBe('1,205');
  });

  it('shows her emoji on a pinkContainer disc once she has reacted', () => {
    const view = render(<Harness reaction="😂" onReact={jest.fn()} />);

    const disc = view.getByTestId('rail-react-disc');
    expect(StyleSheet.flatten(disc.props.style).backgroundColor).toBe(STAGE.pinkContainer);
    expect(view.getByTestId('rail-react-emoji').props.children).toBe('😂');
    expect(view.getByTestId('rail-react').props.accessibilityLabel)
      .toBe('Your reaction: laughing. Tap to remove it. 1,205 reactions');
    expect(view.getByTestId('rail-react').props.accessibilityState.selected).toBe(true);
  });

  it('is a 48 dp target', () => {
    const view = render(<Harness reaction={null} onReact={jest.fn()} />);
    const style = StyleSheet.flatten(view.getByTestId('rail-react').props.style);
    expect(style.minWidth).toBe(48);
    expect(style.minHeight).toBe(48);
  });
});

describe('ReactionButton taps', () => {
  it('a tap gives a heart, with a light haptic', () => {
    const onReact = jest.fn();
    const view = render(<Harness reaction={null} onReact={onReact} />);
    layout(view);
    const button = view.getByTestId('rail-react');

    fireEvent(button, 'responderGrant', touch(CENTRE.x, CENTRE.y));
    act(() => { jest.advanceTimersByTime(120); });
    fireEvent(button, 'responderRelease', touch(CENTRE.x, CENTRE.y));

    expect(onReact).toHaveBeenCalledWith('❤️');
    expect(mockTap).toHaveBeenCalled();
    expect(view.queryByTestId('reaction-picker')).toBeNull();
  });

  it('a tap on her reaction takes it back', () => {
    const onReact = jest.fn();
    const view = render(<Harness reaction="💜" onReact={onReact} />);
    layout(view);
    const button = view.getByTestId('rail-react');

    fireEvent(button, 'responderGrant', touch(CENTRE.x, CENTRE.y));
    fireEvent(button, 'responderRelease', touch(CENTRE.x, CENTRE.y));

    expect(onReact).toHaveBeenCalledWith(null);
  });
});

describe('ReactionButton long-press picker', () => {
  function open(onReact = jest.fn(), reaction: PostReaction | null = null) {
    const view = render(<Harness reaction={reaction} onReact={onReact} />);
    layout(view);
    const button = view.getByTestId('rail-react');
    fireEvent(button, 'responderGrant', touch(CENTRE.x, CENTRE.y));
    act(() => { jest.advanceTimersByTime(PICKER.longPressMs); });
    return { view, button, onReact };
  }

  it('opens the six after 300 ms, positioned beside the button', () => {
    const { view } = open();

    const pill = view.getByTestId('reaction-picker-pill');
    const frame = pickerFrame(ANCHOR);
    const style = StyleSheet.flatten(pill.props.style);
    expect(style.left).toBe(frame.x);
    expect(style.top).toBe(frame.y);
    expect(['❤️', '😂', '😮', '😢', '😡', '💜'].map(
      (e) => view.getByTestId(`reaction-picker-item-${e}`).props.accessibilityLabel,
    )).toEqual([
      'React with heart', 'React with laughing', 'React with wow',
      'React with sad', 'React with angry', 'React with purple heart',
    ]);
  });

  // Motion spec §3.1 row 11 / F2: a tapped emoji answers on press-in, like
  // every other control (the one press primitive, `PressableScale`).
  it('each emoji answers on press-in, before it is released', () => {
    const { view, button } = open();
    fireEvent(button, 'responderRelease', touch(CENTRE.x, CENTRE.y));
    const item = view.getByTestId('reaction-picker-item-😂');
    expect(within(item).queryByTestId('press-state-layer')).toBeNull();
    fireEvent(item, 'pressIn');
    expect(within(item).getByTestId('press-state-layer')).toBeTruthy();
  });

  it('slide to an emoji and let go: that is her reaction, with selection haptics on the way', () => {
    const { view, button, onReact } = open();

    fireEvent(button, 'responderMove', touch(cellCentre(4).x, cellCentre(4).y));
    expect(view.getByTestId('reaction-picker-item-😡').props.accessibilityState.selected).toBe(true);
    fireEvent(button, 'responderMove', touch(cellCentre(2).x, cellCentre(2).y));
    expect(mockHaptic).toHaveBeenCalledWith('select', false);
    expect(mockHaptic).toHaveBeenCalledTimes(2);

    fireEvent(button, 'responderRelease', touch(cellCentre(2).x, cellCentre(2).y));

    expect(onReact).toHaveBeenCalledWith('😮');
    expect(mockTap).toHaveBeenCalled();
    expect(view.queryByTestId('reaction-picker')).toBeNull();
  });

  it('let go on the button: the picker stays for a tap (one hand, accessibility)', () => {
    const { view, button, onReact } = open();

    fireEvent(button, 'responderRelease', touch(CENTRE.x, CENTRE.y));
    expect(view.queryByTestId('reaction-picker')).not.toBeNull();
    expect(onReact).not.toHaveBeenCalled();

    fireEvent.press(view.getByTestId('reaction-picker-item-💜'));
    expect(onReact).toHaveBeenCalledWith('💜');
    expect(view.queryByTestId('reaction-picker')).toBeNull();
  });

  it('let go outside: nothing changes', () => {
    const { view, button, onReact } = open();

    fireEvent(button, 'responderMove', touch(cellCentre(1).x, 100));
    fireEvent(button, 'responderRelease', touch(cellCentre(1).x, 100));

    expect(onReact).not.toHaveBeenCalled();
    expect(view.queryByTestId('reaction-picker')).toBeNull();
  });

  it('a tap on the dimmed post closes it', () => {
    const { view, button, onReact } = open();
    fireEvent(button, 'responderRelease', touch(CENTRE.x, CENTRE.y));

    fireEvent.press(view.getByTestId('reaction-picker-dismiss'));

    expect(view.queryByTestId('reaction-picker')).toBeNull();
    expect(onReact).not.toHaveBeenCalled();
  });

  it('picking the reaction she already has changes nothing', () => {
    const { view, button, onReact } = open(jest.fn(), '😢');
    fireEvent(button, 'responderRelease', touch(CENTRE.x, CENTRE.y));

    fireEvent.press(view.getByTestId('reaction-picker-item-😢'));

    expect(onReact).not.toHaveBeenCalled();
  });

  it('a finger that starts scrolling never opens it', () => {
    const view = render(<Harness reaction={null} onReact={jest.fn()} />);
    layout(view);
    const button = view.getByTestId('rail-react');

    fireEvent(button, 'responderGrant', touch(CENTRE.x, CENTRE.y));
    fireEvent(button, 'responderMove', touch(CENTRE.x, CENTRE.y - 40));
    act(() => { jest.advanceTimersByTime(PICKER.longPressMs * 2); });

    expect(view.queryByTestId('reaction-picker')).toBeNull();
  });
});

describe('ReactionButton for a screen reader', () => {
  it('offers the heart as its action and the picker as long-press', () => {
    const onReact = jest.fn();
    const view = render(<Harness reaction={null} onReact={onReact} />);
    const button = view.getByTestId('rail-react');

    expect(button.props.accessibilityActions).toEqual(expect.arrayContaining([
      { name: 'activate' },
      { name: 'longpress', label: 'Choose a reaction' },
    ]));
    fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onReact).toHaveBeenCalledWith('❤️');

    fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    expect(view.queryByTestId('reaction-picker')).not.toBeNull();
  });
});
