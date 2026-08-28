// apps/mobile/app/(tabs)/you/index.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, ActivityIndicator, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useBuildStore } from '../../../store/buildStore';
import { useMarketplaceStore } from '../../../store/marketplaceStore';
import { supabase } from '../../../lib/supabase';
import { ProfileCard } from '../../../components/profile/ProfileCard';
import { ProfilePhotoGrid } from '../../../components/profile/ProfilePhotoGrid';
import { ProfileFavorites } from '../../../components/profile/ProfileFavorites';
import { SavedPosts } from '../../../components/profile/SavedPosts';
import { SelfControls } from '../../../components/profile/SelfControls';
import { MiniWinsCard } from '../../../components/grow/MiniWinsCard';
import { OrderDetailSheet } from '../../../components/build/OrderDetailSheet';
import { logError } from '../../../lib/errorLogger';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { formatMoney } from '../../../lib/currency';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { RADII } from '../../../lib/theme';
import type { UserBadgeProgress, Badge, Business, Profile } from '../../../types';
import type { OrderWithItems } from '../../../types/marketplace';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

/** How long a spinner is a reasonable answer before it becomes a dead end. */
const PROFILE_STALL_MS = 8_000;

const STATUS_COLORS: Record<string, string> = {
  paid: '#3B82F6',
  shipped: '#F59E0B',
  delivered: '#10B981',
  refunded: '#EF4444',
  cancelled: '#6B7280',
};

export default function ProfileScreen() {
  const { user } = useAuthStore();
  const { profile } = useProfileStore();
  const { bookmarkedBusinessIds, loadBookmarks } = useBuildStore();
  const { orders, loadingOrders, ordersError, fetchOrders } = useMarketplaceStore();
  const router = useRouter();
  const colors = useThemeColors();
  // A post-checkout "View My Orders" link arrives with ?orders=1 so the orders
  // list starts expanded instead of collapsed behind its accordion.
  const { orders: ordersParam } = useLocalSearchParams<{ orders?: string }>();

  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [badgeLoadError, setBadgeLoadError] = useState(false);
  const [savedBusinesses, setSavedBusinesses] = useState<Business[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithItems | null>(null);
  const [showOrders, setShowOrders] = useState(ordersParam === '1');
  const scrollRef = useRef<ScrollView>(null);
  const [savedY, setSavedY] = useState(0);

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
        setBadgeLoadError(true);
      }
    })();

    void loadBookmarks(user.id);
    void fetchOrders();
  }, [user?.id, loadBookmarks, fetchOrders]);

  // Fetch saved business details whenever bookmarked IDs change
  useEffect(() => {
    const ids = [...bookmarkedBusinessIds];
    if (ids.length === 0) { setSavedBusinesses([]); return; }
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
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 12, paddingVertical: 8,
    },
    headerBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    headerTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 16 },
    ordersSection: {
      marginTop: 8,
      marginHorizontal: 16,
      marginBottom: 32,
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    ordersSectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    ordersSectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    ordersHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    orderCountBadge: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    orderCountText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    ordersLoading: { paddingVertical: 24, alignItems: 'center' },
    ordersEmpty: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8, alignItems: 'center', gap: 4 },
    ordersEmptyText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
    ordersEmptySubtext: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
    ordersRetryText: { color: colors.primary, fontSize: 13, fontWeight: '700', paddingVertical: 6 },
    orderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.background,
    },
    orderRowLeft: { gap: 2 },
    orderRowId: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, fontFamily: 'monospace' },
    orderRowDate: { fontSize: 12, color: colors.textMuted },
    orderRowItems: { fontSize: 12, color: colors.textSecondary },
    orderRowRight: { alignItems: 'flex-end', gap: 4 },
    orderRowTotal: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
    badgeError: { color: colors.error, fontSize: 13, textAlign: 'center', paddingHorizontal: 16, paddingTop: 4 },
    noBadges: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 16, paddingTop: 4 },
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

  const sortedOrders = [...orders].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Standard social profile header: back · @handle · settings */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.push('/(tabs)/feed' as any))}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>@{profile.username}</Text>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.push('/(tabs)/you/settings' as any)}
          accessibilityLabel="Settings"
        >
          <Ionicons name="settings-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
      {/* Bug fix: no bottom padding meant the last section (My Orders) scrolled
          in right under the fixed tab bar + Roxy FAB with nothing protecting
          it -- other screens in this app already reserve ~80px for this. */}
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <ProfileCard
          profile={profile}
          badges={badges}
          isOwn={true}
          savedBusinesses={savedBusinesses}
          onOpenBusiness={handleOpenBiz}
          onEdit={() => router.push('/(tabs)/you/edit' as any)}
        />

        {user?.id && (
          <>
            {/* Directly under the card, above everything else: the two safety
                modes have to be two taps from anywhere, and any tab → You is
                the first of those two. */}
            <SelfControls
              userId={user.id}
              onOpenSaved={() => scrollRef.current?.scrollTo({ y: savedY, animated: true })}
            />
            <MiniWinsCard userId={user.id} />
            <ProfilePhotoGrid userId={user.id} editable />
            {/* Measured rather than estimated: the blocks above it are all
                variable height — a photo grid, a card whose seller row may or
                may not carry a status — so any constant here would be wrong for
                most women most of the time. */}
            <View onLayout={(e) => setSavedY(e.nativeEvent.layout.y)}>
              <SavedPosts userId={user.id} />
            </View>
            <ProfileFavorites userId={user.id} editable />
          </>
        )}

        {badgeLoadError ? (
          <Text style={styles.badgeError}>Could not load badges</Text>
        ) : null}

        {/* My Orders section */}
        <View style={styles.ordersSection}>
          <TouchableOpacity
            style={styles.ordersSectionHeader}
            onPress={() => setShowOrders(v => !v)}
            accessibilityLabel="Toggle my orders"
          >
            <Text style={styles.ordersSectionTitle}>My Orders</Text>
            <View style={styles.ordersHeaderRight}>
              {orders.length > 0 && (
                <View style={styles.orderCountBadge}>
                  <Text style={styles.orderCountText}>{orders.length}</Text>
                </View>
              )}
              <Ionicons
                name={showOrders ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </View>
          </TouchableOpacity>

          {showOrders && (
            <>
              {loadingOrders ? (
                <View style={styles.ordersLoading}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : ordersError ? (
                <View style={styles.ordersEmpty}>
                  <Text style={styles.ordersEmptyText}>{ordersError}</Text>
                  <TouchableOpacity onPress={() => void fetchOrders()} accessibilityLabel="Retry loading orders">
                    <Text style={styles.ordersRetryText}>Try again</Text>
                  </TouchableOpacity>
                </View>
              ) : sortedOrders.length === 0 ? (
                <View style={styles.ordersEmpty}>
                  <Text style={styles.ordersEmptyText}>No orders yet</Text>
                  <Text style={styles.ordersEmptySubtext}>Shop from WLW businesses in the Build tab</Text>
                </View>
              ) : (
                sortedOrders.map((order) => (
                  <TouchableOpacity
                    key={order.id}
                    style={styles.orderRow}
                    onPress={() => setSelectedOrder(order)}
                    accessibilityLabel={`Order ${order.id.slice(-8).toUpperCase()}, ${order.status}`}
                  >
                    <View style={styles.orderRowLeft}>
                      <Text style={styles.orderRowId}>#{order.id.slice(-8).toUpperCase()}</Text>
                      <Text style={styles.orderRowDate}>
                        {new Date(order.created_at).toLocaleDateString()}
                      </Text>
                      <Text style={styles.orderRowItems}>
                        {order.order_items.length} item{order.order_items.length !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <View style={styles.orderRowRight}>
                      <Text style={styles.orderRowTotal}>
                        {formatMoney(order.total_cents, order.currency)}
                      </Text>
                      <View style={[
                        styles.statusBadge,
                        { backgroundColor: (STATUS_COLORS[order.status] ?? '#6B7280') + '20' },
                      ]}>
                        <Text style={[
                          styles.statusText,
                          { color: STATUS_COLORS[order.status] ?? '#6B7280' },
                        ]}>
                          {order.status.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </>
          )}
        </View>
      </ScrollView>

      <OrderDetailSheet
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
      />
    </SafeAreaView>
  );
}
