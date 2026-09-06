// apps/mobile/app/(tabs)/you/index.tsx
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useBuildStore } from '../../../store/buildStore';
import { useMarketplaceStore } from '../../../store/marketplaceStore';
import { supabase } from '../../../lib/supabase';
import { ProfileShell } from '../../../components/profile/ProfileShell';
import type { PopulatedTabs, ProfileTab } from '../../../components/profile/profileVariant';
import { ProfilePhotoGrid } from '../../../components/profile/ProfilePhotoGrid';
import { ProfileFavorites } from '../../../components/profile/ProfileFavorites';
import { SavedPosts } from '../../../components/profile/SavedPosts';
import { SavedWatchlist } from '../../../components/profile/SavedWatchlist';
import { type EarnedBadge } from '../../../components/profile/BadgeRow';
import { useArchiveStore } from '../../../store/archiveStore';
import { SelfControls } from '../../../components/profile/SelfControls';
import { YouMoreMenu } from '../../../components/profile/YouMoreMenu';
import { fetchUnreadNotificationCount } from '../../../lib/notifications';
import { MiniWinsSheet } from '../../../components/feed/MiniWinsSheet';
import { logError } from '../../../lib/errorLogger';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { isOfficialAccount } from '../../../lib/officialGrant';
import { RADII } from '../../../lib/theme';
import type { Business, Profile } from '../../../types';
import { useAccess } from '../../../hooks/useAccess';
import { AccountStatusTag } from '../../../components/account/AccountStatusTag';
import { TYPE } from '../../../lib/typography';
import {
  badgePreviewFromEarned,
  profileXpBar,
} from '../../../components/profile/profileVariant';


/** How long a spinner is a reasonable answer before it becomes a dead end. */
const PROFILE_STALL_MS = 8_000;

export default function ProfileScreen() {
  const { user } = useAuthStore();
  const { profile } = useProfileStore();
  const { isBeta, kind } = useAccess();
  const { bookmarkedBusinessIds, loadBookmarks } = useBuildStore();
  const { orders, fetchOrders } = useMarketplaceStore();
  const router = useRouter();
  const colors = useThemeColors();
  // A post-checkout "View My Orders" link arrives with ?orders=1 so the orders
  // list starts expanded instead of collapsed behind its accordion.
  const { orders: ordersParam } = useLocalSearchParams<{ orders?: string }>();

  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [savedBusinesses, setSavedBusinesses] = useState<Business[]>([]);
  const [shellTab, setShellTab] = useState<ProfileTab | null>(null);
  const [miniWinsOpen, setMiniWinsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [postCount, setPostCount] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);

  // The watchlist lives in archiveStore, which the Archive screens hydrate on
  // their own mount. Arriving straight at You — a cold start, a deep link —
  // would otherwise show an empty Saved section for a list she definitely has.
  const hydrateArchive = useArchiveStore((s) => s.hydrateMine);
  const watchlist = useArchiveStore((s) => s.watchlist);
  useEffect(() => {
    if (user?.id) void hydrateArchive(user.id);
  }, [user?.id, hydrateArchive]);

  // Post-checkout used to expand an orders accordion on this tab. The
  // prototype puts that list in Tickets & orders — honour the old query
  // by opening the wallet instead of drawing a second list here.
  useEffect(() => {
    if (ordersParam === '1') router.push('/tickets' as never);
  }, [ordersParam, router]);

  /*
   * A spinner needs an end.
   *
   * The profile is fetched by the root layout and this screen only reads it, so
   * a failed or hanging load leaves it null with no error anywhere to render —
   * a spinner that never resolves and offers nothing. That already mattered;
   * it matters more now that this tab holds the only links to `/people` and
   * `/badges`, so one stuck fetch takes three screens with it.
   *
   * Eight seconds, then a way out. The retry re-reads the same row the layout
   * reads and writes it to the same store, so a success here is indistinguishable
   * from the load having worked the first time.
   */
  const [profileStalled, setProfileStalled] = useState(false);
  const [retryingProfile, setRetryingProfile] = useState(false);
  const setProfile = useProfileStore((s) => s.setProfile);

  useEffect(() => {
    if (profile) { setProfileStalled(false); return undefined; }
    const t = setTimeout(() => setProfileStalled(true), PROFILE_STALL_MS);
    return () => clearTimeout(t);
  }, [profile]);

  const retryProfile = useCallback(async () => {
    if (!user?.id) return;
    setRetryingProfile(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      if (data) setProfile(data as Profile);
    } catch (e) {
      // Stay on the error state rather than dropping back to the spinner: a
      // second silent wait is the thing she just failed to get out of.
      logError(e, 'ProfileScreen.retryProfile');
    } finally {
      setRetryingProfile(false);
    }
  }, [user?.id, setProfile]);

  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      try {
        const { data } = await supabase
          .from('user_badge_progress')
          .select('*, badges(*)')
          .eq('user_id', user.id);
        if (data) setBadges(data as EarnedBadge[]);
      } catch (e: any) {
        logError(e, 'profileScreen_fetchBadges');
      }
    })();

    void loadBookmarks(user.id);
    void fetchOrders();
    void supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', user.id)
      .in('post_type', ['photo', 'video'])
      .then(({ count, error }) => {
        if (error) logError(error, 'you_postCount');
        else setPostCount(count ?? 0);
      });
    void fetchUnreadNotificationCount(user.id)
      .then(setUnreadNotifs)
      .catch((e: unknown) => logError(e, 'you_unreadNotifs'));
  }, [user?.id, loadBookmarks, fetchOrders]);

  // Fetch saved business details whenever bookmarked IDs change.
  // An empty Set with a new reference every render must not write [] again —
  // that re-render loop took the You tab down in tests and would do the same
  // if the store ever handed us a fresh Set of the same ids.
  useEffect(() => {
    const ids = [...bookmarkedBusinessIds];
    if (ids.length === 0) {
      setSavedBusinesses((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    void (async () => {
      try {
        const { data } = await supabase
          .from('businesses')
          .select('*')
          .in('id', ids);
        if (data) setSavedBusinesses(data as Business[]);
      } catch (e: any) {
        logError(e, 'profileScreen_fetchSavedBusinesses');
      }
    })();
  }, [bookmarkedBusinessIds]);

  // Saved businesses open the full storefront route — the same detail view the
  // Build tab uses — so the marketplace has ONE consistent open path, never a
  // popup here and a page there.
  const handleOpenBiz = (biz: Business) => {
    router.push(`/business/${biz.id}` as any);
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    statusRow: { paddingHorizontal: 14, paddingTop: 8, alignItems: 'flex-start' },
    orderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.background,
    },
    orderRowId: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, fontFamily: 'monospace' },
    comingSoonCard: {
      marginTop: 8,
      marginBottom: 8,
      padding: 16,
      borderRadius: RADII.md,
      backgroundColor: colors.surface,
      gap: 6,
    },
    comingSoonTitle: { ...TYPE.title, color: colors.textPrimary },
    comingSoonBody: { ...TYPE.body, color: colors.textSecondary },
    stalled: { paddingHorizontal: 32, paddingTop: 64, gap: 8, alignItems: 'center' },
    stalledTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    stalledBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    stalledBtn: {
      marginTop: 8, minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 22,
      alignItems: 'center', justifyContent: 'center',
      borderRadius: RADII.pill, backgroundColor: colors.primary,
    },
    stalledBtnText: { color: colors.primaryInk, fontSize: 14, fontWeight: '700' },
  });

  if (!user || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        {profileStalled ? (
          <View style={styles.stalled} testID="you-profile-stalled">
            <Text style={styles.stalledTitle}>We could not load your profile</Text>
            <Text style={styles.stalledBody}>
              Everything on this tab needs it — your people, your badges, your orders.
            </Text>
            <TouchableOpacity
              onPress={() => void retryProfile()}
              accessibilityRole="button"
              accessibilityLabel="Try loading your profile again"
              activeOpacity={0.85}
              style={styles.stalledBtn}
              testID="you-profile-retry"
            >
              <Text style={styles.stalledBtnText}>
                {retryingProfile ? 'Trying…' : 'Try again'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
        )}
      </SafeAreaView>
    );
  }

  const populated: PopulatedTabs = {
    posts: isBeta && postCount > 0,
    shop: false,
    events: false,
    rooms: false,
    games: false,
    about: isBeta,
    saved: true,
  };

  const renderTab = (tab: ProfileTab) => {
    if (!user?.id) return null;
    if (tab === 'posts') return <ProfilePhotoGrid userId={user.id} editable />;
    if (tab === 'saved') {
      return (
        <View>
          {isBeta ? <SavedPosts userId={user.id} /> : null}
          <SavedWatchlist />
          {isBeta && savedBusinesses.map((biz) => (
            <TouchableOpacity
              key={biz.id}
              style={styles.orderRow}
              onPress={() => handleOpenBiz(biz)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${biz.name}`}
            >
              <Text style={styles.orderRowId}>{biz.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      );
    }
    return <ProfileFavorites userId={user.id} editable />;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="you-shell">
      {kind === 'pending' ? (
        <View style={styles.statusRow}>
          <AccountStatusTag />
        </View>
      ) : null}
      <ProfileShell
        variant="self"
        name={profile.display_name ?? profile.username}
        subtitle={profile.username ? `@${profile.username}` : null}
        bio={profile.bio}
        pronouns={profile.pronouns ?? []}
        identityLabels={profile.identity_labels ?? []}
        statusLabels={profile.dating_looking_for ?? []}
        avatarUrl={profile.avatar_url}
        points={profile.gamification_points}
        official={isOfficialAccount(profile)}
        badgePreview={(() => {
          const preview = badgePreviewFromEarned(badges);
          if (!preview) return null;
          return {
            ...preview,
            onPress: () => router.push('/badges' as never),
          };
        })()}
        xp={{
          ...profileXpBar(profile.gamification_points),
          onPress: () => setMiniWinsOpen(true),
        }}
        stats={[
          { value: String(postCount), label: 'Posts' },
          { value: String(badges.length), label: 'Badges' },
          { value: String(orders.length), label: 'Orders' },
        ]}
        headerActions={[
          {
            icon: 'notifications-outline',
            label: 'Notifications',
            onPress: () => router.push('/notifications' as never),
            badge: unreadNotifs > 0,
            testID: 'you-notifications',
          },
          {
            icon: 'menu-outline',
            label: 'More',
            onPress: () => setMoreOpen(true),
            testID: 'you-more',
          },
        ]}
        primaryAction={{
          label: 'Edit',
          onPress: () => router.push('/(tabs)/you/edit' as never),
        }}
        populated={populated}
        selectedTab={shellTab}
        onSelectTab={setShellTab}
        renderTab={renderTab}
        beforeTabs={
          user?.id ? (
            <View>
              <SelfControls
                userId={user.id}
                onOpenDaily={() => setMiniWinsOpen(true)}
              />
              {!isBeta ? (
                <View style={styles.comingSoonCard} testID="you-coming-soon">
                  <Text style={styles.comingSoonTitle}>
                    {kind === 'pending'
                      ? 'Official chat unlocks when you’re approved'
                      : 'More of Roxy is coming soon'}
                  </Text>
                  <Text style={styles.comingSoonBody}>
                    {kind === 'pending'
                      ? 'The Archive is open now. Official chat and the rest of Roxy are for approved members — they unlock when a reviewer admits you.'
                      : 'Archive and Official chat are live. Feed, rooms, shop and dating open for beta first.'}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null
        }
        testID="profile-shell"
      />

      <YouMoreMenu
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        userId={user.id}
        walletCount={orders.length}
        savedCount={(watchlist ?? []).length + savedBusinesses.length}
        onOpenSaved={() => setShellTab('saved')}
      />

      <MiniWinsSheet
        visible={miniWinsOpen}
        userId={user.id}
        onClose={() => setMiniWinsOpen(false)}
      />
    </SafeAreaView>
  );
}
