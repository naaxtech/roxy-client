import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ReelsFeed } from '../../../components/feed/ReelsFeed';
import { FeedSegments, type FeedSegment } from '../../../components/feed/FeedSegments';
import { StreakChip } from '../../../components/feed/StreakChip';
import { NowRail } from '../../../components/feed/NowRail';
import { MiniWinsSheet } from '../../../components/feed/MiniWinsSheet';
import { STAGE, STAGE_BG } from '../../../components/feed/stageColors';
import { TYPE } from '../../../lib/typography';
import { RADII } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { logError } from '../../../lib/errorLogger';
import { useAuthStore } from '../../../store/authStore';
import { useCommunityStore } from '../../../store/communityStore';
import { useFriendStore } from '../../../store/friendStore';

/** One Mini Wins prompt per calendar day, per device. */
const MINI_WINS_KEY = 'roxy_mini_wins_last_shown';

const todayKey = () => new Date().toISOString().slice(0, 10);

/**
 * The Feed tab — the front door in 3.0.
 *
 * The pager underneath is the one the app already shipped; what is new is the
 * header over it and the three ways in. `ReelsFeed` sizes its pages off the box
 * it is given, so it must be the flex child and the header must be an absolute
 * overlay — as a sibling in a column it measured against the window, every page
 * came out taller than the visible area, and no video ever became viewable
 * enough to play. That is a fixed bug, not a layout preference.
 *
 * Every pixel of chrome here takes its ink from `STAGE`, not `useThemeColors()`:
 * the stage is dark in both themes. See `components/feed/stageColors.ts`.
 */
export default function FeedScreen() {
  const user = useAuthStore((s) => s.user);
  const joinedIds = useCommunityStore((s) => s.joinedIds);
  const hydrate = useCommunityStore((s) => s.hydrate);
  const friends = useFriendStore((s) => s.friends);
  const fetchAll = useFriendStore((s) => s.fetchAll);

  const [segment, setSegment] = useState<FeedSegment>('foryou');
  const [nowOpen, setNowOpen] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const [miniWinsOpen, setMiniWinsOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    void hydrate(user.id);
    void fetchAll(user.id);
  }, [user?.id, hydrate, fetchAll]);

  // First open of a day gets the sheet once. AsyncStorage rather than store
  // state: the point is "once today", and store state dies with the process.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void AsyncStorage.getItem(MINI_WINS_KEY)
      .then((last) => {
        if (cancelled || last === todayKey()) return;
        setMiniWinsOpen(true);
        return AsyncStorage.setItem(MINI_WINS_KEY, todayKey());
      })
      .catch((e: unknown) => logError(e, 'FeedScreen.miniWinsGate'));
    return () => { cancelled = true; };
  }, [user?.id]);

  const communityIds = useMemo(() => Array.from(joinedIds), [joinedIds]);
  const authorIds = useMemo(() => friends.map((f) => f.profile.id), [friends]);

  const scope = segment === 'foryou'
    ? 'announcements'
    : segment === 'following'
      ? 'following'
      : 'community';

  const handleNowCount = useCallback((n: number) => setLiveCount(n), []);

  return (
    <View style={s.stage} testID="feed-screen">
      <ReelsFeed
        scope={scope}
        communityIds={communityIds}
        authorIds={authorIds}
      />

      {/* Absolute overlay so the pager keeps the full box it measures against. */}
      <SafeAreaView edges={['top']} style={s.headerLayer} pointerEvents="box-none">
        <View style={s.headerRow} pointerEvents="box-none">
          <StreakChip onPress={() => setMiniWinsOpen(true)} />
          <View style={s.spacer} pointerEvents="none" />
          <TouchableOpacity
            testID="feed-now-toggle"
            onPress={() => setNowOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: nowOpen }}
            accessibilityLabel={
              liveCount > 0
                ? `Happening now, ${liveCount} rooms live. ${nowOpen ? 'Hide' : 'Show'}.`
                : `Happening now. ${nowOpen ? 'Hide' : 'Show'}.`
            }
            activeOpacity={0.85}
            style={s.nowBtn}
          >
            <Ionicons name="radio-outline" size={15} color={STAGE.textPrimary} />
            <Text style={s.nowLabel}>{liveCount > 0 ? `${liveCount} live` : 'Now'}</Text>
          </TouchableOpacity>
        </View>

        <View style={s.railWrap} pointerEvents="box-none">
          <NowRail open={nowOpen} onCount={handleNowCount} />
        </View>

        <FeedSegments value={segment} onChange={setSegment} />
      </SafeAreaView>

      <MiniWinsSheet
        visible={miniWinsOpen}
        userId={user?.id ?? null}
        onClose={() => setMiniWinsOpen(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  stage: { flex: 1, backgroundColor: STAGE_BG },
  headerLayer: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14, gap: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  spacer: { flex: 1 },
  railWrap: { },
  nowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 12,
    borderRadius: RADII.pill,
    backgroundColor: STAGE.surface,
    borderWidth: 1,
    borderColor: STAGE.line,
  },
  nowLabel: { ...TYPE.caption, color: STAGE.textPrimary, fontWeight: '700' },
});
