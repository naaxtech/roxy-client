import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Image,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { format, isToday, isYesterday } from 'date-fns';
import { callEdgeFunction, supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfile } from '../../../hooks/useProfile';
import { useFriendStore, isOnline, sortByPresence } from '../../../store/friendStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { Analytics } from '../../../lib/analytics';
import { isPresetAvatar, presetEmoji, presetColor } from '../../../lib/avatars';
import { HappeningTonightCard } from '../../../components/grow/HappeningTonightCard';
import { QuestionOfTheDayCard } from '../../../components/grow/QuestionOfTheDayCard';
import { MiniWinsCard } from '../../../components/grow/MiniWinsCard';

const CHAT_GRADS: [string, string][] = [
  ['#FF6A2E', '#E81C8E'], ['#8B5CF6', '#E879A6'], ['#FF2F71', '#8B5CF6'],
  ['#C4476A', '#8B5CF6'], ['#FF8A3D', '#FF2F71'],
];
function chatGrad(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return CHAT_GRADS[Math.abs(h) % CHAT_GRADS.length];
}

type CommunityRow = { community_id: string; communities: { id: string; name: string; category: string } | null };
type DirectChatPreview = {
  id: string;
  partnerName: string;
  last_message_at: string | null;
};

type TicketRow = {
  ticket_code: string;
  events: {
    id: string;
    title: string;
    starts_at: string;
    location_text: string | null;
    communities: { name: string } | null;
  } | null;
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
  const colors = useThemeColors();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (user?.id) fetchAll(user.id);
  }, [user?.id]);

  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(true);
  const [communities, setCommunities] = useState<CommunityRow[]>([]);
  const [badges, setBadges] = useState<BadgeProgressRow[]>([]);
  const [socialError, setSocialError] = useState(false);

  useEffect(() => {
    if (!profile?.id) return;
    setGreetingLoading(true);
    callEdgeFunction<{ greeting: string }>('roxy-greeting', {})
      .then(({ data }) => {
        setGreeting(data?.greeting ?? null);
        if (data?.greeting) Analytics.roxyGreetingViewed();
      })
      .catch(() => {})
      .finally(() => setGreetingLoading(false));
  }, [profile?.id]);

  const loadSocial = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('community_members')
        .select('community_id, communities(id, name, category)')
        .eq('user_id', user.id);
      if (error) throw error;
      if (data) setCommunities(data as unknown as CommunityRow[]);
    } catch {
      setSocialError(true);
    }
  }, [user]);

  useEffect(() => { loadSocial(); }, [loadSocial]);

  const [communityActivity, setCommunityActivity] = useState<Record<string, { content: string }>>({});
  const communityKey = communities.map((row) => row.community_id).join(',');

  useEffect(() => {
    if (!communityKey) { setCommunityActivity({}); return; }
    const ids = communityKey.split(',');
    (async () => {
      const { data } = await supabase
        .from('posts')
        .select('community_id, content, created_at')
        .in('community_id', ids)
        .order('created_at', { ascending: false })
        .limit(50);
      const latest: Record<string, { content: string }> = {};
      for (const row of data ?? []) {
        if (!latest[row.community_id]) latest[row.community_id] = { content: row.content };
      }
      setCommunityActivity(latest);
    })();
  }, [communityKey]);

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

  const [tickets, setTickets] = useState<TicketRow[]>([]);
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

  useEffect(() => {
    if (!user?.id) return;
    const now = new Date().toISOString();
    (async () => {
      const { data } = await supabase
        .from('event_attendees')
        .select('ticket_code, events!inner(id, title, starts_at, location_text, communities(name))')
        .eq('user_id', user.id)
        .eq('status', 'going')
        .limit(20);
      // Sorted client-side — PostgREST can't order the outer query by a
      // nested embedded resource's column (events.starts_at) via .order().
      const upcoming = ((data ?? []) as unknown as TicketRow[])
        .filter((r): r is TicketRow & { events: NonNullable<TicketRow['events']> } =>
          !!r.events && r.events.starts_at >= now)
        .sort((a, b) => a.events.starts_at.localeCompare(b.events.starts_at))
        .slice(0, 5);
      setTickets(upcoming);
    })();
  }, [user?.id]);

  const communityIds = communities.map((row) => row.community_id);
  const avatarUrl = profile?.avatar_url ?? null;
  const avatarInitial = profile?.display_name?.[0]?.toUpperCase() ?? '?';
  const handle = profile?.username ? `@${profile.username}` : profile?.display_name ?? '';

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: 12, gap: 10 },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      paddingVertical: 8,
      marginBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: colors.surface,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    headerAvatar: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: colors.primary + '30',
      borderWidth: 2, borderColor: colors.primary,
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    },
    headerAvatarImg: { width: 38, height: 38, borderRadius: 19 },
    headerAvatarText: { fontSize: 16 },
    headerAvatarMeta: { flexDirection: 'column', gap: 1 },
    headerHandle: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', maxWidth: 90 },
    headerBadgeRow: { flexDirection: 'row', gap: 1 },
    headerBadgeEmoji: { fontSize: 9 },
    screenTitleWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    screenTitleLogo: { width: 220, height: 63 },
    screenSubtitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'flex-end' },

    // Roxy Hero card
    roxyHero: {
      backgroundColor: '#E81C8E', // fallback for LinearGradient
      borderRadius: 22, padding: 17,
      overflow: 'hidden',
    },
    rhTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 0 },
    rhAvRing: {
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)',
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    rhName: { color: '#fff', fontSize: 16, fontWeight: '800', lineHeight: 20 },
    rhBadge: {
      color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '700',
      letterSpacing: 0.4, marginTop: 2,
    },
    rhMsg: {
      color: '#fff', fontSize: 17, lineHeight: 25,
      fontWeight: '500', marginTop: 13, marginBottom: 15,
    },
    rhActions: { flexDirection: 'row', gap: 9 },
    rhBtn: {
      flex: 1, height: 42, borderRadius: 999,
      backgroundColor: '#fff',
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.16, shadowRadius: 8,
    },
    rhBtnText: { color: colors.roxy, fontWeight: '800', fontSize: 14 },
    rhBtnGhost: {
      width: 46, height: 42, borderRadius: 999,
      backgroundColor: 'rgba(255,255,255,0.16)',
      borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)',
      alignItems: 'center', justifyContent: 'center',
    },

    // Communities chips
    chipsRow: { gap: 10, paddingRight: 18, paddingBottom: 4 },
    cchip: {
      flexDirection: 'row', alignItems: 'center', gap: 9,
      backgroundColor: colors.surface, borderRadius: 15,
      paddingHorizontal: 14, paddingVertical: 9, paddingLeft: 9,
      borderWidth: 1, borderColor: colors.primary + '22',
      shadowColor: colors.primary, shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
    },
    cchipAva: {
      width: 36, height: 36, borderRadius: 11,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    cchipAvaText: { fontSize: 17, color: '#fff' },
    cchipName: { color: colors.textPrimary, fontWeight: '700', fontSize: 13.5, letterSpacing: -0.2 },
    cchipSub: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: 1 },
    cchipAdd: {
      borderStyle: 'dashed', borderColor: colors.primary + '50',
      backgroundColor: 'transparent',
    },
    cchipAddText: { color: colors.primary, fontWeight: '700', fontSize: 13 },

    section: { backgroundColor: colors.surface, borderRadius: 12, padding: 12 },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
    sectionHint: { color: colors.textMuted, fontSize: 11, fontWeight: '400' },
    emptyState: { color: colors.textMuted, fontSize: 13 },

    chipScroll: { marginTop: 4 },
    chip: {
      backgroundColor: colors.primary + '20', borderRadius: 16,
      paddingHorizontal: 10, paddingVertical: 5,
      marginRight: 6, borderWidth: 1, borderColor: colors.primary + '40',
    },
    chipText: { color: colors.primary, fontWeight: '600', fontSize: 12 },
    chipJoin: { backgroundColor: colors.roxy + '20', borderColor: colors.roxy + '60' },
    chipJoinText: { color: colors.roxy, fontWeight: '600', fontSize: 12 },

    communityCard: {
      width: 150, backgroundColor: colors.background, borderRadius: 12,
      padding: 10, marginRight: 8, borderWidth: 1, borderColor: colors.primary + '30',
      gap: 4,
    },
    communityCardName: { color: colors.primary, fontWeight: '700', fontSize: 12 },
    communityCardSnippet: { color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
    communityCardJoin: {
      alignItems: 'center', justifyContent: 'center', gap: 4,
      backgroundColor: colors.roxy + '14', borderColor: colors.roxy + '50',
    },

    avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
    avatarWrap: { position: 'relative' },
    avatar: {
      width: 36, height: 36, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { color: '#fff', fontWeight: '800', fontSize: 13 },
    avatarCount: { color: colors.textMuted, fontWeight: '700', fontSize: 12 },
    onlineDot: {
      position: 'absolute', bottom: 0, right: 0,
      width: 9, height: 9, borderRadius: 5,
      backgroundColor: colors.success,
      borderWidth: 1.5, borderColor: colors.surface,
    },

    levelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
    levelEmoji: { fontSize: 22 },
    levelLabel: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    levelPoints: { color: colors.textMuted, fontSize: 12 },
    progressTrack: {
      height: 4, backgroundColor: colors.surfaceLight,
      borderRadius: 2, overflow: 'hidden', marginBottom: 4,
    },
    progressFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
    progressHint: { color: colors.textMuted, fontSize: 11 },

    badgePreviewRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
    badgePreviewEmoji: { fontSize: 20 },
    badgePreviewDim: { opacity: 0.3 },
    badgePreviewSummary: { color: colors.textMuted, fontSize: 11 },

    chatPreviewRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingVertical: 6,
      borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
    },
    chatPreviewAvatar: {
      width: 30, height: 30, borderRadius: 15,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    chatPreviewAvatarText: { color: '#fff', fontWeight: '800', fontSize: 12 },
    chatPreviewName: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
    chatPreviewTime: { color: colors.textMuted, fontSize: 11, flexShrink: 0 },
    chatViewAll: { paddingTop: 8 },
    chatViewAllText: { color: colors.roxy, fontSize: 13, fontWeight: '600' },

    ticketSectionHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6,
    },
    ticketCount: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    ticketChip: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 12,
      marginRight: 10,
      width: 130,
      borderWidth: 1,
      borderColor: colors.primary + '40',
      gap: 3,
    },
    ticketChipGoing: { color: colors.roxy, fontSize: 11, fontWeight: '700' },
    ticketChipTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', lineHeight: 17 },
    ticketChipDate: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
    ticketChipTime: { color: colors.textMuted, fontSize: 11 },
    errorBanner: {
      backgroundColor: colors.error + '20',
      padding: 12,
      marginHorizontal: 16,
      marginBottom: 8,
      borderRadius: 8,
    },
    errorBannerText: { color: colors.error, fontSize: 13, textAlign: 'center' },
  });

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
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

          <View pointerEvents="none" style={styles.screenTitleWrap}>
            <ExpoImage
              source={require('../../../assets/brand/roxy-logo-primary.svg')}
              style={styles.screenTitleLogo}
              contentFit="contain"
            />
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => router.push('/profile/settings' as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}
              accessibilityLabel="Notifications"
            >
              <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Zone 1 — Roxy Hero Card */}
        <LinearGradient
          colors={['#FF6A2E', '#FF2F71', '#E81C8E']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0.85 }}
          style={styles.roxyHero}
        >
          <View style={styles.rhTop}>
            <View style={styles.rhAvRing}>
              <Ionicons name="sparkles" size={24} color="#fff" />
            </View>
            <View>
              <Text style={styles.rhName}>Roxy</Text>
              <Text style={styles.rhBadge}>✦ Your daily wingwoman</Text>
            </View>
          </View>
          {greetingLoading ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 14, marginBottom: 15, alignSelf: 'flex-start' }} />
          ) : (
            <Text style={styles.rhMsg}>{greeting ?? 'Hey — Roxy here. 👋'}</Text>
          )}
          <View style={styles.rhActions}>
            <TouchableOpacity
              style={styles.rhBtn}
              onPress={() => router.push('/(tabs)/grow/roxy-chat' as any)}
              activeOpacity={0.85}
            >
              <Ionicons name="sparkles" size={16} color={colors.roxy} />
              <Text style={styles.rhBtnText}>Ask Roxy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.rhBtnGhost}
              onPress={() => router.push('/(tabs)/grow/roxy-chat' as any)}
              activeOpacity={0.8}
              accessibilityLabel="Voice message"
            >
              <Ionicons name="mic" size={17} color="#fff" />
            </TouchableOpacity>
          </View>
        </LinearGradient>

        {/* Zone NEW — Question of the Day */}
        {user && (
          <QuestionOfTheDayCard
            communityIds={communityIds}
            userId={user.id}
          />
        )}

        {/* Zone NEW — Happening Tonight */}
        <HappeningTonightCard communityIds={communityIds} />

        {/* Zone NEW — Mini Wins */}
        {user && <MiniWinsCard userId={user.id} />}

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
                <LinearGradient colors={chatGrad(chat.partnerName)} style={styles.chatPreviewAvatar}>
                  <Text style={styles.chatPreviewAvatarText}>{chat.partnerName[0]?.toUpperCase() ?? '?'}</Text>
                </LinearGradient>
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

        {socialError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>Could not load communities. Pull to refresh.</Text>
          </View>
        )}

        {/* Zone 2 — My Communities */}
        <View>
          <View style={[styles.sectionHeaderRow, { paddingHorizontal: 0 }]}>
            <Text style={styles.sectionTitle}>My Communities</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/discover/communities' as any)}>
              <Text style={styles.sectionHint}>See all →</Text>
            </TouchableOpacity>
          </View>
          {communities.length === 0 ? (
            <View style={styles.section}>
              <Text style={styles.emptyState}>Join your first community in Play →</Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
            >
              {communities.map((row, idx) => {
                const name = row.communities?.name ?? '—';
                const activity = communityActivity[row.community_id];
                const sub = activity ? '🔥 New post' : 'Tap to open';
                const CHIP_COLORS = ['#FF6A2E', '#8B5CF6', '#FF2F71', '#F472B6', '#C4476A', '#FF8A3D'];
                const chipColor = CHIP_COLORS[idx % CHIP_COLORS.length];
                return (
                  <TouchableOpacity
                    key={row.community_id}
                    style={styles.cchip}
                    onPress={() => router.push(`/(tabs)/discover/community/${row.community_id}` as any)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.cchipAva, { backgroundColor: chipColor }]}>
                      <Text style={styles.cchipAvaText}>{name[0]?.toUpperCase() ?? '🌸'}</Text>
                    </View>
                    <View>
                      <Text style={styles.cchipName} numberOfLines={1}>{name}</Text>
                      <Text style={styles.cchipSub}>{sub}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.cchip, styles.cchipAdd]}
                onPress={() => router.push('/(tabs)/discover/communities' as any)}
                activeOpacity={0.8}
              >
                <View style={[styles.cchipAva, { backgroundColor: colors.primary + '18' }]}>
                  <Ionicons name="add" size={18} color={colors.primary} />
                </View>
                <Text style={styles.cchipAddText}>Discover</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>

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
            <Text style={styles.emptyState}>Connect with someone in Connect →</Text>
          ) : (
            <View style={styles.avatarRow}>
              {sortByPresence(friends).slice(0, 5).map((f) => (
                <View key={f.id} style={styles.avatarWrap}>
                  <LinearGradient colors={chatGrad(f.profile.display_name ?? '?')} style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {f.profile.display_name?.[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </LinearGradient>
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

        {/* My Tickets */}
        {tickets.length > 0 && (
          <View style={styles.section}>
            <View style={styles.ticketSectionHeader}>
              <Text style={styles.sectionTitle}>My Tickets</Text>
              <Text style={styles.ticketCount}>({tickets.length})</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {tickets.map((t) => (
                <TouchableOpacity
                  key={t.ticket_code}
                  style={styles.ticketChip}
                  onPress={() => t.events && router.push(`/event/${t.events.id}` as any)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.ticketChipGoing}>🌸 Going</Text>
                  <Text style={styles.ticketChipTitle} numberOfLines={2}>
                    {t.events?.title ?? '—'}
                  </Text>
                  <Text style={styles.ticketChipDate}>
                    {t.events ? format(new Date(t.events.starts_at), 'EEE d MMM') : ''}
                  </Text>
                  <Text style={styles.ticketChipTime}>
                    {t.events ? format(new Date(t.events.starts_at), 'h:mm a') : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
