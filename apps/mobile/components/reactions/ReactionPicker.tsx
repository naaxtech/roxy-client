import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  POST_REACTIONS, REACTION_NAMES, type PostReaction,
} from '../../lib/postReactions';
import { runSpring } from '../../lib/motion';
import { RADII, floatElevation } from '../../lib/theme';
import { a11yState } from '../../lib/a11yState';
import { STAGE } from '../feed/stageColors';
import { PICKER_DIM } from '../feed/feedChromeTokens';
import { PICKER, pickerFrame } from './reactionGeometry';
import type { ReactionPickerController } from './useReactionPicker';

interface Props {
  picker: ReactionPickerController;
  /** Her current reaction, drawn on a `pinkContainer` cell. */
  reaction: PostReaction | null;
  reducedMotion: boolean;
}

const HOVER_SCALE = PICKER.hoverEmoji / PICKER.emoji;

/**
 * The six-emoji picker (direction v2 › Reactions, board v2-04).
 *
 * Drawn by the host over the whole post (the post dims) and placed beside the
 * button that opened it (`pickerFrame`). A 64 dp `surface` pill (the stage's,
 * so it reads the same on every theme) with the six at 30 dp in 44 dp cells;
 * it springs out (`spatial`) and the items follow on `fastSpatial`, 20 ms
 * apart from the button's side. The emoji under her finger grows to 44 dp and
 * lifts 26 dp. Her current reaction sits on a `pinkContainer` cell. Tapping an
 * emoji works too; tapping the dimmed post closes it. Floats, so it carries
 * the `float` elevation.
 */
export function ReactionPicker({ picker, reaction, reducedMotion }: Props): ReactElement | null {
  if (!picker.open) return null;
  return <OpenPicker picker={picker} reaction={reaction} reducedMotion={reducedMotion} />;
}

function OpenPicker({ picker, reaction, reducedMotion }: Props): ReactElement {
  const frame = pickerFrame(picker.anchor);
  const pop = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    runSpring(pop, 1, 'spatial', reducedMotion);
  }, [pop, reducedMotion]);

  return (
    <View testID="reaction-picker" style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        testID="reaction-picker-dismiss"
        style={[StyleSheet.absoluteFill, s.dim]}
        onPress={picker.dismiss}
        accessibilityRole="button"
        accessibilityLabel="Close reactions"
      />
      <Animated.View
        testID="reaction-picker-pill"
        accessibilityRole="menu"
        accessibilityLabel="Reactions"
        style={[
          s.pill,
          floatElevation(STAGE),
          { left: frame.x, top: frame.y, width: frame.width },
          {
            opacity: pop,
            transform: [
              { translateX: pop.interpolate({ inputRange: [0, 1], outputRange: [PICKER.cell, 0] }) },
              { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) },
            ],
          },
        ]}
      >
        {POST_REACTIONS.map((emoji, i) => (
          <PickerItem
            key={emoji}
            emoji={emoji}
            delay={(POST_REACTIONS.length - 1 - i) * PICKER.staggerMs}
            hovered={picker.hovered === emoji}
            mine={reaction === emoji}
            reducedMotion={reducedMotion}
            onPick={picker.pick}
          />
        ))}
      </Animated.View>
    </View>
  );
}

function PickerItem({
  emoji, delay, hovered, mine, reducedMotion, onPick,
}: {
  emoji: PostReaction;
  delay: number;
  hovered: boolean;
  mine: boolean;
  reducedMotion: boolean;
  onPick: (emoji: PostReaction) => void;
}): ReactElement {
  const enter = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) return;
    const t = setTimeout(() => runSpring(enter, 1, 'fastSpatial'), delay);
    return () => clearTimeout(t);
  }, [delay, enter, reducedMotion]);

  useEffect(() => {
    runSpring(lift, hovered ? 1 : 0, 'fastSpatial', reducedMotion);
  }, [hovered, lift, reducedMotion]);

  return (
    <Pressable
      testID={`reaction-picker-item-${emoji}`}
      onPress={() => onPick(emoji)}
      accessibilityRole="menuitem"
      accessibilityLabel={`React with ${REACTION_NAMES[emoji]}`}
      {...a11yState({ selected: hovered || mine })}
      style={[s.cell, mine && s.cellMine]}
    >
      <Animated.View
        style={{
          transform: [
            { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -PICKER.lift] }) },
            { scale: Animated.multiply(enter, lift.interpolate({ inputRange: [0, 1], outputRange: [1, HOVER_SCALE] })) },
          ],
        }}
      >
        <Text style={s.emoji} allowFontScaling={false}>{emoji}</Text>
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  dim: { backgroundColor: PICKER_DIM },
  pill: {
    position: 'absolute',
    height: PICKER.height,
    paddingHorizontal: PICKER.pad,
    borderRadius: RADII.pill,
    backgroundColor: STAGE.surface,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cell: {
    width: PICKER.cell,
    height: PICKER.cell,
    borderRadius: PICKER.cell / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellMine: { backgroundColor: STAGE.pinkContainer },
  emoji: { fontSize: PICKER.emoji, lineHeight: PICKER.emoji + 6 },
});
