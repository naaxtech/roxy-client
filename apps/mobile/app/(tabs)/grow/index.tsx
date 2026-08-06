import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Image,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { format } from 'date-fns';
import { callEdgeFunction, supabase } from '../../../lib/supabase';
import { useFocusEffect } from '@react-navigation/native';
import { recordDailyCheckin } from '../../../lib/streaks';
import { fetchUnreadNotificationCount } from '../../../lib/notifications';
import { freshChannel } from '../../../lib/realtimeChannel';
import { SectionHeader } from '../../../components/ui/SectionHeader';
import { useAuthStore } from '../../../store/authStore';
import { useProfile } from '../../../hooks/useProfile';
import { useFriendStore, isOnline, sortByPresence } from '../../../store/friendStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { BRAND_INK, COMMUNITY_CHIP_COLORS, inkOn } from '../../../lib/theme';
import { Analytics } from '../../../lib/analytics';
import { isPresetAvatar, presetEmoji, presetColor, avatarGradient } from '../../../lib/avatars';
import { HappeningTonightCard } from '../../../components/grow/HappeningTonightCard';
import { QuestionOfTheDayCard } from '../../../components/grow/QuestionOfTheDayCard';
import { MiniWinsCard } from '../../../components/grow/MiniWinsCard';
import { HomeCategoryPills } from '../../../components/nav/HomeCategoryPills';
import { DonateModal } from '../../../components/donations/DonateModal';

const CHIP_COLORS = COMMUNITY_CHIP_COLORS;

type CommunityRow = { community_id: string; communities: { id: string; name: string; category: string } | null };

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

function greetingWord(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// Vector level marks — never raw emoji as UI assets.
function getLevelInfo(points: number): { label: string; icon: 'sparkles' | 'flower' | 'leaf'; nextThreshold: number | null; progress: number } {
  if (points >= 500) return { label: 'Radiant', icon: 'sparkles', nextThreshold: null, progress: 1 };
  if (points >= 100) return { label: 'Bloom', icon: 'flower', nextThreshold: 500, progress: (points - 100) / 400 };
  return { label: 'Seedling', icon: 'leaf', nextThreshold: 100, progress: points / 100 };
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
  const [streak, setStreak] = useState<number | null>(null);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [showDonateModal, setShowDonateModal] = useState(false);

  // On every focus (not just mount — the tab stays mounted for days):
  // re-record the daily check-in so long-lived sessions keep their streak,
  // and refresh the unread count so the bell clears after reads.
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      void recordDailyCheckin().then(setStreak);
      void fetchUnreadNotificationCount(user.id).then(setUnreadNotifs);
    }, [user?.id])
  );

  // Live badge increments via a user-filtered Realtime subscription
  // (never table-wide); focus refetch above corrects any drift.
  useEffect(() => {
    if (!user?.id) return;
    const channel = freshChannel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => setUnreadNotifs((n) => n + 1)
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

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
  const earned = badges.filter((b) => b.earned_at !== null);
  const earnedCount = earned.length;
  const inProgressCount = badges.filter((b) => b.earned_at === null && b.current_value > 0).length;
  const earnedBadges = earned.slice(0, 3);

  const [tickets, setTickets] = useState<TicketRow[]>([]);

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

  // Referentially stable across renders: `communities.map(...)` alone returns a
  // NEW array every render, which made QuestionOfTheDayCard and
  // HappeningTonightCard (whose load() effects depend on communityIds) refetch
  // on EVERY GrowScreen render — ~10 duplicate questions_of_the_day /
  // community_rooms / events queries per screen open. communityKey is the
  // stable string form of the same ids, so the memo only recomputes when the
  // community set actually changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const communityIds = useMemo(() => communities.map((row) => row.community_id), [communityKey]);
  const firstName = profile?.display_name?.split(' ')[0] ?? 'you';
  const buzzingCount = Object.keys(communityActivity).length;
  const avatarUrl = profile?.avatar_url ?? null;
  const avatarInitial = profile?.display_name?.[0]?.toUpperCase() ?? '?';
  const handle = profile?.username ? `@${profile.username}` : profile?.display_name ?? '';

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // The companion FAB (components/ui/RoxyCompanionButton) is a 56pt circle at
    // `bottom: 90` on the tab layout root, i.e. it reaches 78pt up into this
    // ScrollView's box and paints over whatever is there — with only 12pt of
    // bottom padding the last card ends its life under an opaque gradient.
    // 78 of overlap + 18 of breathing room.
    scroll: { padding: 12, gap: 10, paddingBottom: 96 },

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

    // Roxy Hero — flat section on screen bg: avatar + speech-bubble greeting,
    // then a compact self-sizing gradient pill + ghost mic button below.
    roxyHero: {
      marginBottom: 2,
    },
    rhRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    rhAvRing: {
      width: 56, height: 56, borderRadius: 28,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      shadowColor: '#E81C8E', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    },
    rhBubble: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1, borderColor: colors.roxy + '22',
      paddingHorizontal: 16, paddingVertical: 13,
      minHeight: 56, justifyContent: 'center',
      shadowColor: colors.roxy, shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06, shadowRadius: 6, elevation: 1,
    },
    rhMsg: {
      color: colors.textPrimary, fontSize: 15, lineHeight: 21,
      fontWeight: '500',
    },
    // Indented under the bubble (avatar 56 + gap 12) so the pill reads as the
    // bubble's reply affordance instead of floating loose at the screen edge.
    rhActions: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 10, marginLeft: 68 },
    rhBtn: {
      minHeight: 44, borderRadius: 999, paddingHorizontal: 22,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      shadowColor: '#E81C8E', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25, shadowRadius: 8, elevation: 3,
    },
    // The brand ramp is light: white on its #FF6A2E end is 2.86:1, which fails
    // even the 3:1 non-text bar. Dark ink reads on every stop (6.53:1 at the
    // orange end, 4.43:1 at the deepest pink) — see __tests__/theme.contrast.
    rhBtnText: { color: BRAND_INK, fontWeight: '800', fontSize: 14 },
    rhBtnGhost: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: colors.surface,
      borderWidth: 1.5, borderColor: colors.roxy + '30',
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
    cchipAvaText: { fontSize: 17 },
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

    levelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
    levelLabel: { color: colors.textPrimary, fontWeight: '800', fontSize: 15 },
    progressTrack: {
      height: 7, backgroundColor: colors.surfaceLight,
      borderRadius: 4, overflow: 'hidden',
    },
    progressFill: { height: 7, borderRadius: 4 },
    progressHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },

    // Shared gradient icon plate for the lower Grow rows — the "exciting"
    // treatment: vector icon on a bold gradient squircle, never emoji chrome.
    rowPlate: {
      width: 42, height: 42, borderRadius: 14,
      alignItems: 'center', justifyContent: 'center',
    },
    rowTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 15 },
    journeyHeader: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginBottom: 10,
    },
    pointsChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.roxy + '14',
      borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
    },
    pointsChipText: { color: colors.roxy, fontWeight: '800', fontSize: 11 },

    badgeHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    badgePreviewRow: { flexDirection: 'row', gap: 4 },
    badgeCoin: {
      width: 30, height: 30, borderRadius: 15,
      backgroundColor: colors.surfaceLight,
      alignItems: 'center', justifyContent: 'center',
    },
    badgePreviewEmoji: { fontSize: 15 },
    badgePreviewDim: { opacity: 0.3 },

    greet: { paddingHorizontal: 4, paddingTop: 2 },
    greetTitle: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, lineHeight: 32 },
    greetName: { color: colors.roxy },
    greetSub: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginTop: 4 },
    greetStreak: { color: colors.roxy, fontWeight: '700' },
    bellBadge: {
      position: 'absolute', top: -2, right: -2,
      minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
      backgroundColor: colors.roxy,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: colors.background,
    },
    bellBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
    sisterCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    sisterEmoji: { fontSize: 26 },
    sisterSub: { color: colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 17 },

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
              onPress={() => router.push('/(tabs)/grow/notifications' as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}
              accessibilityLabel="Notifications"
            >
              <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
              {unreadNotifs > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>{unreadNotifs > 9 ? '9+' : unreadNotifs}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Category pills — Events, Games, live rooms and Build reach Home
            from here rather than from a navigation slot (Netflix's pattern). */}
        <HomeCategoryPills />

        {/* Greeting */}
        <View style={styles.greet}>
          <Text style={styles.greetTitle}>
            {greetingWord()},{'\n'}
            <Text style={styles.greetName}>{firstName} </Text>🌸
          </Text>
          <Text style={styles.greetSub}>
            {streak !== null && streak > 0 && (
              <Text style={styles.greetStreak}>🔥 {streak}-day streak · </Text>
            )}
            {buzzingCount > 0
              ? `${buzzingCount} ${buzzingCount === 1 ? 'community is' : 'communities are'} buzzing today`
              : 'Your communities are quiet — start something 💜'}
          </Text>
        </View>

        {/* Zone 1 — Roxy Hero (flat section, de-carded per roxy-home-v1 peg) */}
        <View style={styles.roxyHero}>
          <View style={styles.rhRow}>
            <LinearGradient
              colors={['#FF6A2E', '#FF2F71', '#E81C8E']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.rhAvRing}
            >
              <Ionicons name="sparkles" size={22} color={BRAND_INK} />
            </LinearGradient>
            <View style={styles.rhBubble}>
              {greetingLoading ? (
                <ActivityIndicator color={colors.roxy} style={{ alignSelf: 'flex-start' }} />
              ) : (
                <Text style={styles.rhMsg}>{greeting ?? 'Hey — Roxy here. 👋'}</Text>
              )}
            </View>
          </View>
          <View style={styles.rhActions}>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/grow/roxy-chat' as any)}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#FF6A2E', '#FF2F71', '#E81C8E']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.rhBtn}
              >
                <Text style={styles.rhBtnText}>✦ Ask Roxy</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.rhBtnGhost}
              onPress={() => router.push('/(tabs)/grow/roxy-chat' as any)}
              activeOpacity={0.8}
              accessibilityLabel="Voice message"
            >
              <Ionicons name="mic" size={17} color={colors.roxy} />
            </TouchableOpacity>
          </View>
        </View>

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

        {socialError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>Could not load communities. Pull to refresh.</Text>
          </View>
        )}

        {/* Zone 2 — My Communities */}
        <View>
          <SectionHeader
            title="My Communities"
            icon="people"
            inset={false}
            linkLabel="See all"
            onLinkPress={() => router.push({ pathname: '/(tabs)/connect', params: { tab: 'communities' } } as any)}
          />
          {communities.length === 0 ? (
            <TouchableOpacity
              style={styles.section}
              onPress={() => router.push({ pathname: '/(tabs)/connect', params: { tab: 'communities' } } as any)}
              activeOpacity={0.75}
            >
              <Text style={styles.emptyState}>Find your communities →</Text>
            </TouchableOpacity>
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
                const chipColor = CHIP_COLORS[idx % CHIP_COLORS.length];
                return (
                  <TouchableOpacity
                    key={row.community_id}
                    style={styles.cchip}
                    onPress={() => router.push(`/community/${row.community_id}` as any)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.cchipAva, { backgroundColor: chipColor }]}>
                      <Text style={[styles.cchipAvaText, { color: inkOn(chipColor) }]}>
                        {name[0]?.toUpperCase() ?? '🌸'}
                      </Text>
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
                onPress={() => router.push({ pathname: '/(tabs)/connect', params: { tab: 'communities' } } as any)}
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
            <Text style={styles.emptyState}>Add friends from your communities →</Text>
          ) : (
            <View style={styles.avatarRow}>
              {sortByPresence(friends).slice(0, 5).map((f) => (
                <View key={f.id} style={styles.avatarWrap}>
                  <LinearGradient colors={avatarGradient(f.profile.display_name)} style={styles.avatar}>
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

        {/* Sister — quiet support space */}
        <TouchableOpacity
          style={[styles.section, styles.sisterCard]}
          onPress={() => router.push('/sister-button' as any)}
          activeOpacity={0.8}
        >
          <LinearGradient colors={['#8E7CF7', '#C86DD7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rowPlate}>
            <Ionicons name="moon" size={20} color={BRAND_INK} />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Need to talk?</Text>
            <Text style={styles.sisterSub}>Sister is here for the heavy days — private, gentle, judgement-free.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Support Roxy — donations, never "subscribe" */}
        <TouchableOpacity
          style={[styles.section, styles.sisterCard]}
          onPress={() => setShowDonateModal(true)}
          activeOpacity={0.8}
          testID="support-roxy-card"
          accessibilityLabel="Support Roxy"
        >
          <LinearGradient colors={['#FF6A2E', '#FF2F71', '#E81C8E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rowPlate}>
            <Ionicons name="heart" size={20} color={BRAND_INK} />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Support Roxy</Text>
            <Text style={styles.sisterSub}>Help keep this space ours — from $5/month</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Zone 4 — My Journey */}
        <TouchableOpacity style={styles.section} activeOpacity={0.75}>
          <View style={styles.journeyHeader}>
            <Text style={styles.rowTitle}>My Journey</Text>
            <View style={styles.pointsChip}>
              <Ionicons name="star" size={11} color={colors.roxy} />
              <Text style={styles.pointsChipText}>{points} pts</Text>
            </View>
          </View>
          <View style={styles.levelRow}>
            <LinearGradient colors={['#FF6A2E', '#E81C8E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rowPlate}>
              <Ionicons name={level.icon} size={20} color={BRAND_INK} />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.levelLabel}>{level.label}</Text>
              {level.nextThreshold !== null ? (
                <Text style={styles.progressHint}>{level.nextThreshold - points} points to next level</Text>
              ) : (
                <Text style={styles.progressHint}>Highest level reached</Text>
              )}
            </View>
          </View>
          <View style={styles.progressTrack}>
            <LinearGradient
              colors={['#FF6A2E', '#FF2F71', '#E81C8E']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${Math.max(level.progress * 100, 3)}%` as any }]}
            />
          </View>
        </TouchableOpacity>

        {/* Zone 5 — Badges preview */}
        <TouchableOpacity
          style={styles.section}
          onPress={() => router.push('/(tabs)/grow/badges' as any)}
          activeOpacity={0.75}
        >
          <View style={styles.badgeHeader}>
            <LinearGradient colors={['#F7B42C', '#FC575E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rowPlate}>
              <Ionicons name="trophy" size={20} color={BRAND_INK} />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Badges</Text>
              {badges.length === 0 ? (
                <Text style={styles.sisterSub}>Complete actions to earn your first badge</Text>
              ) : (
                <Text style={styles.sisterSub}>{earnedCount} earned · {inProgressCount} in progress</Text>
              )}
            </View>
            {badges.length > 0 && (
              <View style={styles.badgePreviewRow}>
                {badges.slice(0, 3).map((b) => (
                  <View
                    key={b.badge_id}
                    style={[styles.badgeCoin, b.earned_at === null && styles.badgePreviewDim]}
                  >
                    <Text style={styles.badgePreviewEmoji}>{b.badges?.emoji ?? '★'}</Text>
                  </View>
                ))}
              </View>
            )}
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
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

      <DonateModal visible={showDonateModal} onClose={() => setShowDonateModal(false)} />
    </SafeAreaView>
  );
}
