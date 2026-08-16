import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { recordDailyCheckin } from '../../lib/streaks';
import { logError } from '../../lib/errorLogger';
import { STAGE } from './stageColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

interface Props {
  onPress: () => void;
}

/**
 * The streak, and the door to Mini Wins.
 *
 * Grow's whole ritual layer collapses to this chip plus the sheet behind it. It
 * has to earn its place in the corner of a video, so it renders only when there
 * is a real streak to show.
 *
 * `recordDailyCheckin()` returns `null` on ANY failure, including the case where
 * migration 056 was never applied — so `null` means "we do not know", and the
 * chip stays hidden rather than claiming a zero-day streak. A gamification
 * element that lies about the number is worse than one that is absent.
 */
export function StreakChip({ onPress }: Props) {
  const [days, setDays] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void recordDailyCheckin()
      .then((n) => { if (!cancelled) setDays(n); })
      .catch((e: unknown) => logError(e, 'StreakChip.checkin'));
    return () => { cancelled = true; };
  }, []);

  if (days === null || days < 1) return null;

  return (
    <TouchableOpacity
      testID="feed-streak-chip"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${days} day streak. Open today's Mini Wins.`}
      activeOpacity={0.85}
      style={s.chip}
    >
      <Ionicons name="flame" size={15} color={STAGE.goldInk} />
      <Text style={s.count}>{days}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: RADII.pill,
    backgroundColor: STAGE.surface,
    borderWidth: 1,
    borderColor: STAGE.line,
  },
  count: { ...TYPE.caption, color: STAGE.goldInk, fontWeight: '700' },
});
