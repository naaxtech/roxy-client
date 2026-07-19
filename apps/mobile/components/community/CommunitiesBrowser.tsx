import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useCommunityStore, Community } from '../../store/communityStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { logError } from '../../lib/errorLogger';
import { showAlert } from '../../lib/confirm';
import { EmptyState } from '../ui/EmptyState';

function getCommunityLevel(n: number): { label: string; emoji: string } {
  if (n >= 100) return { label: 'Radiant', emoji: '✨' };
  if (n >= 20) return { label: 'Thriving', emoji: '🌸' };
  if (n >= 5) return { label: 'Growing', emoji: '🌿' };
  return { label: 'Seedling', emoji: '🌱' };
}

const CHIP_COLORS = ['#FF6A2E', '#8B5CF6', '#FF2F71', '#F472B6', '#C4476A', '#FF8A3D'];

/**
 * Inline communities browser — lives as the Communities subtab of Connect so
 * discovery is part of the tab flow, never a detached screen.
 */
export function CommunitiesBrowser() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const { allCommunities, joinedIds, joinCommunity, leaveCommunity } = useCommunityStore();
  const [search, setSearch] = useState('');

  const handleJoinLeave = useCallback(async (community: Community) => {
    if (!user) return;
    try {
      if (joinedIds.has(community.id)) {
        await leaveCommunity(community.id, user.id);
      } else {
        await joinCommunity(community.id, user.id);
      }
    } catch (e: any) {
      logError(e, 'communities_joinLeave');
      showAlert('Error', e?.message ?? 'Could not update membership');
    }
  }, [user, joinedIds, joinCommunity, leaveCommunity]);

  const filtered = search
    ? allCommunities.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          (c.description ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : allCommunities;

  const s = StyleSheet.create({
    search: {
      backgroundColor: colors.surface, borderRadius: 14,
      marginHorizontal: 14, marginTop: 10, marginBottom: 8,
      paddingHorizontal: 14, paddingVertical: 9,
      color: colors.textPrimary, fontSize: 14,
    },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: colors.surface, marginHorizontal: 14, marginBottom: 8,
      borderRadius: 16, padding: 12,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    },
    ava: {
      width: 46, height: 46, borderRadius: 14,
      alignItems: 'center', justifyContent: 'center',
    },
    avaText: { fontSize: 20, color: '#fff', fontWeight: '700' },
    info: { flex: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    name: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    badge: {
      backgroundColor: colors.secondary + '20', borderRadius: 8,
      paddingHorizontal: 5, paddingVertical: 1,
    },
    badgeText: { color: colors.secondary, fontSize: 10, fontWeight: '700' },
    desc: { color: colors.textMuted, fontSize: 12, marginBottom: 3 },
    meta: { color: colors.textMuted, fontSize: 11 },
    joinBtn: {
      paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
      borderWidth: 1.5, borderColor: colors.roxy,
    },
    joinBtnJoined: { backgroundColor: colors.roxy },
    joinBtnText: { color: colors.roxy, fontWeight: '700', fontSize: 12 },
    joinBtnTextJoined: { color: '#fff' },
  });

  return (
    <View style={{ flex: 1 }}>
      <TextInput
        style={s.search}
        placeholder="Search communities..."
        placeholderTextColor={colors.textMuted}
        value={search}
        onChangeText={setSearch}
        returnKeyType="search"
        accessibilityLabel="Search communities"
      />
      <FlashList
        data={filtered}
        keyExtractor={(item) => item.id}
        estimatedItemSize={90}
        extraData={joinedIds}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 20 }}
        renderItem={({ item, index }) => {
          const lvl = getCommunityLevel(item.member_count);
          const isJoined = joinedIds.has(item.id);
          const chipColor = CHIP_COLORS[index % CHIP_COLORS.length];
          return (
            <TouchableOpacity
              style={s.card}
              onPress={() => router.push(`/(tabs)/discover/community/${item.id}` as any)}
              activeOpacity={0.8}
            >
              <View style={[s.ava, { backgroundColor: chipColor }]}>
                <Text style={s.avaText}>{item.name[0]?.toUpperCase()}</Text>
              </View>
              <View style={s.info}>
                <View style={s.nameRow}>
                  <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{lvl.emoji} {lvl.label}</Text>
                  </View>
                </View>
                {item.description ? (
                  <Text style={s.desc} numberOfLines={1}>{item.description}</Text>
                ) : null}
                <Text style={s.meta}>
                  {item.is_private ? '🔒 Private' : '🌐 Public'} · {item.member_count} members
                </Text>
              </View>
              <TouchableOpacity
                style={[s.joinBtn, isJoined && s.joinBtnJoined]}
                onPress={() => handleJoinLeave(item)}
                activeOpacity={0.75}
                accessibilityLabel={isJoined ? `Leave ${item.name}` : `Join ${item.name}`}
              >
                <Text style={[s.joinBtnText, isJoined && s.joinBtnTextJoined]}>
                  {isJoined ? 'Joined ✓' : 'Join'}
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <EmptyState emoji="🔍" title="No communities found" body="Try a different search." />
        }
      />
    </View>
  );
}
