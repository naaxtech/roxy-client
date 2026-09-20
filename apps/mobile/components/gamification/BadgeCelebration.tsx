import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { Confetti } from './Confetti';
import type { EarnedBadgeCard } from '../../lib/badges';

interface Props {
  badges: EarnedBadgeCard[];
  onDismiss: () => void;
  testID?: string;
}

/**
 * The moment a badge is earned.
 *
 * Duolingo's lesson is that a reward has to interrupt. Roxy awarded badges
 * silently — `sync_my_badges` returned a count nobody rendered — so the only
 * way to discover you had earned something was to go looking for it, which is
 * the opposite of a reward.
 *
 * So it takes the screen: confetti, the badge at a size you cannot miss, its
 * name, why she got it, and the points. One badge at a time with a "Next" when
 * several land together — three badges shown at once is a list, and a list is
 * not a celebration.
 *
 * Everything decorative degrades: reduced motion drops the confetti and the
 * pop entirely rather than slowing them down, and the sheet still works.
 */
export function BadgeCelebration({ badges, onDismiss, testID = 'badge-celebration' }: Props) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const pop = useRef(new Animated.Value(0)).current;

  const badge = badges[index];
  const isLast = index >= badges.length - 1;

  useEffect(() => {
    if (!badge) return;
    // No haptic. `expo-haptics` is not a dependency, and the same reasoning
    // FloatingTabBar records for expo-blur applies: a new native module is too
    // much to ship for decoration. The confetti and the pop carry the moment.
    if (reduced) {
      pop.setValue(1);
      return;
    }
    pop.setValue(0);
    Animated.spring(pop, {
      toValue: 1,
      friction: 5,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [badge, reduced, pop]);

  if (!badge) return null;

  const s = StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: 'rgba(8,3,18,0.86)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 28,
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
      borderRadius: 99,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary + '26',
      borderWidth: 2,
      borderColor: colors.primary,
    },
    emoji: { fontSize: 52 },
    eyebrow: {
      ...TYPE.micro,
      color: colors.primaryInk,
      fontWeight: '800',
      letterSpacing: 1.4,
      marginTop: 4,
    },
    name: { ...TYPE.headline, color: colors.textPrimary, textAlign: 'center' },
    why: { ...TYPE.caption, color: colors.textSecondary, textAlign: 'center' },
    points: { ...TYPE.caption, color: colors.primaryInk, fontWeight: '800' },
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
    counter: { ...TYPE.micro, color: colors.textMuted },
  });

  const next = () => {
    if (isLast) { onDismiss(); return; }
    setIndex((i) => i + 1);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={s.scrim} testID={testID}>
        <Confetti active />

        <Animated.View
          style={[s.card, { transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }] }]}
        >
          <View style={s.medal}>
            <Text style={s.emoji}>{badge.emoji}</Text>
          </View>

          <Text style={s.eyebrow}>BADGE EARNED</Text>
          <Text style={s.name} testID={`${testID}-name`}>{badge.name}</Text>
          {badge.description ? <Text style={s.why}>{badge.description}</Text> : null}
          {badge.points > 0 ? (
            <Text style={s.points}>+{badge.points} points</Text>
          ) : null}

          {badges.length > 1 ? (
            <Text style={s.counter}>{index + 1} of {badges.length}</Text>
          ) : null}

          <Pressable
            style={s.button}
            onPress={next}
            accessibilityRole="button"
            accessibilityLabel={isLast ? 'Close' : 'Next badge'}
            testID={`${testID}-next`}
          >
            <Text style={s.buttonText}>{isLast ? 'Nice' : 'Next'}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
