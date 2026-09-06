import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { ProfileShell } from '../../../components/profile/ProfileShell';
import {
  badgePreviewFromEarned,
  type PopulatedTabs, type ProfileTab, type ProfileVariant,
} from '../../../components/profile/profileVariant';
import { ProfilePhotoGrid } from '../../../components/profile/ProfilePhotoGrid';
import { type EarnedBadge } from '../../../components/profile/BadgeRow';
import { EventModeBadge, type EventMode } from '../../../components/events/EventModeBadge';
import { deriveSellerStatus, canSell, type SellerBusinessRow } from '../../../lib/sellerStatus';
import { logError } from '../../../lib/errorLogger';
import { useAuthStore } from '../../../store/authStore';
import { useFriendStore } from '../../../store/friendStore';
import { useFollowStore } from '../../../store/followStore';
import { useCommunityStore } from '../../../store/communityStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { TYPE } from '../../../lib/typography';
import { RADII } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { confirmAction, showAlert } from '../../../lib/confirm';
import { useSafetyStore } from '../../../store/safetyStore';
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

/** Post types that put something in the photo grid. */
const MEDIA_POST_TYPES = ['photo', 'video'];

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
  const { friends, pendingReceived, pendingSent, sendRequest, acceptRequest } = useFriendStore();
  const followingIds = useFollowStore((s) => s.followingIds);
  const hydrateFollows = useFollowStore((s) => s.hydrate);
  const follow = useFollowStore((s) => s.follow);
  const unfollow = useFollowStore((s) => s.unfollow);
  const joinedIds = useCommunityStore((s) => s.joinedIds);
  const hydrateCommunities = useCommunityStore((s) => s.hydrate);
  const joinCommunity = useCommunityStore((s) => s.joinCommunity);
  const openReportModal = useSafetyStore((s) => s.openReportModal);
  const blockUser = useSafetyStore((s) => s.blockUser);
  const colors = useThemeColors();
  const [safetyOpen, setSafetyOpen] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [postCount, setPostCount] = useState(0);
  const [seller, setSeller] = useState<SellerRow[]>([]);
  const [events, setEvents] = useState<HostedEvent[]>([]);
  const [rooms, setRooms] = useState<CommunityRoom[]>([]);
  const [games, setGames] = useState<HostedGame[]>([]);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceMember[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setStatus('loading');
    setNotFound(false);

    const [profileRes, badgesRes, postsRes, sellerRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('user_badge_progress').select('*, badges(*)').eq('user_id', userId),
      supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('author_id', userId)
        .in('post_type', MEDIA_POST_TYPES),
      supabase
        .from('businesses')
        .select('id, name, is_verified, can_sell, stripe_account_id')
        .eq('owner_id', userId),
    ]);

    if (profileRes.error || !profileRes.data) {
      if (profileRes.error) logError(profileRes.error, 'userProfile_fetch');
      setNotFound(true);
      setStatus('ready');
      return;
    }
    setProfile(profileRes.data as Profile);

    // Every one of these returns `{ data, error }` without throwing, so each
    // needs its own voice. An empty badge strip used to be indistinguishable
    // from "she has no badges", which is most of why the RLS bug this screen
    // was built on top of went unnoticed for so long.
    if (badgesRes.error) logError(badgesRes.error, 'userProfile_fetchBadges');
    else setBadges((badgesRes.data ?? []) as EarnedBadge[]);

    if (postsRes.error) logError(postsRes.error, 'userProfile_fetchPostCount');
    else setPostCount(postsRes.count ?? 0);

    if (sellerRes.error) logError(sellerRes.error, 'userProfile_fetchSeller');
    else setSeller((sellerRes.data ?? []) as SellerRow[]);

    const loaded = profileRes.data as Profile;
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
          .select('user_id, profiles(display_name, avatar_url, last_seen_at)')
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
      setPresence(
        ((membersRes.data ?? []) as { profiles: PresenceMember | PresenceMember[] | null }[])
          .map((row) => (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles))
          .filter((p): p is PresenceMember => !!p),
      );
    }

    setStatus('ready');
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    void hydrateFollows(user.id);
    void hydrateCommunities(user.id);
  }, [user?.id, hydrateFollows, hydrateCommunities]);

  const friendshipState: FriendshipState = (() => {
    if (!userId) return 'none';
    if (friends.some((f) => f.profile.id === userId)) return 'friends';
    if (pendingSent.some((f) => f.profile.id === userId)) return 'sent';
    if (pendingReceived.some((f) => f.profile.id === userId)) return 'received';
    return 'none';
  })();

  const handleAddFriend = async () => {
    if (!userId) return;
    try { await sendRequest(userId); }
    catch (e) { logError(e, 'userProfile_addFriend'); showAlert('Error', 'Could not send that request.'); }
  };

  const handleAcceptFriend = async () => {
    const row = pendingReceived.find((f) => f.profile.id === userId);
    if (!row) return;
    try { await acceptRequest(row.id); }
    catch (e) { logError(e, 'userProfile_acceptFriend'); showAlert('Error', 'Could not accept that request.'); }
  };

  const handleMessage = async () => {
    if (!user || !userId) return;
    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('conversation_type', 'direct')
      .contains('participant_ids', [user.id, userId])
      .maybeSingle();

    if (existing?.id) { router.push(`/chat/${existing.id}` as never); return; }

    const { data: created, error } = await supabase
      .from('conversations')
      .insert({ participant_ids: [user.id, userId], conversation_type: 'direct' })
      .select('id')
      .single();

    if (error || !created) { showAlert('Error', 'Could not open chat.'); return; }
    router.push(`/chat/${created.id}` as never);
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    notFound: { ...TYPE.body, color: colors.textMuted, textAlign: 'center', marginTop: 60 },
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
      if (button.role === 'follow') {
        await follow(user.id, userId);
        return;
      }
      if (button.role === 'unfollow') {
        await unfollow(user.id, userId);
        return;
      }
      if (button.role === 'join' && officialCommunityId) {
        try { await joinCommunity(officialCommunityId, user.id); }
        catch (e) { logError(e, 'userProfile_join'); showAlert('Error', 'Could not join that community.'); }
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
    if (tab === 'posts' && userId) return <ProfilePhotoGrid userId={userId} />;
    if (tab === 'events') {
      return (
        <View style={rowStyles.list}>
          {events.map((event) => (
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
        beforeTabs={online ? (
          <View style={rowStyles.online} testID="profile-online-row">
            <Text style={rowStyles.onlineText}>{online.label}</Text>
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
        onRetry={() => void load()}
      />

      <Modal
        visible={safetyOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSafetyOpen(false)}
      >
        <Pressable style={rowStyles.scrim} onPress={() => setSafetyOpen(false)}>
          <View style={rowStyles.sheet} testID="profile-more-sheet">
            <Text style={rowStyles.sheetTitle}>Safety</Text>
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
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function hostedStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
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
      ...TYPE.caption, color: colors.primaryInk, fontWeight: '800',
      backgroundColor: colors.primary, overflow: 'hidden',
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADII.pill,
    },
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
    scrim: { flex: 1, backgroundColor: 'rgba(8,3,18,0.5)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: RADII.sheet,
      borderTopRightRadius: RADII.sheet,
      padding: 20,
      paddingBottom: 28,
      gap: 4,
    },
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
