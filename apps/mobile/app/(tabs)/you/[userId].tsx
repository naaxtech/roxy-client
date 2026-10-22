import { useCallback, useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { TouchableOpacity } from '../../../components/ui/PressableScale';
import * as Linking from 'expo-linking';
import { compactCount, fetchFollowCounts, type FollowCounts } from '../../../lib/followCounts';
import { ProfileExtras } from '../../../components/profile/ProfileExtras';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { ProfileShell } from '../../../components/profile/ProfileShell';
import {
  badgePreviewFromEarned,
  type PopulatedTabs, type ProfileTab, type ProfileVariant,
} from '../../../components/profile/profileVariant';
import { ProfilePostsGrid } from '../../../components/profile/ProfilePostsGrid';
import { ProfileThoughts } from '../../../components/profile/ProfileThoughts';
import { ReelsFeed } from '../../../components/feed/ReelsFeed';
import { type EarnedBadge } from '../../../components/profile/BadgeRow';
import { EventModeBadge, type EventMode } from '../../../components/events/EventModeBadge';
import { EventsCalendar } from '../../../components/events/EventsCalendar';
import { deriveSellerStatus, canSell, type SellerBusinessRow } from '../../../lib/sellerStatus';
import { logError } from '../../../lib/errorLogger';
import { fetchOnlineIds, presenceStamp } from '../../../lib/memberPresence';
import { PUBLIC_PROFILE_FIELDS } from '../../../lib/publicProfile';
import { useAuthStore } from '../../../store/authStore';
import { useFriendStore } from '../../../store/friendStore';
import { useFollowStore } from '../../../store/followStore';
import { useCommunityStore } from '../../../store/communityStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { TYPE } from '../../../lib/typography';
import { RADII, inkOn } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { confirmAction, showAlert } from '../../../lib/confirm';
import { openDirectChat } from '../../../lib/directMessages';
import { useSafetyStore } from '../../../store/safetyStore';
import { Sheet } from '../../../components/feedback';
import { Snackbar } from '../../../components/ui/Snackbar';
import type { CommunityRoom, Event, Profile } from '../../../types';
import { FeatureGate } from '../../../components/features/FeatureGate';
import { isOfficialAccount } from '../../../lib/officialGrant';
import { hostedTabFlags } from '../../../lib/profileHosted';
import { officialPresenceLine, type PresenceMember } from '../../../lib/officialPresence';
import { isPlayableGameUrl } from '../../../lib/gameUrl';
import {
  profileSocialActions,
  type SocialButton,
} from '../../../lib/profileSocialActions';

type FriendshipState = 'none' | 'sent' | 'received' | 'friends';
type SellerRow = SellerBusinessRow & { id: string; name: string };
type HostedEvent = Pick<Event, 'id' | 'title' | 'starts_at' | 'event_type' | 'location_text' | 'status'>;
type HostedGame = {
  id: string;
  name: string;
  short_description: string | null;
  category: string | null;
  url: string | null;
  publisher_type: string | null;
};

/**
 * Another woman's profile, on the unified shell.
 *
 * This screen used to draw `ProfileCard`, which carried its own header and a
 * `photos | about | badges` strip. Three things had to be true before the swap
 * was safe, and they are each a test in
 * `__tests__/screens/UserProfileShell.test.tsx`:
 *
 *  - **Badges survive.** The shell's tab set has no `badges`, and that is
 *    correct — the prototype puts badges in the header as a chip, not as a tab.
 *    The earned strip rides in `beforeTabs` instead of disappearing.
 *  - **`about` was already redundant.** Its whole content for a non-own profile
 *    was the bio and the level, and the shell's header renders both. A tab that
 *    repeats the header is the "empty tab" problem wearing a different hat.
 *  - **`posts` is counted, not assumed.** Only the route can tell an empty
 *    profile from an unfetched one, which is exactly why `populated` is a prop.
 *
 * Events, rooms and games are `false` here rather than queried: this screen has
 * never shown them, so leaving them out loses nothing, and turning them on
 * without a renderer would draw a tab over nothing. They are the next slice.
 */
function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  // Selectors, not the whole store: a heartbeat or a refetch elsewhere must
  // not re-render this profile (jank audit #9).
  const friends = useFriendStore((s) => s.friends);
  const pendingReceived = useFriendStore((s) => s.pendingReceived);
  const pendingSent = useFriendStore((s) => s.pendingSent);
  const sendRequest = useFriendStore((s) => s.sendRequest);
  const acceptRequest = useFriendStore((s) => s.acceptRequest);
  const fetchFriends = useFriendStore((s) => s.fetchAll);
  const followingIds = useFollowStore((s) => s.followingIds);
  const hydrateFollows = useFollowStore((s) => s.hydrate);
  const follow = useFollowStore((s) => s.follow);
  const unfollow = useFollowStore((s) => s.unfollow);
  const joinedIds = useCommunityStore((s) => s.joinedIds);
  const hydrateCommunities = useCommunityStore((s) => s.hydrate);
  const joinCommunity = useCommunityStore((s) => s.joinCommunity);
  const openReportModal = useSafetyStore((s) => s.openReportModal);
  const blockUser = useSafetyStore((s) => s.blockUser);
  const mutedUserIds = useSafetyStore((s) => s.mutedUserIds) ?? [];
  const muteUser = useSafetyStore((s) => s.muteUser);
  const unmuteUser = useSafetyStore((s) => s.unmuteUser);
  const colors = useThemeColors();
  const [counts, setCounts] = useState<FollowCounts | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [seller, setSeller] = useState<SellerRow[]>([]);
  const [events, setEvents] = useState<HostedEvent[]>([]);
  const [rooms, setRooms] = useState<CommunityRoom[]>([]);
  const [games, setGames] = useState<HostedGame[]>([]);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMember[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notFound, setNotFound] = useState(false);
  const [reelsOpen, setReelsOpen] = useState(false);
  const [reelInitialId, setReelInitialId] = useState<string | null>(null);
  const [eventsView, setEventsView] = useState<'list' | 'calendar'>('list');
  // F10: every button here flips at once (the stores are optimistic). When the
  // server refuses, the store has already rolled the button back; this says
  // so in one sentence and offers Retry, without blocking the screen.
  const [actionFailure, setActionFailure] = useState<{ message: string; retry: () => void } | null>(null);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!userId) return;
    if (!opts?.quiet) setStatus('loading');
    setNotFound(false);
    void fetchFollowCounts(userId).then(setCounts);

    // The post count went with the stat card. Its HEAD query went too — a round
    // trip on every profile open, for a number nothing renders.
    const [profileRes, badgesRes, sellerRes] = await Promise.all([
      // Public columns only (130 / PRO-01). Her location, last-seen time,
      // Stripe id, shipping address and vetting status are not another
      // member's to read; RLS also hides anyone who is not an approved member.
      supabase.from('profiles').select(PUBLIC_PROFILE_FIELDS).eq('id', userId).single(),
      supabase.from('user_badge_progress').select('*, badges(*)').eq('user_id', userId),
      supabase
        .from('businesses')
        .select('id, name, is_verified, can_sell, stripe_account_id')
        .eq('owner_id', userId),
    ]);

    if (profileRes.error || !profileRes.data) {
      if (profileRes.error) logError(profileRes.error, 'userProfile_fetch');
      // Only "no such row" is not-found (PGRST116 from .single(); RLS also
      // answers it for a blocked or ghost profile). Offline or a 5xx is an
      // error with a retry — it used to say "Profile not found" with no way
      // back (PRO-08).
      const code = (profileRes.error as { code?: string } | null)?.code;
      if (!profileRes.error || code === 'PGRST116') {
        setNotFound(true);
        setStatus('ready');
      } else {
        setStatus('error');
      }
      return;
    }
    // The select list is built from PUBLIC_PROFILE_COLUMNS, so supabase-js
    // cannot infer the row shape from a string literal. The private fields
    // Profile declares are simply absent here, and this screen reads none.
    setProfile(profileRes.data as unknown as Profile);

    // Every one of these returns `{ data, error }` without throwing, so each
    // needs its own voice. An empty badge strip used to be indistinguishable
    // from "she has no badges", which is most of why the RLS bug this screen
    // was built on top of went unnoticed for so long.
    if (badgesRes.error) logError(badgesRes.error, 'userProfile_fetchBadges');
    else setBadges((badgesRes.data ?? []) as EarnedBadge[]);

    if (sellerRes.error) logError(sellerRes.error, 'userProfile_fetchSeller');
    else setSeller((sellerRes.data ?? []) as SellerRow[]);

    const loaded = profileRes.data as unknown as Profile;
    const officialId = loaded.official_community_id ?? null;
    const now = new Date().toISOString();
    const [eventsRes, roomsRes, gamesRes, communityRes, membersRes] = await Promise.all([
      supabase
        .from('events')
        .select('id, title, starts_at, event_type, location_text, status')
        .eq('host_id', userId)
        .eq('status', 'active')
        .gte('starts_at', now)
        .order('starts_at'),
      officialId
        ? supabase
          .from('community_rooms')
          .select('*')
          .eq('community_id', officialId)
          .neq('status', 'closed')
          .eq('is_active', true)
          .order('name')
        : Promise.resolve({ data: [] as CommunityRoom[], error: null }),
      officialId
        ? supabase
          .from('community_games')
          .select('games(id, name, short_description, category, url, publisher_type)')
          .eq('community_id', officialId)
        : Promise.resolve({ data: [] as { games: HostedGame | null }[], error: null }),
      officialId
        ? supabase
          .from('communities')
          .select('cover_image_url')
          .eq('id', officialId)
          .single()
        : Promise.resolve({ data: null as { cover_image_url: string | null } | null, error: null }),
      officialId
        ? supabase
          .from('community_members')
          .select('user_id, profiles(display_name, avatar_url)')
          .eq('community_id', officialId)
          .limit(40)
        : Promise.resolve({ data: [] as { profiles: PresenceMember | PresenceMember[] | null }[], error: null }),
    ]);

    if (eventsRes.error) logError(eventsRes.error, 'userProfile_fetchEvents');
    else setEvents((eventsRes.data ?? []) as HostedEvent[]);

    if (roomsRes.error) logError(roomsRes.error, 'userProfile_fetchRooms');
    else setRooms((roomsRes.data ?? []) as CommunityRoom[]);

    if (gamesRes.error) logError(gamesRes.error, 'userProfile_fetchGames');
    else {
      setGames(
        ((gamesRes.data ?? []) as { games: HostedGame | null }[])
          .map((row) => row.games)
          .filter((g): g is HostedGame => !!g),
      );
    }

    if (communityRes.error) logError(communityRes.error, 'userProfile_fetchCover');
    else setCoverUrl(communityRes.data?.cover_image_url ?? null);

    if (membersRes.error) logError(membersRes.error, 'userProfile_fetchMembers');
    else {
      type MemberRow = {
        user_id: string;
        profiles: { display_name: string | null; avatar_url: string | null }
          | { display_name: string | null; avatar_url: string | null }[] | null;
      };
      const rows = (membersRes.data ?? []) as MemberRow[];
      // "Online now" comes from member_presence(): a yes/no, never her
      // last-seen time (130 / PRO-01).
      const online = await fetchOnlineIds(rows.map((r) => r.user_id));
      setPresence(
        rows
          .map((row) => {
            const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
            return p
              ? { display_name: p.display_name, last_seen_at: presenceStamp(online.has(row.user_id)) }
              : null;
          })
          .filter((p): p is PresenceMember => !!p),
      );
    }

    setStatus('ready');
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load({ quiet: true }); } finally { setRefreshing(false); }
  }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    void hydrateFollows(user.id);
    void hydrateCommunities(user.id);
    // The Add friend / Requested / Accept / Message button is derived from this
    // store. Without loading it here the screen showed "Add friend" to existing
    // friends and never showed "Accept" for a request waiting on her.
    void fetchFriends(user.id).catch((e: unknown) => logError(e, 'userProfile_fetchFriends'));
  }, [user?.id, hydrateFollows, hydrateCommunities, fetchFriends]);

  const friendshipState: FriendshipState = (() => {
    if (!userId) return 'none';
    if (friends.some((f) => f.profile.id === userId)) return 'friends';
    if (pendingSent.some((f) => f.profile.id === userId)) return 'sent';
    if (pendingReceived.some((f) => f.profile.id === userId)) return 'received';
    return 'none';
  })();

  const handleAddFriend = async () => {
    if (!userId) return;
    setActionFailure(null);
    try {
      await sendRequest(userId, {
        display_name: profile?.display_name ?? '',
        username: profile?.username ?? '',
        avatar_url: profile?.avatar_url ?? null,
      });
    } catch (e) {
      logError(e, 'userProfile_addFriend');
      setActionFailure({
        message: e instanceof Error && /signed in/i.test(e.message) ? e.message : 'Could not send that request.',
        retry: () => { void handleAddFriend(); },
      });
    }
  };

  const handleAcceptFriend = async () => {
    const row = pendingReceived.find((f) => f.profile.id === userId);
    if (!row) return;
    setActionFailure(null);
    try { await acceptRequest(row.id); }
    catch (e) {
      logError(e, 'userProfile_acceptFriend');
      setActionFailure({ message: 'Could not accept that request.', retry: () => { void handleAcceptFriend(); } });
    }
  };

  const handleMessage = async () => {
    if (!user || !userId) return;
    // start_direct (migration 132) finds or opens the thread server-side. The
    // direct SELECT + INSERT it replaces opened a stranger's thread straight
    // into her inbox instead of her Requests (CHAT-02).
    try {
      const convId = await openDirectChat(user.id, userId);
      router.push(`/chat/${convId}` as never);
    } catch (e) {
      showAlert('Could not open chat', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    notFound: { ...TYPE.body, color: colors.textMuted, textAlign: 'center', marginTop: 60 },
    reelsBar: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 12, paddingVertical: 8,
      backgroundColor: colors.background,
    },
    reelsTitle: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700', flex: 1 },
  });

  if (notFound) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.notFound} testID="profile-not-found">Profile not found</Text>
      </SafeAreaView>
    );
  }

  const sellerStatus = deriveSellerStatus(seller);
  const approved = canSell(sellerStatus);
  const variant: ProfileVariant = approved ? 'seller' : 'user';
  const shop = seller.find((s) => s.is_verified === true && s.can_sell === true && !!s.stripe_account_id);

  const hosted = hostedTabFlags({
    events: events.length,
    rooms: rooms.length,
    games: games.length,
  });
  const populated: PopulatedTabs = {
    posts: true,
    thoughts: true,
    shop: approved,
    events: hosted.events,
    rooms: hosted.rooms,
    games: hosted.games,
    about: false,
    saved: false,
  };

  const official = isOfficialAccount(profile);
  const officialCommunityId = profile?.official_community_id ?? null;
  const following = !!(userId && followingIds.has(userId));
  const joined = !!(officialCommunityId && joinedIds.has(officialCommunityId));
  const social = profileSocialActions({ official, following, joined, friendship: friendshipState });

  const bindSocial = (button: SocialButton) => {
    const run = async () => {
      if (!userId || !user?.id) return;
      // The store rolls the button back on failure; this says why, instead
      // of the button silently flipping back (PRO-07).
      setActionFailure(null);
      if (button.role === 'follow') {
        const ok = await follow(user.id, userId);
        if (!ok) setActionFailure({ message: 'Could not follow her.', retry: () => { void run(); } });
        else setCounts((c) => (c ? { ...c, followers: c.followers + 1 } : c));
        return;
      }
      if (button.role === 'unfollow') {
        const ok = await unfollow(user.id, userId);
        if (!ok) setActionFailure({ message: 'Could not unfollow her.', retry: () => { void run(); } });
        else setCounts((c) => (c ? { ...c, followers: Math.max(0, c.followers - 1) } : c));
        return;
      }
      if (button.role === 'join' && officialCommunityId) {
        try { await joinCommunity(officialCommunityId, user.id); }
        catch (e) {
          logError(e, 'userProfile_join');
          setActionFailure({ message: 'Could not join that community.', retry: () => { void run(); } });
        }
        return;
      }
      if (button.role === 'channels' && officialCommunityId) {
        router.push(`/community/channels/${officialCommunityId}` as never);
        return;
      }
      if (button.role === 'message') {
        await handleMessage();
        return;
      }
      if (button.role === 'add-friend') {
        await handleAddFriend();
        return;
      }
      if (button.role === 'accept') {
        await handleAcceptFriend();
      }
    };
    return {
      label: button.label,
      testID: button.testID,
      onPress: button.pressable ? () => { void run(); } : undefined,
    };
  };

  const primaryAction = bindSocial(social.primary);
  const secondaryAction = social.secondary ? bindSocial(social.secondary) : undefined;
  const tertiaryAction = social.tertiary ? bindSocial(social.tertiary) : (
    !official && approved && shop
      ? { label: 'Shop', onPress: () => router.push(`/business/${shop.id}` as never) }
      : undefined
  );

  const rowStyles = hostedStyles(colors);
  const online = official ? officialPresenceLine(presence, Date.now()) : null;
  const isMuted = !!userId && mutedUserIds.includes(userId);
  const stats = counts ? [
    { value: compactCount(counts.followers), label: counts.followers === 1 ? 'Follower' : 'Followers' },
    { value: compactCount(counts.following), label: 'Following' },
  ] : [];

  const shareProfile = async () => {
    if (!userId) return;
    const url = Linking.createURL(`/user/${userId}`);
    const name = profile?.display_name ?? 'her';
    try {
      await Share.share({ message: `${name} on Roxy: ${url}`, url });
    } catch (e) {
      logError(e, 'userProfile_share');
    }
  };

  const toggleMute = async () => {
    if (!userId) return;
    setSafetyOpen(false);
    try {
      if (isMuted) {
        const ok = await unmuteUser(userId);
        if (!ok) throw new Error('unmute-noop');
        showAlert('Unmuted', 'Her posts and comments will show again.');
      } else {
        await muteUser(userId);
        showAlert('Muted', 'You won’t see her posts or comments. She is not told. Undo any time in Settings → Blocked & muted.');
      }
    } catch (e) {
      logError(e, 'userProfile_mute');
      showAlert('Not saved', isMuted ? 'She is still muted. Try again in a moment.' : 'She was not muted. Check your connection and try again.');
    }
  };

  const renderTab = (tab: ProfileTab) => {
    if (tab === 'shop' && shop) {
      return (
        <TouchableOpacity
          style={rowStyles.row}
          onPress={() => router.push(`/business/${shop.id}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${shop.name}`}
        >
          <Text style={rowStyles.title}>Open shop</Text>
        </TouchableOpacity>
      );
    }
    if (tab === 'posts' && userId) return (
      <ProfilePostsGrid
        userId={userId}
        onVideoPress={(postId) => { setReelInitialId(postId); setReelsOpen(true); }}
      />
    );
    if (tab === 'thoughts' && userId) return <ProfileThoughts userId={userId} />;
    if (tab === 'events') {
      return (
        <View style={rowStyles.list}>
          <View style={rowStyles.viewToggleRow}>
            {(['list', 'calendar'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                style={[rowStyles.viewToggleBtn, eventsView === v && rowStyles.viewToggleBtnActive]}
                onPress={() => setEventsView(v)}
                accessibilityRole="button"
                accessibilityLabel={v === 'list' ? 'List view' : 'Calendar view'}
              >
                <Ionicons
                  name={v === 'list' ? 'list' : 'calendar'}
                  size={16}
                  color={eventsView === v ? inkOn(colors.roxy) : colors.textMuted}
                />
              </TouchableOpacity>
            ))}
          </View>
          {eventsView === 'calendar' ? (
            <EventsCalendar
              events={events.map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, subtitle: e.location_text }))}
              onEventPress={(eventId) => router.push(`/event/${eventId}` as never)}
            />
          ) : events.map((event) => (
            <TouchableOpacity
              key={event.id}
              style={rowStyles.row}
              onPress={() => router.push(`/event/${event.id}` as never)}
              accessibilityRole="button"
              accessibilityLabel={`Open event ${event.title}`}
              testID={`profile-event-${event.id}`}
            >
              <View style={rowStyles.copy}>
                <Text style={rowStyles.title} numberOfLines={1}>{event.title}</Text>
                <Text style={rowStyles.meta} numberOfLines={1}>
                  {[event.location_text, new Date(event.starts_at).toLocaleDateString()].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <EventModeBadge mode={event.event_type as EventMode} />
            </TouchableOpacity>
          ))}
        </View>
      );
    }
    if (tab === 'rooms') {
      return (
        <View style={rowStyles.list}>
          {rooms.map((room) => (
            <TouchableOpacity
              key={room.id}
              style={rowStyles.row}
              onPress={() => router.push(`/community-room-session?room_id=${room.id}` as never)}
              accessibilityRole="button"
              accessibilityLabel={`Open room ${room.name}`}
              testID={`profile-room-${room.id}`}
            >
              <View style={rowStyles.copy}>
                <Text style={rowStyles.title} numberOfLines={1}>{room.name}</Text>
                <Text style={rowStyles.meta} numberOfLines={1}>
                  {room.status === 'live' ? 'Live now' : room.room_type === 'video' ? 'Video room' : 'Audio room'}
                </Text>
              </View>
              <Text style={rowStyles.pill}>{room.status === 'live' ? 'LIVE' : 'OPEN'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      );
    }
    if (tab === 'games') {
      return (
        <View style={rowStyles.list}>
          {games.map((game) => {
            const canPlay = game.name === 'Speed Dating' || isPlayableGameUrl(game.url);
            return (
              <TouchableOpacity
                key={game.id}
                style={rowStyles.row}
                onPress={() => {
                  if (game.name === 'Speed Dating') { router.push('/speed-dating' as never); return; }
                  if (canPlay) router.push(`/(tabs)/discover/games/${game.id}` as never);
                }}
                disabled={!canPlay}
                accessibilityRole="button"
                accessibilityLabel={`Play ${game.name}`}
                testID={`profile-game-${game.id}`}
              >
                <View style={rowStyles.copy}>
                  <Text style={rowStyles.title} numberOfLines={1}>{game.name}</Text>
                  {game.short_description ? (
                    <Text style={rowStyles.meta} numberOfLines={1}>{game.short_description}</Text>
                  ) : null}
                </View>
                {canPlay ? <Text style={rowStyles.play}>Play</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }
    return null;
  };

  if (reelsOpen && userId) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.reelsBar}>
          <TouchableOpacity
            onPress={() => setReelsOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close reels"
            hitSlop={6}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.reelsTitle}>Reels</Text>
        </View>
        {/* She opened this profile on purpose: a mute keeps someone out of her
            feeds, not out of the profile she went looking for. */}
        <ReelsFeed
          scope="following"
          authorIds={[userId]}
          initialPostId={reelInitialId}
          showMutedAuthors
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileShell
        variant={variant}
        name={profile?.display_name ?? '…'}
        subtitle={profile?.username ? `@${profile.username}` : null}
        bio={profile?.bio ?? null}
        pronouns={profile?.pronouns ?? []}
        identityLabels={profile?.identity_labels ?? []}
        interests={profile?.interests ?? []}
        customTags={profile?.custom_tags ?? []}
        statusLabels={profile?.dating_looking_for ?? []}
        avatarUrl={profile?.avatar_url ?? null}
        coverUrl={coverUrl}
        points={profile?.gamification_points ?? null}
        sellerApproved={approved}
        official={official}
        live={rooms.some((r) => r.status === 'live')}
        onBack={() => router.back()}
        headerActions={userId ? [{
          icon: 'ellipsis-horizontal',
          label: 'More',
          testID: 'profile-more',
          onPress: () => setSafetyOpen(true),
        }] : []}
        stats={stats}
        refreshing={refreshing}
        onRefresh={() => { void onRefresh(); }}
        beforeTabs={userId ? (
          <View>
            {counts?.followsYou ? (
              <View style={rowStyles.followsYou} testID="profile-follows-you" accessibilityRole="text">
                <Text style={rowStyles.followsYouText}>Follows you</Text>
              </View>
            ) : null}
            <ProfileExtras userId={userId} onOpenEntry={(slug) => router.push(`/archive/${slug}` as never)} />
            {online ? (
              <View style={rowStyles.online} testID="profile-online-row">
                <Text style={rowStyles.onlineText}>{online.label}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
        tertiaryAction={tertiaryAction}
        badgePreview={(() => {
          const preview = badgePreviewFromEarned(badges);
          if (!preview) return null;
          return { ...preview, onPress: () => undefined };
        })()}
        populated={populated}
        renderTab={renderTab}
        status={status}
        errorMessage="This profile did not load. Check your connection."
        onRetry={() => void load()}
      />

      {/* F5: the shared Sheet (spring rise, drag, only the scrim fades). */}
      <Sheet visible={safetyOpen} onClose={() => setSafetyOpen(false)} accessibilityLabel={profile?.display_name ?? 'This profile'} dragFrom="sheet" testID="profile-more-sheet" style={rowStyles.sheet}>
            <Text style={rowStyles.sheetTitle}>{profile?.display_name ?? 'This profile'}</Text>
            <TouchableOpacity
              style={rowStyles.sheetRow}
              onPress={() => {
                if (!userId) return;
                setSafetyOpen(false);
                openReportModal({ userId, contentType: 'profile' });
              }}
              accessibilityRole="button"
              accessibilityLabel="Report this profile"
              testID="profile-more-report"
            >
              <Text style={rowStyles.sheetLabel}>Report</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={rowStyles.sheetRow}
              onPress={() => { void toggleMute(); }}
              accessibilityRole="button"
              accessibilityLabel={isMuted ? 'Unmute this account' : 'Mute this account'}
              testID="profile-more-mute"
            >
              <Text style={rowStyles.sheetLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={rowStyles.sheetRow}
              onPress={() => { setSafetyOpen(false); void shareProfile(); }}
              accessibilityRole="button"
              accessibilityLabel="Share this profile"
              testID="profile-more-share"
            >
              <Text style={rowStyles.sheetLabel}>Share profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={rowStyles.sheetRow}
              onPress={() => {
                void (async () => {
                  if (!userId) return;
                  setSafetyOpen(false);
                  const ok = await confirmAction(
                    'Block this account?',
                    'You will not see her posts, and she will not see yours.',
                    'Block',
                  );
                  if (!ok) return;
                  try { await blockUser(userId); router.back(); }
                  catch (e) {
                    logError(e, 'userProfile_block');
                    showAlert('Error', 'Could not block that account.');
                  }
                })();
              }}
              accessibilityRole="button"
              accessibilityLabel="Block this account"
              testID="profile-more-block"
            >
              <Text style={rowStyles.sheetDanger}>Block</Text>
            </TouchableOpacity>
      </Sheet>

      <Snackbar
        visible={actionFailure !== null}
        message={actionFailure?.message ?? ''}
        actionLabel="Retry"
        onAction={() => actionFailure?.retry()}
        onDismiss={() => setActionFailure(null)}
        testID="profile-action-snackbar"
      />
    </SafeAreaView>
  );
}

function hostedStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    followsYou: {
      alignSelf: 'flex-start', marginHorizontal: 16, marginBottom: 8,
      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.secondary,
    },
    followsYouText: { ...TYPE.caption, color: colors.secondaryInk, fontWeight: '700' },
    list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: MIN_TOUCH_TARGET + 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: RADII.md,
    },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    title: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
    meta: { ...TYPE.caption, color: colors.textMuted, fontWeight: '600' },
    pill: {
      ...TYPE.micro, color: colors.primary, fontWeight: '800', letterSpacing: 0.8,
    },
    play: {
      ...TYPE.caption, color: '#FFFFFF', fontWeight: '800',
      backgroundColor: colors.primary, overflow: 'hidden',
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADII.pill,
    },
    viewToggleRow: {
      flexDirection: 'row', gap: 6, justifyContent: 'flex-end',
      marginBottom: 6,
    },
    viewToggleBtn: {
      width: 34, height: 30, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    viewToggleBtnActive: { backgroundColor: colors.roxy },
    online: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: MIN_TOUCH_TARGET,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: RADII.md,
    },
    onlineText: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '600', flex: 1 },
    sheet: { backgroundColor: colors.background, paddingHorizontal: 20, paddingBottom: 16, gap: 4 },
    sheetTitle: { ...TYPE.title, color: colors.textPrimary, marginBottom: 8 },
    sheetRow: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    sheetLabel: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
    sheetDanger: { ...TYPE.body, color: colors.error, fontWeight: '700' },
  });
}

export default function UserProfileRoute() {
  return (
    <FeatureGate feature="feed">
      <UserProfileScreen />
    </FeatureGate>
  );
}
