import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { COLORS } from '../../lib/constants';

function SkeletonBlock({ width, height, style }: {
  width: number | string; height: number; style?: object;
}) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, backgroundColor: COLORS.surface, borderRadius: 6, opacity },
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
