import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring,
} from 'react-native-reanimated';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { BRAND_INK_DEEP, RADII, inkOn } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { useCelebrationStore } from '../../store/celebrationStore';
import { Confetti } from '../gamification/Confetti';
import type { PostType } from '../../types';

interface Props {
  postType: PostType;
  onDismiss: () => void;
  testID?: string;
}

const TITLE = 'Your first post is live';

/**
 * Where the post went, in her words. A text card lives under Thoughts and
 * everything with media under Posts (see `afterPublishPath`), so the line
 * names the tab she just landed on rather than a generic "your profile".
 */
export function firstPostBody(postType: PostType): string {
  const tab = postType === 'standard' ? 'Thoughts' : 'Posts';
  return `It's on your profile now, under ${tab}. The women who follow you can see it in their feed.`;
}

/**
 * "Your first post is live" (FEED-09 delight; research: the first reply is the
 * activation moment, and the first post is the step before it).
 *
 * Shown exactly once per member — `claimFirstPostCelebration` decides that —
 * right after the composer's first successful publish. Confetti, a ✿ that
 * blooms, a success haptic, and a line that tells her where the post is.
 *
 * Reduced motion drops the confetti, the bloom and the haptic, and the card
 * still works. A screen reader hears the same news out loud.
 */
export function FirstPostCelebration({ postType, onDismiss, testID = 'first-post-celebration' }: Props) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const body = firstPostBody(postType);

  const pop = useSharedValue(reduced ? 1 : 0.86);
  const bloom = useSharedValue(reduced ? 1 : 0);
  const announced = useRef(false);

  useEffect(() => {
    // Once per mount: a re-render (theme flip, reduced-motion answer arriving)
    // must not buzz her phone a second time.
    if (announced.current) return;
    announced.current = true;
    // §3.3 / P3: no haptic (`success` is for "You're in" only); she gets the
    // overlay and the announcement.
    AccessibilityInfo.announceForAccessibility(`${TITLE}. ${body}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (reduced) {
      pop.value = 1;
      bloom.value = 1;
      return;
    }
    pop.value = withSpring(1, { damping: 11, stiffness: 260 });
    bloom.value = withDelay(
      120,
      withSequence(
        withSpring(1.25, { damping: 8, stiffness: 380 }),
        withSpring(1, { damping: 12, stiffness: 300 }),
      ),
    );
  }, [reduced, pop, bloom]);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const flowerStyle = useAnimatedStyle(() => ({ transform: [{ scale: bloom.value }] }));

  const s = StyleSheet.create({
    root: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 28,
    },
    scrim: {
      ...StyleSheet.absoluteFillObject,
      // BRAND_INK_DEEP at 86% — the same depth BadgeCelebration uses.
      backgroundColor: `${BRAND_INK_DEEP}DB`,
    },
    card: {
      width: '100%',
      maxWidth: 340,
      alignItems: 'center',
      gap: 10,
      paddingVertical: 30,
      paddingHorizontal: 24,
      borderRadius: RADII.sheet,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
    },
    medal: {
      width: 104,
      height: 104,
      borderRadius: RADII.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary + '26',
      borderWidth: 2,
      borderColor: colors.primary,
    },
    flower: { fontSize: 56, lineHeight: 64, color: colors.primaryInk },
    title: { ...TYPE.headline, color: colors.textPrimary, textAlign: 'center', marginTop: 6 },
    body: { ...TYPE.caption, color: colors.textSecondary, textAlign: 'center' },
    button: {
      minHeight: MIN_TOUCH_TARGET,
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: RADII.md,
      backgroundColor: colors.primary,
      marginTop: 8,
    },
    buttonText: { ...TYPE.body, fontWeight: '800', color: inkOn(colors.primary) },
  });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={s.root} testID={testID}>
        {/* The scrim is a sibling behind the card, so a tap on the card never closes it. */}
        <Pressable
          style={s.scrim}
          onPress={onDismiss}
          testID="first-post-scrim"
          accessible={false}
          importantForAccessibility="no"
        />
        {reduced ? null : <Confetti active />}

        {/* No accessibilityViewIsModal here: <Modal> already scopes the screen
            reader, and the prop would hide the scrim sibling from tests too. */}
        <Animated.View style={[s.card, cardStyle]}>
          <View style={s.medal}>
            <Animated.View style={flowerStyle}>
              <Text style={s.flower} accessibilityElementsHidden importantForAccessibility="no">
                ✿
              </Text>
            </Animated.View>
          </View>

          <Text style={s.title} accessibilityRole="header" testID="first-post-title">{TITLE}</Text>
          <Text style={s.body} testID="first-post-body">{body}</Text>

          <Pressable
            style={s.button}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID="first-post-dismiss"
          >
            <Text style={s.buttonText}>Love it</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Mounted once at the root, beside the badge celebration: the composer
 * `replace`s itself with her profile the moment the write lands, so the moment
 * has to outlive the screen that triggered it.
 */
export function FirstPostCelebrationHost() {
  const firstPost = useCelebrationStore((st) => st.firstPost);
  const dismiss = useCelebrationStore((st) => st.dismissFirstPost);
  if (!firstPost) return null;
  return <FirstPostCelebration postType={firstPost.postType} onDismiss={dismiss} />;
}
