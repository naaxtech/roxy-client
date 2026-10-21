import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { AccessibilityActionEvent } from 'react-native';
import {
  POST_REACTIONS, REACTION_NAMES, formatReactionCount, type PostReaction,
} from '../../lib/postReactions';
import { animatedSpring, runSpring } from '../../lib/motion';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import { STAGE } from '../feed/stageColors';
import { RAIL_GLYPH, REACTION_DISC } from '../feed/feedChromeTokens';
import { OutlinedIcon, OutlinedText } from '../feed/RailGlyph';
import { DISC_EMOJI } from './reactionGeometry';
import type { ReactionPickerController } from './useReactionPicker';

interface Props {
  picker: ReactionPickerController;
  /** Her reaction, or none. */
  reaction: PostReaction | null;
  /** Every reaction on the post (tallies + legacy likes). */
  total: number;
  /** What the post is, for the label ("React to video"). */
  noun: string;
  reducedMotion: boolean;
  testID?: string;
}

const ACTIONS = [
  { name: 'activate' },
  { name: 'longpress', label: 'Choose a reaction' },
  ...POST_REACTIONS.map((emoji) => ({ name: `react:${emoji}`, label: `React with ${REACTION_NAMES[emoji]}` })),
];

/**
 * The rail's reaction button (direction v2 › Reactions, board v2-04).
 *
 * Until she reacts: the outline add-reaction glyph. Once she has: her emoji
 * on a 48 dp `pinkContainer` disc (the stage's, #5A1236). Under it the post's
 * total in `meta`, tabular, compact by locale. Tap = ❤️ (or take hers back);
 * long-press = the picker (see `useReactionPicker`). When her reaction
 * changes the button squishes 0.85 → 1.12 → 1 (`fastSpatial`); under Reduce
 * Motion it simply changes.
 *
 * Every emoji is also a custom accessibility action, so a screen reader user
 * reacts with any of the six without the slide.
 */
export function ReactionButton({
  picker, reaction, total, noun, reducedMotion, testID = 'rail-react',
}: Props): ReactElement {
  const count = formatReactionCount(total);
  const label = reaction
    ? `Your reaction: ${REACTION_NAMES[reaction]}. Tap to remove it. ${count} reactions`
    : `React to ${noun}, ${count} reactions`;

  const squish = useRef(new Animated.Value(1)).current;
  const press = useRef(new Animated.Value(1)).current;
  const firstPulse = useRef(picker.pulse);
  useEffect(() => {
    if (picker.pulse === firstPulse.current || reducedMotion) return;
    squish.setValue(0.85);
    Animated.sequence([
      Animated.spring(squish, { toValue: 1.12, ...animatedSpring('fastSpatial') }),
      Animated.spring(squish, { toValue: 1, ...animatedSpring('fastSpatial') }),
    ]).start();
  }, [picker.pulse, reducedMotion, squish]);

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === 'activate') picker.tap();
    else if (name === 'longpress') picker.openPicker();
    else if (name.startsWith('react:')) picker.pick(name.slice('react:'.length) as PostReaction);
  };

  const { responder } = picker;

  return (
    <View
      testID={testID}
      style={s.target}
      onLayout={picker.layoutOf('button')}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Long-press to choose a reaction"
      accessibilityActions={ACTIONS}
      onAccessibilityAction={onAccessibilityAction}
      {...a11yState({ selected: reaction !== null })}
      {...responder}
      onResponderGrant={(e) => {
        runSpring(press, 0.96, 'fastSpatial', reducedMotion);
        responder.onResponderGrant(e);
      }}
      onResponderRelease={(e) => {
        runSpring(press, 1, 'fastSpatial', reducedMotion);
        responder.onResponderRelease(e);
      }}
      onResponderTerminate={() => {
        runSpring(press, 1, 'fastSpatial', reducedMotion);
        responder.onResponderTerminate();
      }}
    >
      <Animated.View style={{ transform: [{ scale: Animated.multiply(squish, press) }] }}>
        {reaction ? (
          <View testID={`${testID}-disc`} style={s.disc}>
            <Text testID={`${testID}-emoji`} style={s.emoji} allowFontScaling={false}>{reaction}</Text>
          </View>
        ) : (
          <View style={s.glyphBox}>
            <OutlinedIcon name="happy-outline" size={RAIL_GLYPH} testID={`${testID}-glyph`} />
          </View>
        )}
      </Animated.View>
      <OutlinedText testID={`${testID}-count`} style={s.count}>{count}</OutlinedText>
    </View>
  );
}

const s = StyleSheet.create({
  target: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphBox: {
    width: REACTION_DISC, height: REACTION_DISC, alignItems: 'center', justifyContent: 'center',
  },
  disc: {
    width: REACTION_DISC,
    height: REACTION_DISC,
    borderRadius: REACTION_DISC / 2,
    backgroundColor: STAGE.pinkContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: DISC_EMOJI, lineHeight: REACTION_DISC - 16 },
  count: { ...TYPE.meta, color: STAGE.ink, textAlign: 'center' },
});
