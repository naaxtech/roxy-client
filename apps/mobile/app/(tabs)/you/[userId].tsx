import { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { ProfileShell } from '../../../components/profile/ProfileShell';
import type { PopulatedTabs, ProfileTab, ProfileVariant } from '../../../components/profile/profileVariant';
import { ProfilePhotoGrid } from '../../../components/profile/ProfilePhotoGrid';
import { BadgeRow, type EarnedBadge } from '../../../components/profile/BadgeRow';
import { deriveSellerStatus, canSell, type SellerBusinessRow } from '../../../lib/sellerStatus';
import { logError } from '../../../lib/errorLogger';
import { useAuthStore } from '../../../store/authStore';
import { useFriendStore } from '../../../store/friendStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { TYPE } from '../../../lib/typography';
import { showAlert } from '../../../lib/confirm';
import type { Profile } from '../../../types';
import { FeatureGate } from '../../../components/features/FeatureGate';

type FriendshipState = 'none' | 'sent' | 'received' | 'friends';
type SellerRow = SellerBusinessRow & { id: string; name: string };

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
  const colors = useThemeColors();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [postCount, setPostCount] = useState(0);
  const [seller, setSeller] = useState<SellerRow[]>([]);
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

    setStatus('ready');
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

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
    badges: { paddingHorizontal: 16, paddingBottom: 8 },
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

  const populated: PopulatedTabs = {
    posts: postCount > 0,
    // Her shop is a whole screen of its own; the shell links to it rather than
    // drawing a tab over a renderer this route does not have.
    shop: false,
    events: false,
    rooms: false,
    games: false,
    about: false,
    saved: false,
  };

  const primaryAction =
    friendshipState === 'received'
      ? { label: 'Accept 💜', onPress: handleAcceptFriend }
      : friendshipState === 'sent'
        ? { label: 'Requested' }
        : friendshipState === 'friends'
          ? { label: 'Message', icon: 'chatbubble-outline' as const, onPress: handleMessage }
          : { label: 'Add friend', icon: 'person-add-outline' as const, onPress: handleAddFriend };

  const secondaryAction =
    friendshipState === 'friends' || !approved || !shop
      ? friendshipState === 'friends' ? undefined : { label: 'Message', onPress: handleMessage }
      : { label: 'Shop', onPress: () => router.push(`/business/${shop.id}` as never) };

  const renderTab = (tab: ProfileTab) =>
    tab === 'posts' && userId ? <ProfilePhotoGrid userId={userId} /> : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileShell
        variant={variant}
        name={profile?.display_name ?? '…'}
        subtitle={profile?.username ? `@${profile.username}` : null}
        bio={profile?.bio ?? null}
        pronouns={profile?.pronouns ?? []}
        identityLabels={profile?.identity_labels ?? []}
        avatarUrl={profile?.avatar_url ?? null}
        points={profile?.gamification_points ?? null}
        sellerApproved={approved}
        onBack={() => router.back()}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
        populated={populated}
        renderTab={renderTab}
        status={status}
        onRetry={() => void load()}
        beforeTabs={
          badges.length > 0 ? (
            <View style={styles.badges} testID="profile-badges">
              <BadgeRow badges={badges} />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

export default function UserProfileRoute() {
  return (
    <FeatureGate feature="feed">
      <UserProfileScreen />
    </FeatureGate>
  );
}
