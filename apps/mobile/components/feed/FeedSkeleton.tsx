import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';

function SkeletonBlock({ width, height, style }: {
  width: number | string; height: number; style?: object;
}) {
  const colors = useThemeColors();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 180, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 180, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, backgroundColor: colors.surface, borderRadius: 6, transform: [{ scale: pulse }] },
        style,
      ]}
    />
  );
}

function SkeletonCard() {
  return (
    <View style={styles.card}>
      <View style={styles.authorRow}>
        <SkeletonBlock width={36} height={36} style={{ borderRadius: 18 }} />
        <SkeletonBlock width={120} height={14} />
      </View>
      <SkeletonBlock width="100%" height={220} style={{ borderRadius: 12 }} />
      <SkeletonBlock width={200} height={12} style={{ marginTop: 10 }} />
      <View style={styles.actionsRow}>
        {[60, 60, 60, 30].map((w, i) => (
          <SkeletonBlock key={i} width={w} height={12} />
        ))}
      </View>
    </View>
  );
}

/**
 * RETIRED (Wave 3 lane B, motion-spec §4.2 "Retire FeedSkeleton"). Origin:
 * 8a1e6cc "feat(feed): feed components — … FeedSkeleton …", the v0 card feed's
 * loading list (three author/media/action cards). Unused since the feed became
 * a full-screen pager: the pager's loading state is `FeedStageSkeleton`, and
 * new placeholders use `components/feedback/Skeleton` (one shared pulse clock,
 * static under Reduce Motion — this one scales on a JS loop that ignores Reduce
 * Motion). Kept exported, uncalled, for any v0 card list that comes back; delete
 * only with Nicole's agreement.
 */
export function FeedSkeleton() {
  return (
    <View>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionsRow: { flexDirection: 'row', gap: 16, marginTop: 4 },
});
