import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { STAGE, STAGE_BG } from './stageColors';
import { CHROME_BOTTOM, RAIL_GUTTER } from './feedChromeTokens';

/**
 * The feed's loading state: the shape of a page, not a bare spinner (FEED-06).
 *
 * Drawn on the stage, so it takes STAGE ink in both themes (see
 * `stageColors.ts`). The bones sit where the real chrome will land: a rail
 * column in the right gutter and an identity block that stops `RAIL_GUTTER`
 * short of the right edge, so nothing here ever sits under the rail or the
 * Roxy FAB, and the page does not jump when the first post arrives.
 *
 * The pulse is a slow opacity breath. With reduce motion on it holds still.
 */
export function FeedStageSkeleton({
  reducedMotion, testID = 'feed-stage-skeleton',
}: {
  reducedMotion: boolean;
  testID?: string;
}): ReactElement {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion]);

  return (
    <View
      testID={testID}
      style={s.page}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading the feed"
    >
      <Animated.View style={[s.fill, { opacity: pulse }]} pointerEvents="none">
        <View testID={`${testID}-rail`} style={s.rail}>
          {[0, 1, 2, 3].map((i) => <View key={i} style={s.railDot} />)}
        </View>
        <View testID={`${testID}-identity`} style={s.identity}>
          <View style={s.row}>
            <View style={s.avatar} />
            <View style={s.handle} />
          </View>
          <View style={s.lineLong} />
          <View style={s.lineShort} />
        </View>
      </Animated.View>
    </View>
  );
}

const BONE = STAGE.surfaceLight;

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: STAGE_BG },
  fill: { ...StyleSheet.absoluteFillObject },
  rail: {
    position: 'absolute',
    right: (RAIL_GUTTER - 44) / 2,
    bottom: CHROME_BOTTOM + 120,
    width: 44,
    gap: 22,
    alignItems: 'center',
  },
  railDot: { width: 40, height: 40, borderRadius: 20, backgroundColor: BONE },
  identity: {
    position: 'absolute',
    left: 16,
    right: RAIL_GUTTER,
    bottom: CHROME_BOTTOM,
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: BONE },
  handle: { width: 120, height: 14, borderRadius: 7, backgroundColor: BONE },
  lineLong: { width: '90%', height: 12, borderRadius: 6, backgroundColor: BONE },
  lineShort: { width: '55%', height: 12, borderRadius: 6, backgroundColor: BONE },
});
