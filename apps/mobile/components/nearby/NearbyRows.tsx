import { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useAuthStore } from '../../store/authStore';
import { useCommunityStore } from '../../store/communityStore';
import { logError } from '../../lib/errorLogger';
import { TYPE } from '../../lib/typography';
import { MARGIN, type ThemeColors } from '../../lib/theme';
import { nearbyRowMeta, type NearbyCommunity } from '../../lib/nearby';
import { CommunityRow, type JoinState } from '../discover/V2Cards';
import { byTheme } from '../discover/byTheme';

/**
 * Suggested communities as Discover's own `CommunityRow`s: crest, name,
 * "Within 10 km · Makati City · 12 members", and Join (public) or Ask to join
 * (private: a moderator decides). Joining goes through the community store's
 * `joinCommunity`, the same path as every other Join; a failure says so in
 * one sentence. The suggestion RPC leaves out communities she is in, so a
 * row she just joined keeps saying Joined until the list is asked again.
 */
export function NearbyRows({ rows }: { rows: NearbyCommunity[] }) {
  const colors = useThemeColors();
  const s = styles(colors);
  const router = useRouter();
  const userId = useAuthStore((st) => st.user?.id);
  const joinedIds = useCommunityStore((st) => st.joinedIds);
  const requestedIds = useCommunityStore((st) => st.requestedIds);
  const joinCommunity = useCommunityStore((st) => st.joinCommunity);
  const [joinError, setJoinError] = useState<string | null>(null);

  const joinStateOf = (id: string): JoinState => {
    if (joinedIds.has(id)) return 'joined';
    if (requestedIds?.has(id)) return 'requested';
    return 'join';
  };

  const join = async (communityId: string) => {
    if (!userId) return;
    setJoinError(null);
    try {
      await joinCommunity(communityId, userId);
    } catch (e) {
      logError(e, 'nearby.joinCommunity');
      setJoinError('That didn’t go through. Check your connection and tap Join again.');
    }
  };

  return (
    <>
      {joinError ? (
        <Text style={s.joinError} accessibilityLiveRegion="polite" testID="nearby-join-error">
          {joinError}
        </Text>
      ) : null}
      {rows.map((c) => (
        <CommunityRow
          key={c.id}
          id={c.id}
          name={c.name}
          meta={nearbyRowMeta(c)}
          join={joinStateOf(c.id)}
          joinLabel={c.is_private ? 'Ask to join' : undefined}
          onJoin={() => void join(c.id)}
          onPress={() => router.push(`/community/${c.id}` as never)}
          joinTestID={`nearby-join-${c.id}`}
          testID={`nearby-row-${c.id}`}
        />
      ))}
    </>
  );
}

// Built once per theme, not on every render (jank audit #8).
const styles = byTheme((colors: ThemeColors) => StyleSheet.create({
  joinError: { ...TYPE.meta, color: colors.dangerInk, paddingHorizontal: MARGIN },
}));
