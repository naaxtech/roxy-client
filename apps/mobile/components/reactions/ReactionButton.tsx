import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';
import type { AccessibilityActionEvent } from 'react-native';
import {
  POST_REACTIONS, REACTION_NAMES, formatReactionCount, type PostReaction,
} from '../../lib/postReactions';
import { PRESS, headStart, springTo } from '../../lib/motion';
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
 * Wave 3 (F1): the press dip and the squish are reanimated shared values set
 * from the responder grant, so the dip shows on the next frame (one-frame
 * head start) with no React render, and runs on the UI thread on native.
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

  const squish = useSharedValue(1);
  const press = useSharedValue(1);
  const firstPulse = useRef(picker.pulse);
  useEffect(() => {
    if (picker.pulse === firstPulse.current || reducedMotion) return;
    squish.value = 0.85;
    squish.value = withSequence(
      withSpring(1.12, springTo('fastSpatial')),
      withSpring(1, springTo('fastSpatial')),
    );
  }, [picker.pulse, reducedMotion, squish]);

  const pressTo = (to: number) => {
    if (reducedMotion) {
      press.value = to;
    } else if (to < 1 && press.value >= 0.999) {
      const { start, config } = headStart(1, to);
      press.value = start;
      press.value = withSpring(to, config);
    } else {
      press.value = withSpring(to, springTo('fastSpatial'));
    }
  };
  const faceStyle = useAnimatedStyle(() => ({ transform: [{ scale: squish.value * press.value }] }));

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
        pressTo(PRESS.scale);
        responder.onResponderGrant(e);
      }}
      onResponderRelease={(e) => {
        pressTo(1);
        responder.onResponderRelease(e);
      }}
      onResponderTerminate={() => {
        pressTo(1);
        responder.onResponderTerminate();
      }}
    >
      <Reanimated.View testID={`${testID}-face`} style={faceStyle}>
        {reaction ? (
          <View testID={`${testID}-disc`} style={s.disc}>
            <Text testID={`${testID}-emoji`} style={s.emoji} allowFontScaling={false}>{reaction}</Text>
          </View>
        ) : (
          <View style={s.glyphBox}>
            <OutlinedIcon name="happy-outline" size={RAIL_GLYPH} testID={`${testID}-glyph`} />
          </View>
        )}
      </Reanimated.View>
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
