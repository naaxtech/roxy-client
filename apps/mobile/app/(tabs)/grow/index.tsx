import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { callEdgeFunction, supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfile } from '../../../hooks/useProfile';
import { useFriendStore, isOnline, sortByPresence } from '../../../store/friendStore';
import { COLORS } from '../../../lib/constants';
import { Analytics } from '../../../lib/analytics';
import { isPresetAvatar, presetEmoji, presetColor } from '../../../lib/avatars';

type CommunityRow = { community_id: string; communities: { id: string; name: string; category: string } | null };
type DirectChatPreview = {
  id: string;
  partnerName: string;
  last_message_at: string | null;
};

type BadgeProgressRow = {
  user_id: string;
  badge_id: string;
  current_value: number;
  earned_at: string | null;
  badges: {
    id: string;
    name: string;
    description: string;
    emoji: string;
    category: string;
    points_value: number;
    requirement_type: string;
    requirement_threshold: number;
  } | null;
};

function getLevelInfo(points: number): { label: string; emoji: string; nextThreshold: number | null; progress: number } {
  if (points >= 500) return { label: 'Radiant', emoji: '✨', nextThreshold: null, progress: 1 };
  if (points >= 100) return { label: 'Bloom', emoji: '🌸', nextThreshold: 500, progress: (points - 100) / 400 };
  return { label: 'Seedling', emoji: '🌱', nextThreshold: 100, progress: points / 100 };
}

export default function GrowScreen() {
  const { user } = useAuthStore();
  const { profile } = useProfile();
  const router = useRouter();
  const { friends, fetchAll } = useFriendStore();

  useEffect(() => {
    if (user?.id) fetchAll(user.id);
  }, [user?.id]);

  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(true);
  const [communities, setCommunities] = useState<CommunityRow[]>([]);
  const [badges, setBadges] = useState<BadgeProgressRow[]>([]);

  useEffect(() => {
    if (!profile) return;
    setGreetingLoading(true);
    callEdgeFunction<{ greeting: string }>('roxy-greeting', {})
      .then(({ data }) => {
        setGreeting(data?.greeting ?? null);
        if (data?.greeting) Analytics.roxyGreetingViewed();
      })
      .catch(() => {})
      .finally(() => setGreetingLoading(false));
  }, [profile]);

  const loadSocial = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('community_members')
      .select('community_id, communities(id, name, category)')
      .eq('user_id', user.id);
    if (data) setCommunities(data as unknown as CommunityRow[]);
  }, [user]);

  useEffect(() => { loadSocial(); }, [loadSocial]);

  useEffect(() => {
    if (!user?.id) return;
    void Promise.resolve(
      supabase.from('user_badge_progress').select('*, badges(*)').eq('user_id', user.id).order('earned_at', { ascending: false, nullsFirst: false })
    ).then(({ data }) => { if (data) setBadges(data as BadgeProgressRow[]); }).catch(() => {});
  }, [user?.id]);

  const points = profile?.gamification_points ?? 0;
  const level = getLevelInfo(points);
  const earnedCount = badges.filter((b) => b.earned_at !== null).length;
  const inProgressCount = badges.filter((b) => b.earned_at === null && b.current_value > 0).length;
  const earnedBadges = badges.filter((b) => b.earned_at !== null).slice(0, 3);

  const [chatPreviews, setChatPreviews] = useState<DirectChatPreview[]>([]);
  const [chatTotal, setChatTotal] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data: convs } = await supabase
        .from('conversations')
        .select('id, participant_ids, last_message_at')
        .contains('participant_ids', [user.id])
        .eq('conversation_type', 'direct')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(10);
      if (!convs || convs.length === 0) return;
      setChatTotal(convs.length);
      const top3 = convs.slice(0, 3) as { id: string; participant_ids: string[]; last_message_at: string | null }[];
      const partnerIds = top3.map((c) => c.participant_ids.find((id) => id !== user.id) ?? null).filter(Boolean) as string[];
      if (partnerIds.length === 0) return;
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', partnerIds);
      const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name]));
      setChatPreviews(top3.map((c) => ({
        id: c.id,
        partnerName: profileMap.get(c.participant_ids.find((id) => id !== user.id) ?? '') ?? 'Unknown',
        last_message_at: c.last_message_at,
      })));
    })();
  }, [user?.id]);

  const avatarUrl = profile?.avatar_url ?? null;
  const avatarInitial = profile?.display_name?.[0]?.toUpperCase() ?? '?';
  const handle = profile?.username ? `@${profile.username}` : profile?.display_name ?? '';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          {/* Left — avatar + handle + badges */}
          <TouchableOpacity
            style={styles.headerLeft}
            onPress={() => router.push('/(tabs)/profile' as any)}
            activeOpacity={0.75}
          >
            <View style={[
              styles.headerAvatar,
              isPresetAvatar(avatarUrl) && { backgroundColor: presetColor(avatarUrl!) },
            ]}>
              {avatarUrl && !isPresetAvatar(avatarUrl) ? (
                <Image source={{ uri: avatarUrl }} style={styles.headerAvatarImg} />
              ) : (
                <Text style={styles.headerAvatarText}>
                  {isPresetAvatar(avatarUrl) ? presetEmoji(avatarUrl!) : avatarInitial}
                </Text>
              )}
            </View>
            <View style={styles.headerAvatarMeta}>
              <Text style={styles.headerHandle} numberOfLines={1}>{handle}</Text>
              {earnedBadges.length > 0 && (
                <View style={styles.headerBadgeRow}>
                  {earnedBadges.map((b) => (
                    <Text key={b.badge_id} style={styles.headerBadgeEmoji}>
                      {b.badges?.emoji ?? '🏅'}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          </TouchableOpacity>

          {/* Center — title */}
          <Text style={styles.screenTitle}>Grow</Text>

          {/* Right — settings */}
          <TouchableOpacity
            style={styles.headerRight}
            onPress={() => router.push('/profile/settings' as any)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="ellipsis-vertical" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Zone 1 — Roxy Greeting Card */}
        <View style={styles.greetingCard}>
          <View style={styles.roxyDot} />
          {greetingLoading ? (
            <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 24 }} />
          ) : (
            <Text style={styles.greetingText}>{greeting ?? 'Hey — Roxy here. 👋'}</Text>
          )}
          <Text style={styles.greetingLabel}>✨ Your daily message from Roxy</Text>
        </View>

        {/* My Chats */}
        {chatTotal > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Chats</Text>
            {chatPreviews.map((chat) => (
              <TouchableOpacity
                key={chat.id}
                style={styles.chatPreviewRow}
                onPress={() => router.push(`/chat/${chat.id}` as any)}
                activeOpacity={0.7}
              >
                <View style={styles.chatPreviewAvatar}>
                  <Text style={styles.chatPreviewAvatarText}>{chat.partnerName[0]?.toUpperCase() ?? '?'}</Text>
                </View>
                <Text style={styles.chatPreviewName} numberOfLines={1}>{chat.partnerName}</Text>
                <Text style={styles.chatPreviewTime}>
                  {chat.last_message_at
                    ? isToday(new Date(chat.last_message_at)) ? format(new Date(chat.last_message_at), 'HH:mm')
                    : isYesterday(new Date(chat.last_message_at)) ? 'Yesterday'
                    : format(new Date(chat.last_message_at), 'dd MMM')
                    : ''}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/grow/chats' as any)}
              style={styles.chatViewAll}
              activeOpacity={0.7}
            >
              <Text style={styles.chatViewAllText}>View all {chatTotal} chats →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Zone 2 — My Communities */}
        <TouchableOpacity
          style={styles.section}
          onPress={() => router.push('/(tabs)/discover' as any)}
          activeOpacity={0.75}
        >
          <Text style={styles.sectionTitle}>
            My Communities{' '}
            <Text style={styles.sectionHint}>tap to browse →</Text>
          </Text>
          {communities.length === 0 ? (
            <Text style={styles.emptyState}>Join your first community in Discover →</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {communities.map((row) => (
                <View key={row.community_id} style={styles.chip}>
                  <Text style={styles.chipText}>{row.communities?.name ?? '—'}</Text>
                </View>
              ))}
              <View style={[styles.chip, styles.chipJoin]}>
                <Text style={styles.chipJoinText}>+ Join more</Text>
              </View>
            </ScrollView>
          )}
        </TouchableOpacity>

        {/* Zone 3 — My People */}
        <TouchableOpacity
          style={styles.section}
          onPress={() => router.push('/(tabs)/grow/people' as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.sectionTitle}>
            My People{' '}
            <Text style={styles.sectionHint}>tap to manage →</Text>
          </Text>
          {friends.length === 0 ? (
            <Text style={styles.emptyState}>Connect with someone in Discover →</Text>
          ) : (
            <View style={styles.avatarRow}>
              {sortByPresence(friends).slice(0, 5).map((f) => (
                <View key={f.id} style={styles.avatarWrap}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {f.profile.display_name?.[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </View>
                  {isOnline(f.profile.last_seen_at) && (
                    <View style={styles.onlineDot} />
                  )}
                </View>
              ))}
              {friends.length > 5 && (
                <View style={styles.avatar}>
                  <Text style={styles.avatarCount}>+{friends.length - 5}</Text>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>

        {/* Zone 4 — My Journey */}
        <TouchableOpacity style={styles.section} activeOpacity={0.75}>
          <Text style={styles.sectionTitle}>My Journey</Text>
          <View style={styles.levelRow}>
            <Text style={styles.levelEmoji}>{level.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.levelLabel}>{level.label}</Text>
              <Text style={styles.levelPoints}>{points} points</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${level.progress * 100}%` as any }]} />
          </View>
          {level.nextThreshold !== null ? (
            <Text style={styles.progressHint}>{level.nextThreshold - points} points to next level</Text>
          ) : (
            <Text style={styles.progressHint}>You've reached the highest level! ✨</Text>
          )}
        </TouchableOpacity>

        {/* Zone 5 — Badges preview */}
        <TouchableOpacity
          style={styles.section}
          onPress={() => router.push('/(tabs)/grow/badges' as any)}
          activeOpacity={0.75}
        >
          <Text style={styles.sectionTitle}>
            🏆 Badges{' '}
            <Text style={styles.sectionHint}>tap to see all →</Text>
          </Text>
          {badges.length === 0 ? (
            <Text style={styles.emptyState}>Complete actions to earn badges! ✨</Text>
          ) : (
            <>
              <View style={styles.badgePreviewRow}>
                {badges.slice(0, 4).map((b) => (
                  <Text
                    key={b.badge_id}
                    style={[styles.badgePreviewEmoji, b.earned_at === null && styles.badgePreviewDim]}
                  >
                    {b.badges?.emoji ?? '🏅'}
                  </Text>
                ))}
              </View>
              <Text style={styles.badgePreviewSummary}>
                {earnedCount} earned · {inProgressCount} in progress
              </Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 12, gap: 10 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 4,
    minHeight: 48,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.primary + '30',
    borderWidth: 2, borderColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  headerAvatarImg: { width: 38, height: 38, borderRadius: 19 },
  headerAvatarText: { fontSize: 16 },
  headerAvatarMeta: { flexDirection: 'column', gap: 1 },
  headerHandle: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '600', maxWidth: 90 },
  headerBadgeRow: { flexDirection: 'row', gap: 1 },
  headerBadgeEmoji: { fontSize: 9 },
  screenTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '800', position: 'absolute', left: 0, right: 0, textAlign: 'center' },
  headerRight: { width: 36, alignItems: 'flex-end', justifyContent: 'center' },

  greetingCard: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 14,
    minHeight: 100, justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  roxyDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: COLORS.roxy, marginBottom: 8,
  },
  greetingText: { fontSize: 15, color: COLORS.textPrimary, lineHeight: 22, fontWeight: '500' },
  greetingLabel: { color: COLORS.textMuted, fontSize: 11, marginTop: 6 },

  section: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 6 },
  sectionHint: { color: COLORS.textMuted, fontSize: 11, fontWeight: '400' },
  emptyState: { color: COLORS.textMuted, fontSize: 13 },

  chipScroll: { marginTop: 4 },
  chip: {
    backgroundColor: COLORS.primary + '20', borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 5,
    marginRight: 6, borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  chipText: { color: COLORS.primary, fontWeight: '600', fontSize: 12 },
  chipJoin: { backgroundColor: COLORS.roxy + '20', borderColor: COLORS.roxy + '60' },
  chipJoinText: { color: COLORS.roxy, fontWeight: '600', fontSize: 12 },

  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  avatarCount: { color: COLORS.textMuted, fontWeight: '700', fontSize: 12 },
  onlineDot: {
    position: 'absolute', bottom: 0, right: 0,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: COLORS.success,
    borderWidth: 1.5, borderColor: COLORS.surface,
  },

  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  levelEmoji: { fontSize: 22 },
  levelLabel: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  levelPoints: { color: COLORS.textMuted, fontSize: 12 },
  progressTrack: {
    height: 4, backgroundColor: COLORS.surfaceLight,
    borderRadius: 2, overflow: 'hidden', marginBottom: 4,
  },
  progressFill: { height: 4, backgroundColor: COLORS.primary, borderRadius: 2 },
  progressHint: { color: COLORS.textMuted, fontSize: 11 },

  badgePreviewRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  badgePreviewEmoji: { fontSize: 20 },
  badgePreviewDim: { opacity: 0.3 },
  badgePreviewSummary: { color: COLORS.textMuted, fontSize: 11 },

  chatPreviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: COLORS.surfaceLight,
  },
  chatPreviewAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  chatPreviewAvatarText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  chatPreviewName: { flex: 1, color: COLORS.textPrimary, fontSize: 13, fontWeight: '600' },
  chatPreviewTime: { color: COLORS.textMuted, fontSize: 11, flexShrink: 0 },
  chatViewAll: { paddingTop: 8 },
  chatViewAllText: { color: COLORS.roxy, fontSize: 13, fontWeight: '600' },
});
