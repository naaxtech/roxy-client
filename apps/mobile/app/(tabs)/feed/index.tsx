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
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';
import { TYPE } from '../../../lib/typography';
import { RADII } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { logError } from '../../../lib/errorLogger';
import { useAuthStore } from '../../../store/authStore';
import { useCommunityStore } from '../../../store/communityStore';
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { useFriendStore } from '../../../store/friendStore';
import { a11yState } from '../../../lib/a11yState';

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
  const joinedCommunities = useCommunityStore((s) => s.joinedCommunities);
  const hydrate = useCommunityStore((s) => s.hydrate);
  const friends = useFriendStore((s) => s.friends);
  const fetchAll = useFriendStore((s) => s.fetchAll);
  const selectedCommunityId = useCommunityFilterStore((s) => s.selectedCommunityId);
  const setFilterable = useCommunityFilterStore((s) => s.setFilterable);

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
  const switcherCommunities = useMemo(
    () => joinedCommunities.map((c) => ({ id: c.id, name: c.name })),
    [joinedCommunities]
  );

  /**
   * The Communities segment is the one place "which community" means
   * anything — For You reads `announcements` and Following reads `authorIds`,
   * neither of which ever looks at `communityIds`, so a selection made while
   * looking at Communities and left behind on another segment must not leak
   * into a query it cannot affect but could still be blamed for.
   *
   * The membership check is the second half of the same guard: a selection
   * naming a community she has since left would ask `ReelsFeed` to filter on
   * an id `communityIds` (all CURRENTLY joined ids) no longer contains, and
   * an empty result reads on screen as "this community posts nothing" — the
   * wrong lie to tell her about a community that is simply gone from the
   * list. A feed that is empty for an invisible reason is the bug here, not
   * the filter, so this falls back to every joined id instead.
   */
  const filteredCommunityIds = useMemo(() => {
    if (segment === 'communities' && selectedCommunityId && joinedIds.has(selectedCommunityId)) {
      return [selectedCommunityId];
    }
    return communityIds;
  }, [segment, selectedCommunityId, joinedIds, communityIds]);

  const scope = segment === 'foryou'
    ? 'announcements'
    : segment === 'following'
      ? 'following'
      : 'community';

  /*
   * Tell the rest of the app whether a community filter means anything here.
   *
   * The Roxy FAB offers "Filter this view" from every screen and cannot see
   * which segment is showing. Publishing it removes the guess: the surface that
   * decides whether to honour a selection is the surface that announces whether
   * one can be made. Clearing on unmount matters as much as setting it — the
   * FAB outlives this screen, so leaving `true` behind would re-enable the
   * action on Discover.
   */
  useEffect(() => {
    setFilterable(segment === 'communities');
    return () => setFilterable(false);
  }, [segment, setFilterable]);

  const handleNowCount = useCallback((n: number) => setLiveCount(n), []);

  return (
    <View style={s.stage} testID="feed-screen">
      <ReelsFeed
        scope={scope}
        communityIds={filteredCommunityIds}
        authorIds={authorIds}
      />

      {/* Absolute overlay so the pager keeps the full box it measures against. */}
      <SafeAreaView edges={['top']} style={s.headerLayer} pointerEvents="box-none">
        <View style={s.headerRow} pointerEvents="box-none">
          <StreakChip onPress={() => setMiniWinsOpen(true)} />
          {/* Only Communities has a "which one" to narrow — see the guard on
              filteredCommunityIds above for why the other two segments never
              reach for this even when a selection is sitting in the store. */}
          {segment === 'communities' && (
            <CommunityContextSwitcher communities={switcherCommunities} onStage />
          )}
          <View style={s.spacer} pointerEvents="none" />
          <TouchableOpacity
            testID="feed-now-toggle"
            onPress={() => setNowOpen((v) => !v)}
            accessibilityRole="button"
            {...a11yState({ expanded: nowOpen })}
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
  // The gap is load-bearing now: on the Communities segment this row holds the
  // streak chip AND the community switcher, and neither carries a margin of its
  // own. Without it they render flush against each other as one confusing pill.
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
